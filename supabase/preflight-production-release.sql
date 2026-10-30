-- =============================================================================
-- Urbania Café — Production Preflight Release Inspection Script
-- Target Project Ref: asdrrunxpsqzbvswmzgv (Supabase Production)
-- Target Release Branch: feat/operational-improvements (PR #8)
-- 
-- SAFETY NOTICE:
-- 100% READ-ONLY. Contains only SELECT statements.
-- Does NOT execute any DDL, DML, data mutations, migrations, or schema changes.
-- Safe to execute directly in the Supabase SQL Editor on live production.
-- Uses schema existence guards to run cleanly on pre-migration or post-migration databases.
-- =============================================================================

-- =============================================================================
-- 1. Applied Migrations Audit
-- Inspects recorded migration history to verify where production currently stops.
-- Expected baseline before release: stops at 202610260015.
-- Pending release migrations: 0016 through 0027 (including role-helper/RPC permission hardening).
-- =============================================================================
select
  version,
  name,
  case
    when version <= '202610260015' then 'APPLIED_BASELINE'
    when version between '202610280016' and '202610310027' then 'RELEASE_CANDIDATE_MIGRATION'
    else 'UNKNOWN_MIGRATION'
  end as release_status
from supabase_migrations.schema_migrations
order by version desc;

-- Count summary of migrations
select
  count(*) as total_applied_migrations,
  max(version) as latest_applied_version,
  case
    when max(version) = '202610260015' then 'READY_FOR_0016_0027 (Stopped at 0015)'
    when max(version) between '202610280016' and '202610290026' then 'RELEASE_IN_PROGRESS (0027 pending)'
    when max(version) >= '202610310027' then 'MIGRATIONS_ALREADY_APPLIED (0027+)'
    else 'UNEXPECTED_STATE'
  end as migration_readiness_status
from supabase_migrations.schema_migrations;


-- =============================================================================
-- 2. Schema Presence: Core & Financial Tables Audit
-- Verifies the existence and table ownership of expected release tables.
-- =============================================================================
with expected_tables as (
  select unnest(array[
    'orders',
    'order_items',
    'bills',
    'admin_profiles',
    'menu_items',
    'menu_item_options',
    'bill_audit_events',
    'customer_payments',         -- introduced in 0017
    'admin_credit_settlements'   -- introduced in 0016
  ]) as table_name
)
select
  et.table_name,
  case when t.table_name is not null then 'EXISTS' else 'MISSING' end as table_status,
  t.table_type,
  c.relrowsecurity as rls_enabled
from expected_tables et
left join information_schema.tables t
  on t.table_schema = 'public' and t.table_name = et.table_name
left join pg_class c
  on c.relname = et.table_name and c.relnamespace = 'public'::regnamespace
order by
  case when t.table_name is not null then 1 else 0 end,
  et.table_name;


-- =============================================================================
-- 3. Schema Presence: Release Columns & Constraints Audit
-- Verifies new columns on orders and bills introduced in migrations 0016, 0017, 0026.
-- =============================================================================
with expected_columns as (
  select 'orders' as table_name, 'payment_status' as column_name, 'text' as expected_type union all
  select 'orders', 'paid_paise', 'integer' union all
  select 'orders', 'payment_method', 'text' union all
  select 'orders', 'admin_user_id', 'uuid' union all
  select 'orders', 'external_platform_name', 'text' union all
  select 'orders', 'external_platform_ref', 'text' union all
  select 'orders', 'idempotency_hash', 'text' union all
  select 'bills', 'payment_status', 'text' union all
  select 'bills', 'paid_paise', 'integer' union all
  select 'bills', 'payment_method', 'text' union all
  select 'bills', 'admin_user_id', 'uuid' union all
  select 'bills', 'external_platform_name', 'text' union all
  select 'bills', 'external_platform_ref', 'text' union all
  select 'customer_payments', 'idempotency_key', 'text' union all
  select 'admin_credit_settlements', 'amount_paise', 'integer'
)
select
  ec.table_name,
  ec.column_name,
  ec.expected_type,
  case when c.column_name is not null then 'PRESENT' else 'MISSING' end as column_status,
  c.data_type as actual_type,
  c.column_default,
  c.is_nullable
from expected_columns ec
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = ec.table_name
 and c.column_name = ec.column_name
order by ec.table_name, ec.column_name;

-- Verify CHECK constraints on orders and bills
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conname in (
    'orders_order_source_check',
    'bills_order_source_check',
    'orders_payment_status_check',
    'bills_payment_status_check'
  );


-- =============================================================================
-- 4. Schema Presence: Release Indexes Audit
-- Verifies specialized indexes for Admin Credit, Delivery Platforms, and Payments.
-- =============================================================================
with expected_indexes as (
  select unnest(array[
    'orders_admin_credit_idx',
    'orders_external_platform_idx',
    'customer_payments_bill_id_idx',
    'customer_payments_order_id_idx',
    'customer_payments_paid_at_idx',
    'customer_payments_method_idx',
    'admin_credit_settlements_order_id_idx',
    'admin_credit_settlements_admin_user_id_idx',
    'admin_credit_settlements_settled_at_idx'
  ]) as index_name
)
select
  ei.index_name,
  case when ci.relname is not null then 'PRESENT' else 'MISSING' end as index_status,
  t.relname as table_name,
  pg_get_indexdef(ci.oid) as index_definition
from expected_indexes ei
left join pg_class ci on ci.relname = ei.index_name and ci.relkind = 'i'
left join pg_index idx on idx.indexrelid = ci.oid
left join pg_class t on t.oid = idx.indrelid
order by ei.index_name;


-- =============================================================================
-- 5. RPC Functions & Security Definer Signatures Audit
-- Inspects existence, language, security definer property, and search_path of RPCs.
-- Includes identity-aware helpers and both public token-based and authenticated RPCs.
-- =============================================================================
with expected_functions as (
  select unnest(array[
    'get_authorized_admins',
    'settle_admin_credit_payment',
    'record_customer_payment',
    'create_external_platform_order',
    'create_admin_credit_order',
    'order_has_items',
    'prevent_customer_payment_mutation',
    'has_role',
    'is_admin',
    'is_staff',
    'cancel_bill',
    'create_manual_order',
    'edit_order_items',
    'get_bill_for_order',
    'record_bill_reprint',
    'update_staff_order_status',
    'place_public_order',
    'get_order_status',
    'get_table_by_token',
    'place_order'
  ]) as func_name
)
select
  ef.func_name,
  case when p.proname is not null then 'EXISTS' else 'MISSING' end as rpc_status,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as is_security_definer,
  array_to_string(p.proconfig, ', ') as runtime_config_search_path
from expected_functions ef
left join pg_proc p on p.proname = ef.func_name and p.pronamespace = 'public'::regnamespace
order by ef.func_name;


-- =============================================================================
-- 6. Function Execution Grants & Least-Privilege Audit
-- Audits permissions granted to public, anon, authenticated, and service_role.
-- Migrations 0022, 0023, and 0027 restrict application RPC execution to authenticated/service roles unless a QR function is intentionally public.
-- =============================================================================
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  case
    when p.proname in (
      'get_authorized_admins',
      'settle_admin_credit_payment',
      'record_customer_payment',
      'create_external_platform_order',
      'create_admin_credit_order',
      'order_has_items',
      'has_role',
      'is_admin',
      'is_staff',
      'cancel_bill',
      'create_manual_order',
      'edit_order_items',
      'get_bill_for_order',
      'record_bill_reprint',
      'update_staff_order_status'
    ) and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'FAIL: SENSITIVE RPC CALLABLE BY ANON'
    when p.proname in (
      'get_authorized_admins',
      'settle_admin_credit_payment',
      'record_customer_payment',
      'create_external_platform_order',
      'create_admin_credit_order',
      'order_has_items',
      'has_role',
      'is_admin',
      'is_staff',
      'cancel_bill',
      'create_manual_order',
      'edit_order_items',
      'get_bill_for_order',
      'record_bill_reprint',
      'update_staff_order_status'
    ) and not has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'PASS: RESTRICTED FROM ANON'
    when p.proname in ('place_public_order', 'get_order_status', 'get_table_by_token', 'place_order')
      then 'INFO: INTENTIONALLY PUBLIC QR/TOKEN RPC'
    else 'INFO: UNCHECKED'
  end as privilege_audit_verdict
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'get_authorized_admins',
    'settle_admin_credit_payment',
    'record_customer_payment',
    'create_external_platform_order',
    'create_admin_credit_order',
    'order_has_items',
    'has_role',
    'is_admin',
    'is_staff',
    'cancel_bill',
    'create_manual_order',
    'edit_order_items',
    'get_bill_for_order',
    'record_bill_reprint',
    'update_staff_order_status',
    'place_public_order',
    'get_order_status',
    'get_table_by_token',
    'place_order'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);


