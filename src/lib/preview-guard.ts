import { NextResponse } from 'next/server';

export interface PreviewGuardResult {
  blocked: boolean;
  reason?: string;
  code?: string;
}

/**
 * Checks whether write operations are permitted in the current deployment environment.
 * 
 * In Vercel Preview deployments, operational testing (placing orders, accepting orders,
 * completing orders, generating bills, and testing receipt printing) is permitted by default
 * so café staff can verify thermal printing and workflow changes on physical hardware.
 * 
 * If a strict read-only lock is desired, set BLOCK_PREVIEW_WRITES=true in the environment.
 */
export function isPreviewWriteBlocked(): PreviewGuardResult {
  const isVercelPreview = process.env.VERCEL_ENV === 'preview';

  if (!isVercelPreview) {
    return { blocked: false };
  }

  // If writes are explicitly blocked via environment variable
  const isExplicitlyBlocked =
    process.env.BLOCK_PREVIEW_WRITES === 'true' ||
    process.env.ALLOW_PREVIEW_WRITES === 'false';

  if (isExplicitlyBlocked) {
    return {
      blocked: true,
      reason:
        'Preview deployments sharing the production database are read-only to protect café financial records.',
      code: 'PREVIEW_READ_ONLY',
    };
  }

  // Permit workflow testing on Preview
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
