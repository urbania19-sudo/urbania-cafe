import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/202610310027_role_helper_and_rpc_permission_hardening.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

describe('Migration 0027 — role helper and RPC permission contract', () => {
  it('binds both UUID role helpers to the authenticated caller identity', () => {
    expect(sql).toContain('auth.uid() is null or _user_id is distinct from auth.uid() then false');
    expect(sql).toContain("ap.role in ('owner', 'admin', 'staff')");
    expect(sql).toContain("ap.role in ('owner', 'admin')");
  });

  it('uses admin_profiles as the role source and maps the kitchen enum to staff profiles', () => {
    expect(sql).toContain("_role = 'admin'::public.app_role");
    expect(sql).toContain("_role = 'kitchen'::public.app_role");
    expect(sql).toContain("ap.role = 'staff'");
  });

  it('removes anonymous execution from identity-aware and sensitive staff RPCs', () => {
    for (const signature of [
      'public.has_role(uuid, public.app_role)',
      'public.is_staff(uuid)',
      'public.cancel_bill(uuid, text)',
      'public.create_manual_order(jsonb)',
      'public.edit_order_items(uuid, jsonb)',
      'public.get_bill_for_order(uuid)',
      'public.record_bill_reprint(uuid, jsonb)',
      'public.update_staff_order_status(uuid, public.order_status, text)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon`);
    }
  });

  it('keeps only the active-category read policy available to anon on categories', () => {
    expect(sql).toContain('create policy "Public reads active categories"');
    expect(sql).toContain('to anon');
    expect(sql).toContain('create policy "Authenticated reads active categories"');
    expect(sql).toContain("public.has_role(auth.uid(), 'admin'::public.app_role)");
  });

  it('preserves intentionally public token-based QR entry points', () => {
    expect(sql).toContain('grant execute on function public.place_public_order(jsonb) to anon, authenticated, service_role');
    expect(sql).toContain('grant execute on function public.get_order_status(uuid, text) to anon, authenticated, service_role');
    expect(sql).toContain('grant execute on function public.get_table_by_token(text) to anon, authenticated, service_role');
  });

  it('keeps the migration transactional and does not modify business rows', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql.toLowerCase()).not.toMatch(/\b(insert into|update public\.|delete from public\.)\b/);
  });
});