-- 7. Row Level Security (RLS) & Policies Audit
-- Verifies RLS policies on orders, order_items, customer_payments, admin_credit_settlements.
-- =============================================================================
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'order_items', 'bills', 'customer_payments', 'admin_credit_settlements', 'admin_profiles', 'categories', 'menu_categories', 'menu_items', 'menu_item_options', 'cafe_settings', 'cafe_tables', 'bill_audit_events', 'order_kitchen_tickets', 'user_roles')
order by tablename, policyname;


-- =============================================================================
-- 8. Ledger Protections & Append-Only Trigger Audit
-- Verifies that customer_payments has the customer_payments_immutable trigger
-- preventing any UPDATE or DELETE operations by any application role.
-- =============================================================================
select
  tgname as trigger_name,
  relname as table_name,
  proname as trigger_function,
  case tgtype & 2 when 2 then 'BEFORE' else 'AFTER' end as timing,
  case
    when (tgtype & 16 = 16) and (tgtype & 8 = 8) then 'UPDATE OR DELETE'
    when (tgtype & 16 = 16) then 'UPDATE'
    when (tgtype & 8 = 8) then 'DELETE'
    else 'OTHER'
  end as events,
  tgenabled as is_enabled
from pg_trigger tr
join pg_class c on c.oid = tr.tgrelid
join pg_proc p on p.oid = tr.tgfoid
where c.relnamespace = 'public'::regnamespace
  and tr.tgname = 'customer_payments_immutable';


