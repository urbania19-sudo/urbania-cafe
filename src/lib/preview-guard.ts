import { NextResponse } from 'next/server';

export interface PreviewGuardResult {
  blocked: boolean;
  reason?: string;
  code?: string;
}

// Known production Supabase project reference
export const KNOWN_PRODUCTION_PROJECT_REF = 'rexeyagnvssvjlukjcbd';

const DEFAULT_PREVIEW_REASON =
  'Preview deployments sharing the production database are read-only to protect café financial records.';

/**
 * Extracts a Supabase project reference or hostname from a URL or connection string.
 * Returns null if the URL is missing, invalid, or cannot be parsed into a recognizable target.
 * e.g., "https://rexeyagnvssvjlukjcbd.supabase.co" -> "rexeyagnvssvjlukjcbd"
 * e.g., "postgresql://postgres:...@db.rexeyagnvssvjlukjcbd.supabase.co:5432/..." -> "rexeyagnvssvjlukjcbd"
 * e.g., "postgresql://postgres.rexeyagnvssvjlukjcbd:...@aws-0.pooler.supabase.com:6543/postgres" -> "rexeyagnvssvjlukjcbd"
 */
export function extractProjectRef(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!host) return null;

    if (host.endsWith('.supabase.co') || host.endsWith('.supabase.com')) {
      const parts = host.split('.');
      if (parts.length >= 3) {
        if (parts[0] === 'db' && parts.length >= 4) {
          return parts[1];
        }
        return parts[0];
      }
    }

    if (parsed.username) {
      const userParts = parsed.username.split('.');
      if (userParts.length === 2 && userParts[0] === 'postgres' && userParts[1]) {
        return userParts[1].toLowerCase();
      }
    }

    return host;
  } catch {
    // If not a standard URL, check if the string itself is a valid 20-character Supabase project ref
    const match = trimmed.match(/^([a-z0-9]{20})$/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Checks whether write operations are permitted in the current deployment environment.
 * 
 * Fail-Closed Security Policy:
 * When VERCEL_ENV === 'preview', all database mutations are blocked by default to protect
 * production financial, billing, and customer records from test activity when Preview
 * deployments share the production Supabase database.
 * 
 * Writes are ONLY permitted in Preview if an isolated staging database has been explicitly
 * configured, verified, and confirmed to NOT match or point to the production database.
 * 
 * Production (VERCEL_ENV === 'production') and local development remain fully functional.
 */
export function isPreviewWriteBlocked(): PreviewGuardResult {
  const isVercelPreview = process.env.VERCEL_ENV === 'preview';

  // Production (VERCEL_ENV === 'production') and local development remain fully functional.
  if (!isVercelPreview) {
    return { blocked: false };
  }

  // 1. Explicit block flags always take precedence
  const isExplicitlyBlocked =
    process.env.BLOCK_PREVIEW_WRITES === 'true' ||
    process.env.ALLOW_PREVIEW_WRITES === 'false';

  if (isExplicitlyBlocked) {
    return {
      blocked: true,
      reason: DEFAULT_PREVIEW_REASON,
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // 2. Both explicit staging confirmation AND allow writes request are strictly required
  const isIsolatedStagingVerified =
    process.env.ISOLATED_STAGING_DB === 'true' ||
    process.env.STAGING_DATABASE === 'true';

  const isAllowWritesRequested = process.env.ALLOW_PREVIEW_WRITES === 'true';

  if (!isIsolatedStagingVerified || !isAllowWritesRequested) {
    return {
      blocked: true,
      reason: DEFAULT_PREVIEW_REASON,
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // 3. Inspect candidate database connection URLs across internal, public, and server environments
  const candidateEntries = [
    { name: 'SUPABASE_INTERNAL_URL', value: process.env.SUPABASE_INTERNAL_URL },
    { name: 'NEXT_PUBLIC_SUPABASE_URL', value: process.env.NEXT_PUBLIC_SUPABASE_URL },
    { name: 'SUPABASE_URL', value: process.env.SUPABASE_URL },
    { name: 'POSTGRES_URL', value: process.env.POSTGRES_URL },
    { name: 'DATABASE_URL', value: process.env.DATABASE_URL },
  ].filter(
    (entry): entry is { name: string; value: string } =>
      typeof entry.value === 'string' && entry.value.trim().length > 0
  );

  // Fail-closed: missing database targets must not accidentally permit writes
  if (candidateEntries.length === 0) {
    return {
      blocked: true,
      reason: DEFAULT_PREVIEW_REASON,
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // 4. Fail-closed: unrecognized or malformed database targets must not permit writes
  const resolvedTargets: { name: string; url: string; ref: string }[] = [];
  for (const entry of candidateEntries) {
    const ref = extractProjectRef(entry.value);
    if (!ref) {
      return {
        blocked: true,
        reason: DEFAULT_PREVIEW_REASON,
        code: 'PREVIEW_READ_ONLY',
      };
    }
    resolvedTargets.push({ name: entry.name, url: entry.value, ref });
  }

  // 5. Inconsistent configuration check: all configured connection targets must point to the same database target
  const uniqueRefs = new Set(resolvedTargets.map((t) => t.ref));
  if (uniqueRefs.size > 1) {
    return {
      blocked: true,
      reason: DEFAULT_PREVIEW_REASON,
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // 6. Check if any candidate URL targets the known production project ref or contains it
  const targetsProduction = resolvedTargets.some((target) => {
    const lower = target.url.toLowerCase();
    if (lower.includes(KNOWN_PRODUCTION_PROJECT_REF)) return true;
    return target.ref === KNOWN_PRODUCTION_PROJECT_REF;
  });

  if (targetsProduction) {
    return {
      blocked: true,
      reason: DEFAULT_PREVIEW_REASON,
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // 7. Check if any candidate URL matches an explicitly configured production URL or project ref
  const prodUrls = [
    process.env.PRODUCTION_SUPABASE_URL,
    process.env.PRODUCTION_DATABASE_URL,
  ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

  for (const prodUrl of prodUrls) {
    const prodRef = extractProjectRef(prodUrl);
    const lowerProd = prodUrl.toLowerCase();

    for (const target of resolvedTargets) {
      const lowerCandidate = target.url.toLowerCase();
      if (prodRef && target.ref === prodRef) {
        return {
          blocked: true,
          reason: DEFAULT_PREVIEW_REASON,
          code: 'PREVIEW_READ_ONLY',
        };
      }
      if (lowerCandidate === lowerProd || (prodRef && lowerCandidate.includes(prodRef))) {
        return {
          blocked: true,
          reason: DEFAULT_PREVIEW_REASON,
          code: 'PREVIEW_READ_ONLY',
        };
      }
    }
  }

  // All safety conditions verified: Preview writes permitted against isolated staging database
  return { blocked: false };
}

/**
 * Returns an HTTP 403 Forbidden response if preview writes are blocked,
 * or null if the write operation is permitted.
 */
export function enforcePreviewWriteGuard(): NextResponse | null {
  const guard = isPreviewWriteBlocked();
  if (guard.blocked) {
    return NextResponse.json(
      {
        error: guard.reason,
        code: guard.code,
      },
      { status: 403 }
    );
  }
  return null;
}
