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
-- Pending release migrations: 0016 through 0026.
-- =============================================================================
select
  version,
  inserted_at,
  case
    when version <= '202610260015' then 'APPLIED_BASELINE'
    when version between '202610280016' and '202610290026' then 'RELEASE_CANDIDATE_MIGRATION'
    else 'UNKNOWN_MIGRATION'
  end as release_status
from supabase_migrations.schema_migrations
order by version desc;

-- Count summary of migrations
select
  count(*) as total_applied_migrations,
  max(version) as latest_applied_version,
  case
    when max(version) = '202610260015' then 'READY_FOR_0016_0026 (Stopped at 0015)'
    when max(version) >= '202610290026' then 'MIGRATIONS_ALREADY_APPLIED (0026+)'
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
    'billing_audit_events',
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
    'is_admin',
    'is_staff',
    'cancel_bill',
    'place_public_order',
    'create_manual_order'
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
-- Migrations 0022 and 0023 revoke execute from public and anon on critical RPCs.
-- =============================================================================
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  case
    when has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname in (
      'settle_admin_credit_payment',
      'record_customer_payment',
      'create_external_platform_order',
      'create_admin_credit_order',
      'order_has_items',
      'cancel_bill',
      'create_manual_order'
    ) then 'FAIL: SENSITIVE RPC CALLABLE BY ANON'
    when not has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname in (
      'settle_admin_credit_payment',
      'record_customer_payment',
      'create_external_platform_order',
      'create_admin_credit_order',
      'order_has_items',
      'cancel_bill',
      'create_manual_order'
    ) then 'PASS: RESTRICTED FROM ANON'
    when p.proname = 'place_public_order' then 'INFO: PUBLIC CUSTOMER QR ORDER RPC'
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
    'cancel_bill',
    'place_public_order',
    'create_manual_order'
  )
order by p.proname;


-- =============================================================================
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
  and tablename in ('orders', 'order_items', 'bills', 'customer_payments', 'admin_credit_settlements')
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
  'Expected Pre: 1 row (25,800 paise / ₹258). Expected Post: payment_status = paid, paid_paise = 25,800' as expectation
from public.orders o
where o.order_source in ('qr', 'manual')
  and o.status = 'COMPLETED'
  and exists (select 1 from public.bills b where b.order_id = o.id and b.status = 'issued')

union all

select
  'Finding 2: Issued Manual Bills where Order Total > Bill Total (Discounts)' as diagnostic_case,
  count(*) as affected_row_count,
  coalesce(sum(o.total_paise - b.total_paise), 0) as total_amount_paise,
  'Expected Pre: 5 rows (21,200 paise / ₹212 diff). Expected Post: orders.paid_paise = bills.total_paise' as expectation
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
  'Expected Pre: 17 rows (481,100 paise / ₹4,811). Expected Post: payment_status = NULL, paid_paise = 0' as expectation
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
  and coalesce((to_jsonb(b)->>'payment_status'), '') = 'paid';


-- =============================================================================
-- 10. Audit Events & Table Health Check
-- Confirms existing billing audit events and profiles are intact.
-- =============================================================================
select
  (select count(*) from public.admin_profiles) as admin_profile_count,
  (select count(*) from public.orders) as total_order_count,
  (select count(*) from public.order_items) as total_order_item_count,
  (select count(*) from public.bills) as total_bill_count,
  (select count(*) from public.billing_audit_events) as total_audit_event_count,
  (select count(*) from public.menu_items) as total_menu_item_count;