-- =============================================================================
-- 9. Historical Data Distribution & Migration 0018 Backfill Diagnostics
-- Safe dynamic evaluation using to_jsonb to inspect row counts matching
-- historical migration backfill conditions without failing if columns do not exist.
-- =============================================================================

-- 9A. Distribution of Orders by Source and Status
select
  coalesce(order_source, 'UNKNOWN') as order_source,
  status,
  count(*) as order_count,
  coalesce(sum(total_paise), 0) / 100.0 as sum_total_inr
from public.orders
group by order_source, status
order by order_source, status;

-- 9B. Distribution of Bills by Source and Status
select
  coalesce(order_source, 'UNKNOWN') as order_source,
  status,
  count(*) as bill_count,
  coalesce(sum(total_paise), 0) / 100.0 as sum_total_inr
from public.bills
group by order_source, status
order by order_source, status;

-- 9C. Detailed Diagnostics for Affected Historical Findings (Pre-Migration vs Post-Migration)
select
  'Finding 1: Cancelled QR/Manual Orders WITHOUT Bill' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise), 0) as total_amount_paise,
  'Expected Pre: 4 rows (147,600 paise / ₹1,476). Expected Post: payment_status = unpaid, paid_paise = 0' as expectation
from public.orders o
where o.order_source in ('qr', 'manual')
  and o.status = 'CANCELLED'
  and not exists (select 1 from public.bills b where b.order_id = o.id)

union all

