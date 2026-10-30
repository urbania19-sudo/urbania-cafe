// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  'supabase/migrations/202610310027_harden_rpc_execution_privileges.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

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
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(sql).toMatch(
        new RegExp(
          `revoke execute on function public\\.${escaped} from public, anon;`,
          'i'
        )
      );
    }
  });

  it('preserves authenticated execution for role helpers used by existing RLS policies', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.has_role\(uuid, public\.app_role\) from public, anon;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.has_role\(uuid, public\.app_role\) to authenticated;/i
    );
    expect(sql).toMatch(
      /revoke execute on function public\.is_staff\(uuid\) from public, anon;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.is_staff\(uuid\) to authenticated;/i
    );
    expect(sql).not.toMatch(/revoke execute on function public\.is_admin\(\)/i);
    expect(sql).not.toMatch(/revoke execute on function public\.is_staff\(\)/i);
  });

  it('splits public category reads from authenticated admin visibility', () => {
    expect(sql).toMatch(
      /create policy "Public reads active categories"[\s\S]*?to anon[\s\S]*?using \(is_active\);/i
    );
    expect(sql).toMatch(
      /create policy "Authenticated reads active categories"[\s\S]*?to authenticated[\s\S]*?has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/i
    );
  });

  it('does not revoke the intentionally public token-based QR endpoints', () => {
    const qrFunctions = [
      'place_order(text, jsonb, text, integer, text)',
      'place_public_order(jsonb)',
      'get_order_status(uuid, text)',
      'get_table_by_token(text)',
    ];
    for (const signature of qrFunctions) {
      expect(sql).not.toMatch(
        new RegExp(
          `revoke execute on function public\\.${signature.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')}`,
          'i'
        )
      );
    }
  });

  it('removes Data API access to archived backups while retaining service-role read access', () => {
    expect(sql).toMatch(
      /revoke all privileges on table[\s\S]*?_backup_pre_0009_orders[\s\S]*?from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /grant select on table[\s\S]*?_backup_pre_0009_orders[\s\S]*?to service_role;/i
    );
  });

  it('removes broad future default EXECUTE grants for migration owners', () => {
    expect(sql).toMatch(
      /alter default privileges for role postgres in schema public\s+revoke execute on functions from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /alter default privileges for role supabase_admin in schema public\s+revoke execute on functions from public, anon, authenticated;/i
    );
  });

  it('removes direct client execution from trigger-only helpers', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.log_order_status\(\) from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /revoke execute on function public\.rls_auto_enable\(\) from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /revoke execute on function public\.prevent_customer_payment_mutation\(\) from public, anon, authenticated;/i
    );
  });
});
