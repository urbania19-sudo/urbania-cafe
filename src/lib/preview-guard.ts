import { NextResponse } from 'next/server';

export interface PreviewGuardResult {
  blocked: boolean;
  reason?: string;
  code?: string;
}

/**
 * Checks whether write operations are permitted in the current deployment environment.
 * 
 * Fail-Closed Policy:
 * In Vercel Preview deployments, if the database is shared with production (or if no explicitly
 * verified isolated staging database is configured), all financial, administrative, and data
 * mutation requests are rejected with HTTP 403.
 */
export function isPreviewWriteBlocked(): PreviewGuardResult {
  const isVercelPreview = process.env.VERCEL_ENV === 'preview';

  if (!isVercelPreview) {
    return { blocked: false };
  }

  const allowPreviewWrites = process.env.ALLOW_PREVIEW_WRITES === 'true';
  const supabaseUrl =
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';

  // Known production project reference
  const isProductionDatabase = supabaseUrl.includes('rexeyagnvssvjlukjcbd');

  if (isProductionDatabase || !allowPreviewWrites) {
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