select
  'Finding 1: Completed QR/Manual Orders WITHOUT Bill' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise), 0) as total_amount_paise,
  'Expected Pre: 3 rows (38,700 paise / ₹387). Expected Post: payment_status = unpaid, paid_paise = 0' as expectation
from public.orders o
where o.order_source in ('qr', 'manual')
  and o.status = 'COMPLETED'
  and not exists (select 1 from public.bills b where b.order_id = o.id)

union all

select
  'Finding 1: Completed QR/Manual Orders WITH Issued Bill' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise), 0) as total_amount_paise,
  'Expected Pre: 24 rows (663,500 paise / ₹6,635): 1 QR order = 25,800 paise and 23 manual orders = 637,700 paise. Expected Post: linked order paid balances equal issued bill totals.' as expectation
from public.orders o
where o.order_source in ('qr', 'manual')
  and o.status = 'COMPLETED'
  and exists (select 1 from public.bills b where b.order_id = o.id and b.status = 'issued')

union all

select
  'Finding 2: Issued Manual Bills where Order Total > Bill Total (Discounts)' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise - b.total_paise), 0) as total_amount_paise,
  '2026-10-30 baseline snapshot: 5 rows; order totals = 160,000 paise, issued bill totals = 138,800 paise, difference = 21,200 paise (₹212). Recheck live: one discounted bill (UB-01041) was cancelled later on 2026-10-30.' as expectation
from public.bills b
join public.orders o on o.id = b.order_id
where b.status = 'issued'
  and b.order_source = 'manual'
  and o.total_paise > b.total_paise

union all

select
  'Finding 3: Cancelled Historical Bills (Unknown Payment State)' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(b.total_paise), 0) as total_amount_paise,
  '2026-10-30 baseline snapshot: 17 rows (481,100 paise / ₹4,811). Recheck live: UB-01041 was cancelled later on 2026-10-30; approved current snapshot is 18 rows / 491,100 paise. Post-migration: payment_status = NULL, paid_paise = 0' as expectation
from public.bills b
where b.status = 'cancelled'
  and b.order_source in ('qr', 'manual')

union all

select
  'Post-Migration Discrepancy Check: Orders vs Bills Paid Balances on Issued Bills' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(abs(coalesce((to_jsonb(o)->>'paid_paise')::int, 0) - coalesce((to_jsonb(b)->>'paid_paise')::int, 0))), 0) as total_amount_paise,
  'Post-migration target: 0 rows and 0 paise discrepancy' as expectation
from public.bills b
join public.orders o on o.id = b.order_id
where b.status = 'issued'
  and b.order_source in ('qr', 'manual')
  and coalesce((to_jsonb(o)->>'paid_paise')::int, 0) <> coalesce((to_jsonb(b)->>'paid_paise')::int, 0)

union all

select
  'Post-Migration False-Paid Cancelled Bills Check' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(b.total_paise), 0) as total_amount_paise,
  'Post-migration target: 0 rows (No cancelled bill should have payment_status = paid)' as expectation
from public.bills b
where b.status = 'cancelled'
  and coalesce((to_jsonb(b)->>'payment_status'), '') = 'paid'

union all

select
  'Multiple-Bill Preflight Gate: Orders with > 1 Associated Bill' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(order_bill_count), 0) as total_amount_paise,
  'Pre-migration gate: 0 rows (Fail closed if > 0)' as expectation
from (
  select order_id, count(*) as order_bill_count
  from public.bills
  group by order_id
  having count(*) > 1
) mb

union all

select
  'Multiple-Bill Preflight Gate: Orders with Both Issued & Cancelled Bills' as diagnostic_case,
  count(*) as affected_row_count,
  0 as total_amount_paise,
  'Pre-migration gate: 0 rows (Fail closed if > 0)' as expectation
from (
  select order_id
  from public.bills
  group by order_id
  having count(*) filter (where status = 'issued') > 0
     and count(*) filter (where status = 'cancelled') > 0
) mixed

union all

