// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  'supabase/migrations/202610310027_harden_rpc_execution_privileges.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const flatSql = sql.toLowerCase().replace(/\s+/g, ' ');

describe('Migration 0027: SECURITY DEFINER execution privilege hardening', () => {
  it('revokes anonymous execution from privileged billing, payments, admin, and order RPCs', () => {
    const protectedFunctions = [
      'get_authorized_admins()',
      'settle_admin_credit_payment(uuid, integer, text, text)',
      'record_customer_payment(uuid, integer, text, text, text)',
      'cancel_bill(uuid, text)',
      'create_manual_order(jsonb)',
      'edit_order_items(uuid, jsonb)',
      'get_bill_for_order(uuid)',
      'generate_bill(uuid, text, numeric)',
      'record_bill_reprint(uuid, jsonb)',
      'update_staff_order_status(uuid, public.order_status, text)',
      'admin_list_staff()',
      'admin_set_role(text, public.app_role, boolean)',
      'acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid)',
      'create_external_platform_order(jsonb)',
      'create_admin_credit_order(jsonb)',
    ];

    for (const signature of protectedFunctions) {
      expect(flatSql).toContain(
        `revoke execute on function public.${signature.toLowerCase()} from public, anon;`
      );
    }
  });

  it('keeps role helper execution for authenticated RLS while removing anonymous execution', () => {
    for (const signature of [
      'has_role(uuid, public.app_role)',
      'is_staff(uuid)',
      'is_admin()',
      'is_staff()',
    ]) {
      expect(flatSql).toContain(
        `revoke execute on function public.${signature} from public, anon;`
      );
      expect(flatSql).toContain(
        `grant execute on function public.${signature} to authenticated, service_role;`
      );
    }

    expect(flatSql).toContain(
      'when _user_id = auth.uid() then exists ( select 1 from public.user_roles where user_id = _user_id and role = _role )'
    );
    expect(flatSql).toContain(
      "requester.role = 'admin'::public.app_role"
    );
    expect(flatSql).toContain(
      'when _user_id = auth.uid() then exists ( select 1 from public.user_roles where user_id = _user_id )'
    );
  });

  it('restricts internal-data policies to authenticated but preserves public active-category reads', () => {
    const authenticatedPolicies = [
      '"admins read profiles"',
      '"staff read bill audit events"',
      '"admins manage bills"',
      '"staff read bills"',
      '"admins manage settings"',
      '"staff read settings"',
      '"admins manage tables"',
      '"staff read tables"',
      '"admins manage categories"',
      '"admins manage options"',
      '"admins manage items"',
      '"admins read order items"',
      '"staff read order items"',
      '"staff and admins insert kitchen tickets"',
      '"staff and admins read kitchen tickets"',
      '"admins read orders"',
      '"admins update orders"',
      '"staff read orders"',
      '"admins manage admin credit settlements"',
      '"staff read customer payments"',
      '"Authenticated reads active categories"',
    ];

    for (const policyName of authenticatedPolicies) {
      const index = flatSql.indexOf(`create policy ${policyName.toLowerCase()}`);
      expect(index, `Missing recreated policy ${policyName}`).toBeGreaterThanOrEqual(0);
      const policySql = flatSql.slice(index, flatSql.indexOf(';', index) + 1);
      expect(policySql).toContain('to authenticated');
    }

    expect(flatSql).toContain(
      'create policy "public reads active categories" on public.categories for select to anon using (is_active);'
    );
  });

  it('does not revoke intentionally public token-based QR endpoints', () => {
    const publicQrFunctions = [
      'place_order(text, jsonb, text, integer, text)',
      'place_public_order(jsonb)',
      'get_order_status(uuid, text)',
      'get_table_by_token(text)',
    ];

    for (const signature of publicQrFunctions) {
      expect(flatSql).not.toContain(
        `revoke execute on function public.${signature.toLowerCase()}`
      );
    }
  });

  it('conditionally removes Data API grants from production-only archive tables', () => {
    expect(flatSql).toContain("to_regclass(format('public.%i', v_table)) is not null");
    expect(flatSql).toContain(
      'revoke all privileges on table public.%i from public, anon, authenticated'
    );
    expect(flatSql).toContain('grant select on table public.%i to service_role');
  });

  it('removes broad future default EXECUTE grants for the migration role', () => {
    expect(flatSql).toContain(
      'alter default privileges for role postgres revoke execute on functions from public;'
    );
    expect(flatSql).toContain(
      'alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;'
    );
    expect(flatSql).not.toContain('alter default privileges for role supabase_admin');
  });

  it('removes direct client execution from trigger-only helpers', () => {
    for (const signature of [
      'log_order_status()',
      'rls_auto_enable()',
      'prevent_customer_payment_mutation()',
    ]) {
      expect(flatSql).toContain(
        `revoke execute on function public.${signature} from public, anon, authenticated;`
      );
    }
  });
});
