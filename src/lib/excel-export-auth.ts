import 'server-only';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export interface ExcelAuthResult {
  authorized: boolean;
  response?: NextResponse;
}

/**
 * Validates the Authorization header for Excel reporting endpoints.
 * 
 * Security rules:
 * - Requires Authorization: Bearer <token>
 * - Dedicated server-only environment variable: URBANIA_EXCEL_EXPORT_TOKEN
 * - Fail closed: Rejects with HTTP 500 if the server environment variable is not configured
 * - Constant-time comparison using SHA-256 hashing + timingSafeEqual
 * - Never logs or exposes the token
 */
export function verifyExcelExportAuth(authHeader: string | null): ExcelAuthResult {
  const serverToken = process.env.URBANIA_EXCEL_EXPORT_TOKEN;

  // Fail closed if server secret is missing or empty
  if (!serverToken || serverToken.trim() === '') {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Export authentication is not configured on the server' },
        { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      ),
    };
  }

  // Reject missing Authorization header
  if (!authHeader) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Missing Authorization header' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      ),
    };
  }

  // Check if header starts with Bearer
  const trimmedHeader = authHeader.trim();
  if (!/^Bearer/i.test(trimmedHeader)) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized: Invalid Authorization header format. Expected 'Bearer <token>'" },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      ),
    };
  }

  // Parse "Bearer <token>"
  const match = trimmedHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].trim()) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Bearer token is empty' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      ),
    };
  }

  const providedToken = match[1].trim();

  // Safe constant-time comparison:
  // Hash both with SHA-256 first to ensure equal length and protect against length-extension / timing leaks
  const serverHash = crypto.createHash('sha256').update(serverToken).digest();
  const clientHash = crypto.createHash('sha256').update(providedToken).digest();

  if (!crypto.timingSafeEqual(serverHash, clientHash)) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Invalid export token' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      ),
    };
  }

  return { authorized: true };
}
