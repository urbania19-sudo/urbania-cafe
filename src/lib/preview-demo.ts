/**
 * Safe Vercel Preview Demo Mode detection and helper utilities.
 *
 * Activated ONLY when:
 * 1. The deployment environment is Vercel Preview (VERCEL_ENV === 'preview')
 * 2. Required Supabase configuration is missing or incomplete.
 *
 * Production (VERCEL_ENV === 'production') and normal local development (VERCEL_ENV not set or !== 'preview')
 * NEVER activate demo mode, preserving standard authentication, configuration, and fail-closed security.
 */

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && url.trim().length > 0 && anonKey && anonKey.trim().length > 0);
}

export function isPreviewDemoMode(): boolean {
  const isVercelPreview = process.env.VERCEL_ENV === 'preview';
  return isVercelPreview && !isSupabaseConfigured();
}