select
  'Multiple-Bill Preflight Gate: Orders with Multiple Issued Bills' as diagnostic_case,
  count(*) as affected_row_count,
  0 as total_amount_paise,
  'Pre-migration gate: 0 rows (Fail closed if > 0)' as expectation
from (
  select order_id
  from public.bills
  where status = 'issued'
  group by order_id
  having count(*) > 1
) multi_issued;


-- =============================================================================
-- 9D. Detailed Diagnostics: Ambiguous Multiple-Bill Detection
-- Invariant: Every order must have at most 1 bill to avoid non-deterministic
-- updates during migration 0018. If any rows are returned below, migration 0018
-- will fail closed with URB:ambiguous_multiple_bills_detected.
-- =============================================================================

-- 9D-1. List of all orders with > 1 bill
select
  b.order_id,
  count(*) as total_bills,
  count(*) filter (where b.status = 'issued') as issued_count,
  count(*) filter (where b.status = 'cancelled') as cancelled_count,
  array_agg(b.bill_number order by b.created_at) as bill_numbers,
  array_agg(b.status order by b.created_at) as bill_statuses,
  array_agg(b.total_paise order by b.created_at) as bill_totals_paise
from public.bills b
group by b.order_id
having count(*) > 1;

-- 9D-2. Orders with both issued and cancelled bills
select
  b.order_id,
  count(*) filter (where b.status = 'issued') as issued_count,
  count(*) filter (where b.status = 'cancelled') as cancelled_count,
  array_agg(b.bill_number order by b.created_at) as bill_numbers
from public.bills b
group by b.order_id
having count(*) filter (where b.status = 'issued') > 0
   and count(*) filter (where b.status = 'cancelled') > 0;

-- 9D-3. Orders with multiple issued bills
select
  b.order_id,
  count(*) as issued_count,
  array_agg(b.bill_number order by b.created_at) as bill_numbers,
  array_agg(b.total_paise order by b.created_at) as bill_totals_paise
from public.bills b
where b.status = 'issued'
group by b.order_id
having count(*) > 1;


-- =============================================================================

-- 9E. Current Approved Accounting Snapshot (read-only; refresh immediately before migration)
-- The 2026-10-30 baseline file predates the cancellation of UB-01041.
-- Latest read-only reconciliation on 2026-10-31:
--   Cancelled QR/manual bills: 18 / 491,100 paise (₹4,911).
--   Issued discounted manual bills: 4 / 16,300 paise discount (₹163).
--   Unbilled cancelled orders: 4 / 147,600 paise (₹1,476).
--   Unbilled completed orders: 3 / 38,700 paise (₹387).
-- These are a dated checkpoint, not hard-coded expected values for future days.
select
  'Current cancelled QR/manual bills (latest verified 2026-10-31)' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(b.total_paise), 0) as total_amount_paise,
  'Latest verified: 18 rows / 491,100 paise; cancelled payments remain unknown, not assumed refunded.' as expectation
from public.bills b
where b.status = 'cancelled'
  and b.order_source in ('qr', 'manual')

union all

select
  'Current issued discounted manual bills (latest verified 2026-10-31)' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise - b.total_paise), 0) as total_amount_paise,
  'Latest verified: 4 rows / 16,300 paise discount; migration reconciles paid balances to billed totals.' as expectation
from public.bills b
join public.orders o on o.id = b.order_id
where b.status = 'issued'
  and b.order_source = 'manual'
  and o.total_paise > b.total_paise;

-- 10. Audit Events & Table Health Check
-- Confirms existing billing audit events and profiles are intact.
-- =============================================================================
select
  (select count(*) from public.admin_profiles) as admin_profile_count,
  (select count(*) from public.orders) as total_order_count,
  (select count(*) from public.order_items) as total_order_item_count,
  (select count(*) from public.bills) as total_bill_count,
  (select count(*) from public.bill_audit_events) as total_audit_event_count,
  (select count(*) from public.menu_items) as total_menu_item_count;
