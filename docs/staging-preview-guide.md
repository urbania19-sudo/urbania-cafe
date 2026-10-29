# Urbania Café — Staging Database & Vercel Preview Billing Guide

This guide documents how to safely configure and use an isolated Supabase staging database for Vercel Preview deployments, details the complete database migration sequence (0001–0026), explains financial and refund safety behaviors, and outlines the required verification gates before production release.

---

## 1. Safety Architecture & Fail-Closed Guard

Urbania Café enforces a strict fail-closed write-safety policy (`src/lib/preview-guard.ts`):

- **Production (`VERCEL_ENV=production`)**: Normal café operations permitted against the production database (`rexeyagnvssvjlukjcbd`).
- **Local Development (`VERCEL_ENV` undefined)**: Normal operations permitted against local Docker Supabase (`http://127.0.0.1:54321`).
- **Vercel Preview (`VERCEL_ENV=preview`)**: All database mutations (`POST`, `PATCH`, `PUT`, `DELETE`) are **blocked by default** (`HTTP 403 PREVIEW_READ_ONLY`) when Preview deployments share or inherit the production database.
- **Preview Demo Mode**: When Preview lacks isolated staging credentials, synthetic in-memory fixtures (`src/lib/demo-fixtures.ts`) render the admin dashboard, staff queue, demo QR menus, and sample receipts safely without connecting to any database.

### Preview Write Requirements
Preview deployments are permitted to perform write operations **only** when all of the following conditions are simultaneously verified:

