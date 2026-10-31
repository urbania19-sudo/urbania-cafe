import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/202610260015_reconcile_kitchen_ticket_acknowledgement_rpc.sql'),
  'utf8'
);
const rollback = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/202610260015_reconcile_kitchen_ticket_acknowledgement_rpc.down.sql'),
  'utf8'
);

describe('kitchen-ticket acknowledgement reconciliation migration', () => {
  it('installs only the five-argument application contract and removes the obsolete overload safely', () => {
    expect(migration).toContain('p_expected_previous_ticket_id uuid');
    expect(migration).toContain('drop function if exists public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb);');
    expect(migration).not.toMatch(/drop function[^;]*cascade/i);
  });

  it('uses a constrained definer function and refreshes the PostgREST schema cache', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public, pg_temp');
    expect(migration).toContain('if not public.is_staff()');
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });

  it('removes public execution and grants only authenticated callers access', () => {
    expect(migration).toContain('from public, anon, service_role');
    expect(migration).toContain('to authenticated');
  });

  it('makes the rollback explicit about the old application contract while retaining restricted execution', () => {
    expect(rollback).toContain('current application code requires the five-argument RPC');
    expect(rollback).toContain('drop function if exists public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid);');
    expect(rollback).toContain('from public, anon, service_role');
    expect(rollback).toContain("notify pgrst, 'reload schema';");
  });
});
