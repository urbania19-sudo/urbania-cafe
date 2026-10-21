import { NextResponse } from 'next/server';

export interface PreviewGuardResult {
  blocked: boolean;
  reason?: string;
  code?: string;
}

// Known production Supabase project reference
const KNOWN_PRODUCTION_PROJECT_REF = 'rexeyagnvssvjlukjcbd';

/**
 * Extracts a Supabase project reference or hostname from a URL or connection string.
 * e.g., "https://rexeyagnvssvjlukjcbd.supabase.co" -> "rexeyagnvssvjlukjcbd"
 * e.g., "postgresql://postgres:...@db.rexeyagnvssvjlukjcbd.supabase.co:5432/..." -> "rexeyagnvssvjlukjcbd"
 */
function extractProjectRef(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.supabase.co')) {
      const parts = host.split('.');
      if (parts.length >= 3) {
        if (parts[0] === 'db' && parts.length >= 4) {
          return parts[1];
        }
        return parts[0];
      }
    }
    return host;
  } catch {
    const match = url.match(/([a-z0-9]{20})/i);
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

  if (!isVercelPreview) {
    return { blocked: false };
  }

  // Candidate database connection URLs across internal, public, and server environments
  const candidateUrls = [
    process.env.SUPABASE_INTERNAL_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

  // Check if any candidate URL matches known production project ref or host
  const targetsProduction = candidateUrls.some((url) => {
    const lower = url.toLowerCase();
    if (lower.includes(KNOWN_PRODUCTION_PROJECT_REF)) return true;
    const ref = extractProjectRef(url);
    return ref === KNOWN_PRODUCTION_PROJECT_REF;
  });

  // Check if production database URL is explicitly defined in environment for comparison
  const prodSupabaseUrl = process.env.PRODUCTION_SUPABASE_URL || process.env.PRODUCTION_DATABASE_URL;
  let matchesExplicitProductionUrl = false;
  if (prodSupabaseUrl) {
    const prodRef = extractProjectRef(prodSupabaseUrl);
    if (prodRef) {
      matchesExplicitProductionUrl = candidateUrls.some((url) => extractProjectRef(url) === prodRef);
    }
  }

  // To permit writes in Preview, an isolated staging database must be explicitly verified
  const isIsolatedStagingVerified =
    process.env.ISOLATED_STAGING_DB === 'true' ||
    process.env.STAGING_DATABASE === 'true';

  const isAllowWritesRequested = process.env.ALLOW_PREVIEW_WRITES === 'true';

  // Fail-Closed: Block if:
  // 1. Database targets production (known production ref or matches production URL)
  // 2. OR an isolated staging database is NOT explicitly verified (default in Preview)
  // 3. OR preview writes are not explicitly requested
  // 4. OR preview writes are explicitly blocked (BLOCK_PREVIEW_WRITES=true)
  const isExplicitlyBlocked =
    process.env.BLOCK_PREVIEW_WRITES === 'true' ||
    process.env.ALLOW_PREVIEW_WRITES === 'false';

  if (
    targetsProduction ||
    matchesExplicitProductionUrl ||
    !isIsolatedStagingVerified ||
    !isAllowWritesRequested ||
    isExplicitlyBlocked
  ) {
    return {
      blocked: true,
      reason:
        'Preview deployments sharing the production database are read-only to protect café financial records.',
      code: 'PREVIEW_READ_ONLY',
    };
  }

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