1. `VERCEL_ENV === 'preview'`
2. `ISOLATED_STAGING_DB=true` explicitly confirms that an isolated staging project is configured.
3. `ALLOW_PREVIEW_WRITES=true` explicitly enables writes for testing.
4. `BLOCK_PREVIEW_WRITES` is unset or not `true`.
5. No configured database connection URL (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_INTERNAL_URL`, `SUPABASE_URL`, `POSTGRES_URL`, `DATABASE_URL`) matches or contains the known production project reference (`rexeyagnvssvjlukjcbd`).
6. No configured database connection matches `PRODUCTION_SUPABASE_URL` or `PRODUCTION_DATABASE_URL`.
7. All configured candidate URLs point to the same consistent staging database target. Missing or unrecognized database targets fail closed.

### Supabase Auth Proxy Security Boundary (`/api/supabase/[...path]`)
When Preview deployments share or inherit production configuration (read-only preview mode):
- **Permitted Session Authentication Operations:** Staff sign-in (`POST /auth/v1/token?grant_type=password`), session token refresh (`POST /auth/v1/token?grant_type=refresh_token`), logout (`POST /auth/v1/logout`), and user checks (`GET /auth/v1/user`) remain available so staff can log in to view orders and test read-only workflows.
- **Blocked Directory & Data Mutations:** Any operation mutating the user directory (`POST /auth/v1/signup`, `PUT /auth/v1/user`, `auth/v1/admin/*`), along with all database table writes and RPC calls (`/rest/v1/*`, `/rpc/*`), are intercepted and blocked with `HTTP 403 PREVIEW_READ_ONLY`. This ensures a misconfigured Preview deployment can never register new users, alter existing user credentials, or modify café records in a production Supabase project.
- **In Isolated Staging Mode:** Once all isolated staging safety conditions are satisfied, write operations are safely permitted against the staging project.

> [!CAUTION]
> **Never set `ALLOW_PREVIEW_WRITES=true` or `ISOLATED_STAGING_DB=true` in Preview if any connection URL points to the production Supabase database.**
> **Production database changes require explicit release approval. Never execute production migrations from preview or local test environments.**

---

## 2. Complete Database Migration Inventory (0001–0026)

The repository contains 26 chronological migrations in `supabase/migrations/`. Migrations must be applied strictly in this numerical order:

| # | Migration File | Description & Schema Changes | Required RPCs & Triggers |
|---|---|---|---|
| **0001** | `202610160001_initial.sql` | Baseline schema: tables (`cafe_tables`, `menu_categories`, `menu_items`, `menu_item_options`, `orders`, `order_items`), baseline RLS. | `place_public_order()` |
| **0002** | `202610160002_staff_roles.sql` | Staff authorization: creates `admin_profiles` table, assigns `staff`, `admin`, `owner` roles. | `is_staff()`, `is_admin()`, `is_owner()` |
| **0003** | `202610160003_protect_table_tokens.sql` | Security hardening: restricts QR table tokens from public inspection. | — |
| **0004** | `202610160004_order_guest_details.sql` | Customer metadata: adds `customer_name`, `customer_note`, `guest_count` to orders. | Updated `place_public_order()` |
| **0005** | `202610160005_staff_profile_access.sql` | RLS policy: allows staff accounts to read their own profile row. | — |
| **0006** | `202610160006_staff_reject_edit.sql` | Order adjustments: staff order rejection and item quantity edits. | `update_staff_order_status()`, `edit_order_items()` |
| **0007** | `202610200007_billing_and_fssai.sql` | Billing core: creates `bills` table, `cafe_settings` (FSSAI, GST, bill formatting). | `generate_bill()`, `get_bill_for_order()` |
| **0008** | `202610200008_align_admin_and_storage_policies.sql` | Storage RLS: restricts menu image uploads to authorized admin profiles. | — |
| **0009** | `202610210009_billing_audit_and_manual_orders.sql` | Audit & Manual: creates `bill_audit_events`, bill reprint tracking, bill voiding/cancellation, and staff manual order creation. | `record_bill_reprint()`, `cancel_bill()`, `create_manual_order()` |
| **0010** | `202610210010_harden_billing_audit_events.sql` | Audit immutability: trigger preventing UPDATE or DELETE on `bill_audit_events`. | Trigger: `bill_audit_events_immutable` |
| **0011** | `202610220011_edit_order_items_and_status_transitions.sql` | Status transitions: order item validation and direct status advancement. | Updated `edit_order_items()` |
| **0012** | `202610240012_bill_level_discounts.sql` | Discounts: adds `discount_type`, `discount_value`, `discount_paise`, `subtotal_before_discount_paise` to `bills`. | Updated `generate_bill()` with discount params |
| **0013** | `202610250013_custom_items_in_order_edit.sql` | Custom items: supports off-menu custom items and price overrides in order edits. | Updated `edit_order_items()` |
| **0014** | `202610260014_incremental_kitchen_tickets.sql` | KOT batches: creates `order_kitchen_tickets` table for incremental tickets. | — |
| **0015** | `202610260015_reconcile_kitchen_ticket_acknowledgement_rpc.sql` | Kitchen sync: reconciles staff kitchen ticket acknowledgement status. | `acknowledge_kitchen_ticket()` |
| **0016** | `202610280016_operational_improvements.sql` | Operations: adds `order_source`, `payment_status` to orders/bills, creates `admin_credit_settlements`. | `settle_admin_credit_payment()`, `get_authorized_admins()` |
| **0017** | `202610280017_offline_customer_payment_methods.sql` | Customer payments: adds `payment_method` (`cash`, `upi`), creates `customer_payments` table for payment history. | `record_customer_payment()` |
| **0018** | `202610280018_payment_reconciliation_hardening.sql` | Ledger hardening: backfills legacy paid bills without inventing payment methods (unclassified), reconciles external/credit statuses, enforces append-only trigger on `customer_payments`, sets default `payment_status = 'unpaid'`. | Trigger: `customer_payments_immutable` |
| **0019** | `202610280019_orders_insert_rls_policy.sql` | Least-privilege RLS: restricts direct INSERT on orders/items; public direct inserts blocked. | RLS policy hardening |
| **0020** | `202610280020_transactional_orders_and_order_items_rls.sql` | Transactional order creation: atomic RPCs for delivery platform and admin credit orders; adds `order_has_items` helper. | `create_external_platform_order()`, `create_admin_credit_order()`, `order_has_items()` |
| **0021** | `202610280021_rls_append_protection_and_status_hardening.sql` | Security definer helper: makes `order_has_items` security definer, hardens check constraints on payment_status and order_source. | Hardened `order_has_items()` |
| **0022** | `202610280022_revoke_public_order_has_items.sql` | Privilege restriction: revokes `order_has_items` execution from `PUBLIC` and `anon`. | Grants only to `authenticated` and `service_role` |
| **0023** | `202610280023_restrict_order_creation_rpc_execution.sql` | Privilege restriction: revokes `create_external_platform_order` and `create_admin_credit_order` from `PUBLIC` and `anon`. | Grants only to `authenticated` and `service_role` |
| **0024** | `202610290024_option_snapshot_price_consistency.sql` | Price consistency: cross-menu and unavailable option validation, guarantees option price delta parity across snapshots and order totals. | Updated `place_public_order()`, `create_admin_credit_order()`, etc. |
| **0025** | `202610290025_admin_credit_order_idempotency.sql` | Concurrency & Idempotency: enforces mandatory UUID idempotency keys on admin credit orders with PostgreSQL transaction advisory locking (`pg_advisory_xact_lock`). | Updated `create_admin_credit_order()` |
| **0026** | `202610290026_admin_credit_payload_hash.sql` | Payload fingerprinting: SHA-256 fingerprinting stored in `orders.idempotency_hash`; detects payload tampering on retried keys (HTTP 409) and fails closed on unhashed legacy rows. | Updated `create_admin_credit_order()` |

---

## 3. Financial & Refund Safety Rules

### Supported vs. Unsupported Refund Operations
Urbania Café strictly distinguishes between **voiding/cancelling a bill** and **returning money to a customer**:

- **Bill Cancellation / Voiding (SUPPORTED)**:
  - Accessible via `POST /api/admin/bills/[billId]/cancel` using the `cancel_bill` RPC.
  - Voids an issued bill (`bills.status = 'cancelled'`) and marks the linked order `CANCELLED`.
  - Records a permanent, immutable audit event in `bill_audit_events`.
  - Intended for wrong punches, order cancellations before food prep, or administrative voids.
  - Does **not** issue a refund or alter historical customer payments.

- **Direct Financial Refunds & Partial Refunds (UNSUPPORTED & REJECTED)**:
  - The café operates without an append-only refund transaction ledger.
  - Partial refunds, negative payment adjustments, and manual status rewrites to `'refunded'` are **strictly unsupported**.
  - All payment mutation endpoints (`/api/staff/bills/[billId]/payment`, `/api/admin/bills/[billId]/cancel`, `/api/admin/credit-orders/settle`) explicitly reject any request containing refund flags (`action: "refund"`, `refund: true`, `is_refund: true`, `refund_amount_paise`, negative amounts) with `HTTP 400 Bad Request`.
  - Direct updates or deletions on `customer_payments` are blocked by the database trigger `prevent_customer_payment_mutation()`.
  - Any future refund capability requires a dedicated append-only refund ledger migration (e.g. `customer_refunds` table) and business review.

### Cash & Online/UPI Reconciliation Rules
1. **Separation of Payment Methods**:
   - `customer_payments.payment_method` is strictly `'cash'`, `'upi'`, `'card'`, or `'other'`.
   - Collections are grouped and displayed independently: Cash Collected vs. Online/UPI Collected.
2. **Unclassified Legacy Collections**:
   - Historical bills issued before migration 0016 have `payment_method = NULL`.
   - Reports (`src/lib/reports.ts`) treat these as **unclassified** collections.
   - Code must **never** fabricate or assume legacy collections were Cash or UPI.
3. **Reversal & Refund Accounting in Reports**:
   - If a `customer_payments` row carries `status = 'refunded'`, it is excluded from gross/net receipts.
   - It is displayed in `customerRefundsPaise` for audit purposes but is **never subtracted a second time** from net collections (preventing double-deduction).
4. **Timezone Boundaries**:
   - All financial and audit daily metrics adhere to **Asia/Kolkata (IST, UTC+05:30)** business day boundaries (from 18:30 UTC previous day to 18:29:59.999 UTC current day).
5. **Fail-Closed Reporting**:
   - Unexpected database errors during metrics computation throw exceptions instead of returning misleading zero-filled reports.

---

## 4. Local Database Verification Before Testing

Before running any database test or migration, verify your local database target to guarantee that tests never contact an external or production database:

### Verification Preconditions
1. **Inspect `.env.local`**:
   Ensure `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_INTERNAL_URL` point strictly to:
   ```text
   http://127.0.0.1:54321
   ```
2. **Fail-Closed Host Check**:
   Automated integration tests (`tests/financial-workflow-integration.test.ts` and `tests/rls-authorization.test.ts`) enforce a strict hostname check:
   ```ts
   const isLocal =
     urlObj.hostname === 'localhost' ||
     urlObj.hostname === '127.0.0.1' ||
     urlObj.hostname === '[::1]' ||
     urlObj.hostname === '0.0.0.0';
   if (!isLocal) throw new Error('SECURITY CHECK FAILED: Prohibited from running against non-local environments');
   ```
3. **No Destructive Commands**:
   - Do **NOT** run `supabase db reset`, `DROP TABLE`, or `TRUNCATE`.
   - Tests must create ephemeral test records and clean them up safely in `afterAll()`.

---

## 5. Automated Verification Suites

The repository contains 38 test suites covering 469 automated tests:

### Test Breakdown
- **Real Local Database Integration Tests (Requires local Supabase on 127.0.0.1:54321)**:
  - `tests/financial-workflow-integration.test.ts`: Verifies bill generation default unpaid status, partial payments, overpayment rejection, idempotency key conflicts and replays, payment ledger append-only immutability, bill cancellation, paying cancelled bills rejection, admin credit creation and settlement, reporting metrics reconciliation, and API route refund rejections.
  - `tests/rls-authorization.test.ts`: Verifies PostgreSQL RLS policies, transactional RPCs, option pricing parity, tamper detection via SHA-256 idempotency hash, and privilege boundaries.
- **Unit & Mocked Workflow Tests**:
  - `tests/offline-customer-payments.test.ts`: Unit tests for payment calculations, thermal canvas rendering, and reporting reconciliation boundaries.
  - `tests/operational-improvements.test.ts`: Unit tests for admin credit calculation and settlement logic.
  - `tests/preview-demo-mode.test.tsx`: Synthetic fixtures and demo mode UI isolation.
  - `tests/preview-guard-and-audit-security.test.ts`: Fail-closed write guard security tests.
  - `tests/rpc-fallback-safety.test.ts`: Fail-closed behavior on missing RPCs.
  - `tests/excel-export.test.ts` & `tests/csv-export.test.ts`: Deterministic export pagination and schema envelope validation.

### Required Quality Gate Commands
All four commands must pass cleanly before considering any release candidate:
```bash
npm test -- --run      # 469/469 tests pass
npm run typecheck       # TypeScript compilation passes with 0 errors
npm run lint            # ESLint passes (only pre-existing next/image warnings)
npm run build           # Next.js production build succeeds
```

---

## 6. Setting Up an Isolated Staging Supabase Project

### Step 1: Create a Staging Supabase Project
1. Log in to [Supabase](https://supabase.com/dashboard).
2. Click **New Project** and name it `urbania-cafe-staging` (choose region `ap-south-1` Mumbai to match production).
3. Set a strong database password and save it securely.

### Step 2: Retrieve API Keys
In Supabase Dashboard, navigate to **Project Settings** → **API**:
- **Project URL**: `https://<staging-ref>.supabase.co`
- **Project API Keys**: `anon` public key and `service_role` secret key.

### Step 3: Apply Migrations in Sequence
In the Supabase SQL Editor for the **staging project only**, execute migrations 0001 through 0026 in exact chronological sequence.

### Step 4: Seed Staging Data
Run `supabase/seed.sql` in the staging SQL editor:
- Creates the 5 standard café tables (Tables 1 through 5) with active QR tokens.
- Populates standard menu categories and items with integer-paise pricing.

### Step 5: Create Staging Accounts
Create owner (`owner@staging.urbania.cafe`) and staff (`staff@staging.urbania.cafe`) accounts in Supabase Auth, and assign their roles in `public.admin_profiles`.

---

## 7. Configuring Vercel Preview Environment Variables

In Vercel Dashboard → **Settings** → **Environment Variables** (check **ONLY Preview**):

| Variable Name | Environment | Value | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Preview** | `https://<staging-ref>.supabase.co` | Staging Supabase project URL |
| `SUPABASE_INTERNAL_URL` | **Preview** | `https://<staging-ref>.supabase.co` | Server-side Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Preview** | `<staging-anon-key>` | Staging anon public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Preview** | `<staging-service-role-key>` | Staging service-role secret key |
| `ISOLATED_STAGING_DB` | **Preview** | `true` | Confirms database is isolated staging |
| `ALLOW_PREVIEW_WRITES` | **Preview** | `true` | Enables Preview mutation endpoints |
| `BLOCK_PREVIEW_WRITES` | **Preview** | *(leave unset)* | Failsafe kill switch |
| `PRODUCTION_SUPABASE_URL` | **Preview** | `https://rexeyagnvssvjlukjcbd.supabase.co` | Used for production-target collision checks |
| `EXCEL_EXPORT_TOKEN` | **Preview** | `<random-staging-token>` | (Optional) Token for Preview Excel tests |

---

## 8. Release Verification Checklist & Pending Items

### Verified in Current Candidate
- [x] All 26 migrations statically analyzed, ordered, and reconciled.
- [x] Local PostgreSQL integration tests verified against local Supabase (`127.0.0.1:54321`).
- [x] Unpaid default payment status on bill generation verified.
- [x] Partial and full Cash & UPI payment workflows verified with immutable ledger protection.
- [x] Explicit rejection of unsupported refund operations on payment, cancel, and settle endpoints verified.
- [x] Administrative bill cancellation verified;paying cancelled bills blocked.
- [x] Idempotency replay and conflict detection verified on customer payments and admin credit orders.
- [x] Asia/Kolkata timezone reconciliation verified.
- [x] Preview Demo Mode with synthetic fixtures verified fail-closed.
- [x] 469/469 automated tests pass. TypeScript, ESLint, and Next.js production build pass.

### Items Requiring External / Business Action (Remaining Blockers)
- [ ] **Dedicated Isolated Staging Supabase Database**: A live, isolated Supabase project has not yet been provisioned by the owner. End-to-end cloud testing requires provisioning this project and setting Preview environment variables.
- [ ] **Physical Thermal Printer Hardware**: Thermal receipt canvas rendering is verified via jsdom/canvas, but ESC/POS raw raster stream compatibility with the physical Bluetooth/USB thermal printer requires on-site hardware verification.
- [ ] **Production Migration Deployment**: Migrations 0007–0026 have not been applied to production Supabase (`rexeyagnvssvjlukjcbd`). Applying migrations requires explicit release approval and scheduled maintenance.
- [ ] **Full Refund Ledger Specification**: If the business requires partial or full cash/UPI refund tracking in the future, a dedicated schema migration and product specification must be designed.
