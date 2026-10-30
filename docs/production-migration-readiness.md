# Urbania Café — Production Database Migration Readiness & Runbook

**Document Version:** 1.6.0 (Approved Accounting Treatment & Security Migration 0027)<br />
**Release Candidate Commit:** Current head of `feat/operational-improvements`; see [PR #8](https://github.com/urbania19-sudo/urbania-cafe/pull/8) for the exact SHA.<br />
**Application Release Branch:** `feat/operational-improvements` (PR #8)<br />
**Security Hardening Branch:** `chore/release-security-hardening` (separate review branch; not merged)<br />
**Pull Request:** [#8 (feat: operational improvements)](https://github.com/urbania19-sudo/urbania-cafe/pull/8)<br />
**Production Supabase Reference:** `asdrrunxpsqzbvswmzgv`<br />
**Production Vercel Branch:** `main`<br />
**Vercel Preview Deployment:** Use the latest READY deployment for the current branch head from the [Vercel project](https://vercel.com/urbania19-sudo/urbania-cafe).

---

## 1. Executive Summary & Verdict

### Current Verdict: 🔴 STRICT NO-GO FOR PRODUCTION EXECUTION

While the application software, UI components, mobile dialogs, and TypeScript backend in PR #8 are fully verified and passing all integration suites on a disposable container, **production database migration execution is strictly gated and must NOT proceed until mandatory pre-requisites are fulfilled by the repository and database owners**.

```
+-----------------------------------------------------------------------------------------------+
|                                    VERDICT: NO-GO                                             |
+-----------------------------------------------------------------------------------------------+
|  1. Current feature-branch release candidate: VERIFIED & READY                                 |
|  2. Migrations 0016–0026: previously rehearsed; Migration 0027: NOT YET REHEARSED              |
|  3. Production Preflight Inspection: SCRIPT PREPARED (supabase/preflight-production-release.sql)|
|  4. Production Database asdrrunxpsqzbvswmzgv: UNPREPARED (Stopped at 0015)                    |
|  5. Verified Cold/Hot Backup & Restore: PENDING OWNER EXECUTION                               |
|  6. Formal Maintenance Window & Change Approval: PENDING OWNER SIGN-OFF                       |
|  7. Historical Accounting Treatment: OWNER APPROVED 2026-10-31                                |
+-----------------------------------------------------------------------------------------------+
```

### Why Production Execution is Currently Blocked:
1. **Unapplied Migration Delta:** Production Supabase project `asdrrunxpsqzbvswmzgv` currently stops at migration `202610260015`. Migrations `0016` through `0027` (12 distinct migration files) have not yet been applied.
2. **Missing Financial Infrastructure:** In production, `public.customer_payments`, `public.admin_credit_settlements`, `orders.payment_status`, and `bills.paid_paise` do not exist. Any direct deployment of PR #8 code to production without applying the database migrations will result in immediate runtime errors for billing and order workflows.
3. **Backup / Recovery Point Pending:** An encrypted logical PostgreSQL archive exists in restricted business Drive storage, but it does not include managed Auth, storage binary objects, or complete Supabase configuration. Supported restore readiness and pre-release backup verification are not yet complete.
4. **Append-Only Trigger Safety:** Migration 0018 installs an immutable trigger preventing deletion/updates to `customer_payments`. Applying this requires scheduled maintenance authorization.
5. **Historical Accounting Treatment:** Owner approved on 2026-10-31 that cancelled bills remain unknown/unreconciled, issued discounted bills reconcile to actual issued bill totals, and unbilled orders remain unpaid. The post-baseline cancellation of bill `UB-01041` is recorded in Section 7; it is not evidence of a refund.

---

## 2. Production Project Reference & Recorded Migration History

- **Confirmed Supabase Project Reference:** `asdrrunxpsqzbvswmzgv`
- **Hosted Environment Region:** `ap-south-1` (AWS Mumbai)
- **Supabase Migration Tracking Table:** `supabase_migrations.schema_migrations`
- **Last Recorded Migration on Production:**
  `202610260015_reconcile_kitchen_ticket_acknowledgement_rpc.sql`
- **Pending Migrations to Apply (in strict chronological sequence):**
  1. `202610280016_operational_improvements.sql` *(Updated: default 'unpaid', nullable check)*
  2. `202610280017_offline_customer_payment_methods.sql`
  3. `202610280018_payment_reconciliation_hardening.sql` *(Corrected: authoritative backfill across findings 1, 2, 3)*
  4. `202610280019_orders_insert_rls_policy.sql`
  5. `202610280020_transactional_orders_and_order_items_rls.sql`
  6. `202610280021_rls_append_protection_and_status_hardening.sql`
  7. `202610280022_revoke_public_order_has_items.sql`
  8. `202610280023_restrict_order_creation_rpc_execution.sql`
  9. `202610290024_option_snapshot_price_consistency.sql`
  10. `202610290025_admin_credit_order_idempotency.sql`
  11. `202610290026_admin_credit_payload_hash.sql`
  12. `202610310027_role_helper_and_rpc_permission_hardening.sql`

---

## 3. Current-vs-Expected Schema Matrix

| Object Category | Target Object Name | Current Production State | Target Expected State | Migration Ref |
|---|---|---|---|---|
| **Tables** | `public.customer_payments` | ❌ **ABSENT** | ✅ Created with RLS, immutable trigger, foreign keys | `0017`, `0018` |
| **Tables** | `public.admin_credit_settlements` | ❌ **ABSENT** | ✅ Created with RLS, foreign keys | `0016` |
| **Tables** | `public.orders` | ⚠️ Missing columns | ✅ Extended with payment & delivery columns | `0016`, `0017`, `0026` |
| **Tables** | `public.bills` | ⚠️ Missing columns | ✅ Extended with payment & delivery columns | `0016`, `0017` |
| **Columns** | `orders.payment_status` | ❌ **ABSENT** | ✅ `text DEFAULT 'unpaid' CHECK (is null or in 'unpaid','partially_paid','paid','external')` | `0016`, `0018` |
| **Columns** | `orders.paid_paise` | ❌ **ABSENT** | ✅ `int NOT NULL DEFAULT 0 CHECK (paid_paise >= 0)` | `0016` |
| **Columns** | `orders.payment_method` | ❌ **ABSENT** | ✅ `text CHECK (in 'cash','upi','online','card','other')` | `0017` |
| **Columns** | `orders.admin_user_id` | ❌ **ABSENT** | ✅ `uuid REFERENCES auth.users(id)` | `0016` |
| **Columns** | `orders.external_platform_name` | ❌ **ABSENT** | ✅ `text` | `0016` |
| **Columns** | `orders.external_platform_ref` | ❌ **ABSENT** | ✅ `text` | `0016` |
| **Columns** | `orders.idempotency_hash` | ❌ **ABSENT** | ✅ `text` (SHA-256 fingerprint) | `0026` |
| **Columns** | `bills.payment_status` | ❌ **ABSENT** | ✅ `text DEFAULT 'unpaid' CHECK (is null or in 'unpaid','partially_paid','paid','external')` | `0016`, `0018` |
| **Columns** | `bills.paid_paise` | ❌ **ABSENT** | ✅ `int NOT NULL DEFAULT 0 CHECK (paid_paise >= 0)` | `0016` |
| **Columns** | `bills.payment_method` | ❌ **ABSENT** | ✅ `text CHECK (in 'cash','upi','online','card','other')` | `0017` |
| **Columns** | `bills.admin_user_id` | ❌ **ABSENT** | ✅ `uuid REFERENCES auth.users(id)` | `0016` |
| **RPC Functions** | `get_authorized_admins()` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Authenticated only) | `0016` |
| **RPC Functions** | `settle_admin_credit_payment(...)` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Authenticated admin only) | `0016` |
| **RPC Functions** | `record_customer_payment(...)` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Authenticated staff only) | `0017` |
| **RPC Functions** | `create_external_platform_order(...)` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Restricted from public/anon) | `0020`, `0023`, `0024` |
| **RPC Functions** | `create_admin_credit_order(...)` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Restricted from public/anon) | `0020`, `0024`, `0025`, `0026` |
| **RPC Functions** | `order_has_items(uuid)` | ❌ **ABSENT** | ✅ `SECURITY DEFINER` (Restricted from public/anon) | `0021`, `0022` |
| **RPC / RLS Security** | `has_role(uuid, app_role)` and `is_staff(uuid)` | ⚠️ Legacy helpers query `user_roles` and accept arbitrary IDs | ✅ Self-only checks sourced from `admin_profiles`; anon execution revoked | `0027` |
| **RLS Policies** | Staff/admin read and write policies | ⚠️ Several policies target `PUBLIC` | ✅ Restricted to `authenticated`; anonymous active-category browsing retained | `0027` |
| **RPC Functions** | `prevent_customer_payment_mutation()`| ❌ **ABSENT** | ✅ Trigger procedure raising exception on edit/delete | `0018` |
| **Triggers** | `customer_payments_immutable` | ❌ **ABSENT** | ✅ BEFORE UPDATE OR DELETE on `customer_payments` | `0018` |
| **RLS Policies** | `orders` insert policy | ⚠️ Legacy permissive | ✅ Hardened least-privilege insert policy | `0019` |
| **RLS Policies** | `order_items` insert policy | ⚠️ Legacy permissive | ✅ Hardened insert policy guarded by `order_has_items`| `0020`, `0021` |
| **RLS Policies** | `customer_payments` RLS | ❌ **ABSENT** | ✅ Enabled; staff read; mutations blocked | `0017`, `0018` |
| **RLS Policies** | `admin_credit_settlements` RLS | ❌ **ABSENT** | ✅ Enabled; admin manage | `0016` |
| **Indexes** | `orders_admin_credit_idx` | ❌ **ABSENT** | ✅ Partial index on `orders` for admin credit | `0016` |
| **Indexes** | `orders_external_platform_idx` | ❌ **ABSENT** | ✅ Partial index on `orders` for Swiggy/Zomato | `0016` |
| **Indexes** | `customer_payments_*_idx` | ❌ **ABSENT** | ✅ Bill, Order, Date, Method indexes | `0017` |

---

## 4. Migration Corrections & Detailed Inventory (0016–0026)

### Key Revisions Implemented in Migrations 0016 & 0018:
1. **Migration 0016 Column Definition:**
   - Changed `payment_status` default from `'paid'` (which poisoned historical rows) to `'unpaid'`.
   - Allowed `payment_status` to be nullable (`CHECK (payment_status is null or payment_status in ('unpaid', 'partially_paid', 'paid', 'external'))`).
2. **Migration 0018 Authoritative Backfill Corrections:**
   - **Finding 1 Fix:** Only QR/manual orders with an **issued bill** (`b.status = 'issued'`) are marked paid. Unbilled orders (cancelled without bill, completed without bill, active) strictly remain `payment_status = 'unpaid'` and `paid_paise = 0`.
   - **Finding 2 Fix:** Order paid balance is set using `b.total_paise` (the actual issued bill total, after any bill-level discount), NOT `o.total_paise`. If a discount was applied at bill issuance (`b.total_paise < o.total_paise`), order and bill paid balances agree exactly, eliminating the 21,200 paise (₹212) discrepancy across 5 manual bills.
   - **Finding 3 Fix:** Cancelled historical bills (17 bills, 481,100 paise) and their linked orders are set to `payment_status = NULL` and `paid_paise = 0`. This avoids falsely asserting that money was collected (`'paid'`) or never collected (`'unpaid'`), honestly capturing the historical uncertainty.
   - **Multiple-Bill Safety Gate & Fail-Closed Invariant:** Guarded migration 0018 against non-deterministic SQL updates by introducing an explicit pre-execution assertion. If any order is associated with more than 1 bill (`SELECT count(*) FROM public.bills GROUP BY order_id HAVING count(*) > 1`), migration 0018 immediately fails closed with `RAISE EXCEPTION 'URB:ambiguous_multiple_bills_detected'`. Additionally, Step 3 of Migration 0018 includes defense-in-depth condition `NOT EXISTS (SELECT 1 FROM public.bills b_issued WHERE b_issued.order_id = o.id AND b_issued.status = 'issued')` to prevent cancelled bills from clobbering orders with issued bills.

---

## 5. Financial Data Backfill Semantics & Accounting Interpretation

### Summary Table of Historical Reclassification Rules:

| Entity Category | Identification Predicate | Reclassified `payment_status` | Reclassified `paid_paise` | Reclassified `payment_method` | Accounting Rationale |
|---|---|---|---|---|---|
| **Issued Customer Bills** | `bills.status = 'issued'` & `order_source in ('qr', 'manual')` | `'paid'` | `bills.total_paise` | `NULL` | Pre-0016 workflow settled at bill generation; method left NULL to report as Unclassified Collection without inventing Cash/UPI. |
| **Orders Linked to Issued Bills** | `orders o` with `bills b (b.status = 'issued')` | `'paid'` | `b.total_paise` | `NULL` | Order paid balance matches actual collected bill total; pre-discount order total is preserved without fabricating cash collected. |
| **Cancelled Historical Bills** | `bills.status = 'cancelled'` & `order_source in ('qr', 'manual')` | `NULL` | `0` | `NULL` | Cancellation does not prove payment was received or refunded. `NULL` honestly records unknown/unreconciled status without false assertion. |
| **Orders Linked to Cancelled Bills** | `orders o` with `bills b (b.status = 'cancelled')` | `NULL` | `0` | `NULL` | Reflects linked bill's unreconciled state. |
| **Unbilled Orders (Cancelled)** | `orders.status = 'CANCELLED'` & no linked bill | `'unpaid'` | `0` | `NULL` | Order was cancelled before any bill was issued; no bill or payment exists. |
| **Unbilled Orders (Completed)** | `orders.status = 'COMPLETED'` & no linked bill | `'unpaid'` | `0` | `NULL` | No bill was ever generated; cannot assert collection without an authoritative billing document. |
| **External Delivery Orders / Bills** | `order_source in ('swiggy', 'zomato', 'delivery_platform')` | `'external'` | `0` | `NULL` | Aggregator collections settled on third-party remittance schedules; never counted as in-store cash collections. |
| **Admin Credit Orders / Bills** | `order_source = 'admin_credit'` | `'unpaid'` | `0` | `NULL` | Internal owner/admin receivables until settled via `admin_credit_settlements`. |

---

## 6. Pre-Migration Baseline Queries & Expected Counts

The database operator must rerun [`supabase/preflight-production-release.sql`](../supabase/preflight-production-release.sql) in the Supabase SQL Editor on `asdrrunxpsqzbvswmzgv` immediately before any approved migration. The read-only baseline captured on 2026-10-30 is archived in [`docs/production-baseline-2026-10-30.md`](production-baseline-2026-10-30.md). All 13 read-only statements were executed individually without SQL errors; this is a point-in-time baseline, not permission to migrate.

### Expected Pre-Migration Diagnostic Findings on Production:

1. **Finding 1 — Unbilled Orders:**
   - Cancelled QR/Manual orders without bill: **4 rows**, total **147,600 paise** (₹1,476).
   - Completed QR/Manual orders without bill: **3 rows**, total **38,700 paise** (₹387).
   - Completed QR/Manual orders with issued bills: **24 rows**, total **663,500 paise** (₹6,635): one QR order worth **25,800 paise** and 23 manual orders worth **637,700 paise**.
   - *Pre-migration unbilled population:* 7 orders, 186,300 paise; all remain `unpaid` with `paid_paise = 0`.
   - *Post-migration expectation:* The 24 issued-bill-linked orders are reconciled to their issued bill totals; unbilled orders remain unpaid. These are point-in-time figures and must be rechecked before migration.
2. **Finding 2 — Discounted Manual Bills:**
   - Archived 2026-10-30 baseline: **5 issued manual bills**, aggregate discount delta **21,200 paise** (₹212). After UB-01041 was cancelled, latest verified live population: **4 issued discounted manual bills**, aggregate discount delta **16,300 paise** (₹163).
   - *Archived baseline state:* `orders.total_paise` = **160,000 paise**; `bills.total_paise` = **138,800 paise**; difference = **21,200 paise (₹212)**. The latest issued-only live discount delta is **16,300 paise (₹163)** across 4 bills.
   - *Post-migration expectation:* for every issued bill, linked `orders.paid_paise` = `bills.paid_paise` = `bills.total_paise`; no assumption that cancelled bills were refunded or paid.
3. **Finding 3 — Cancelled Historical Bills:**
   - Cancelled historical bills: **17 rows**, total **481,100 paise** (₹4,811).
   - *Pre-migration state:* Retains invalid 0016 default `paid` with `paid_paise = 0`.
   - *Post-migration expectation:* `payment_status = NULL`, `paid_paise = 0`. False `paid` state eliminated.
4. **Post-Migration Verification Invariant:**
   - Discrepancy between `orders.paid_paise` and `bills.total_paise` on issued bills must be **0 rows** and **0 paise**.
   - Cancelled bills with `payment_status = 'paid'` must be **0 rows**.
5. **Multiple-Bill Safety Preflight Invariants (Sections 9C & 9D):**
   - Orders with > 1 associated bill must be **0 rows** (Section 9C / 9D-1).
   - Orders with both issued and cancelled bills must be **0 rows** (Section 9C / 9D-2).
   - Orders with multiple issued bills must be **0 rows** (Section 9C / 9D-3).
   - If any order violates this invariant, Migration 0018 fails closed with error code `URB:ambiguous_multiple_bills_detected`. Section 9D provides immediate diagnostic queries to inspect the offending order IDs, bill numbers, and totals.

---

## 7. Approved Historical Accounting Treatment (Owner Sign-Off: 2026-10-31)

> [!NOTE]
> **Owner accounting treatment approved on 2026-10-31.** This approval covers the migration classification rules below; it does not authorize production SQL execution, PR merge, production deployment, or a maintenance window.

| Historical population | Latest verified count / amount | Approved migration treatment |
|---|---:|---|
| Cancelled QR/manual bills | 18 / ₹4,911 | `payment_status = NULL`, `paid_paise = 0`, `payment_method = NULL` |
| Issued discounted manual bills | 4 / ₹163 aggregate discount | Reconcile paid balances to each issued bill's actual `total_paise`; never to the pre-discount order total |
| Cancelled QR/manual orders without any bill | 4 / ₹1,476 | Remain `unpaid`, `paid_paise = 0`, `payment_method = NULL` |
| Completed QR/manual orders without any bill | 3 / ₹387 | Remain `unpaid`, `paid_paise = 0`, `payment_method = NULL` |

**Important interpretation:** The earlier 2026-10-30 baseline recorded 17 cancelled bills / ₹4,811 and 5 issued discounted manual bills / ₹212. These are preserved in the archived baseline document as a dated snapshot. Subsequent cancellation of UB-01041 (Order #48) accounts for the change to 18 / ₹4,911 and 4 active issued discounted bills / ₹163. UB-01041 was issued at ₹100 after a ₹49 discount from ₹149; its audit trail shows issuance, two view/reprint events, and cancellation at approximately 18:16 IST on 2026-10-30. No refund event was found. This cancellation does not prove that a customer paid or received a refund.

The production preflight must be re-run immediately before any approved migration window. If the current counts change again, stop and refresh the reconciliation rather than relying on these checkpoint numbers.

---

## 8. Backup & Restore Readiness Checklist & Safe Verification Protocol

> [!WARNING]
> **A Default CLI or Schema-Limited SQL Dump is NOT a Complete Production Platform Backup!**
> Standard `supabase db dump` exports only user-space database objects (`public` schema) and custom database roles. It completely excludes Supabase-managed internal infrastructure:
> 1. Managed `auth` data (user accounts, encrypted credentials, active sessions, refresh tokens, MFA factors).
> 2. Managed `storage` service metadata and database records.
> 3. Binary Storage objects (menu item images, cafe branding) stored in S3 object storage.
> 4. Supabase platform-managed roles (`supabase_admin`, `authenticator`), internal extensions, and background microservices (GoTrue, PostgREST, Realtime, Kong).
> 5. Dashboard configurations (third-party OAuth providers, email templates, SMTP settings, API rate limits).
>
> **Crucial Managed-Schema Architecture Rule:**
> The standard Supabase CLI `db dump` workflow intentionally excludes managed schemas including `auth` and `storage`. Adding `-s auth` or `-s storage` to `supabase db dump` does **NOT** create a valid or restorable managed-schema/data backup. Raw table dumps of `auth` and `storage` cannot be restored into another Supabase project without breaking foreign-key references to internal platform services, token secrets, and auth provider configurations.
>
> A robust recovery strategy requires treating the four operational backup pillars separately:
> 1. **Managed Database Recovery:** Platform physical snapshots and Point-in-Time Recovery (PITR).
> 2. **Logical Application Backups:** Roles, public schema DDL, public row data, and schema customization diffs.
> 3. **Binary Storage Objects:** S3 bucket synchronization with count and integrity verification.
> 4. **Project Configuration Snapshots:** Dashboard settings, auth providers, and environment variables.

### 8.1. Platform-Managed Database Recovery (Physical Snapshots & PITR)

- [ ] **1. Verify Dashboard Daily Backups (Managed Physical Snapshots):**
  - Navigate to Supabase Dashboard: **Project `asdrrunxpsqzbvswmzgv` > Project Settings > Database > Backups**.
  - Confirm that scheduled daily physical snapshots are active and reporting healthy.
  - Note: Daily physical backups are retained for 7 days on Pro plans and have a Recovery Point Objective (RPO) of up to 24 hours.

- [ ] **2. Verify Point-in-Time Recovery (PITR) Status & Official Specifications:**
  - **Paid Add-On & Compute Requirement:** According to official Supabase documentation, Point-in-Time Recovery (PITR) is a paid add-on for Pro and Team plans that requires a **Small compute instance add-on or higher** (PITR cannot be enabled on Micro or Nano compute tiers).
  - **Replaces Daily Backups:** Enabling PITR **replaces** daily physical snapshots rather than running alongside them. Supabase ceases taking daily snapshot backups once PITR is active, as continuous Write-Ahead Log (WAL) archiving supersedes daily snapshots.
  - **Pricing & Billing:** PITR pricing depends on the configured retention period and is billed hourly (e.g., 7-day retention is ~$100/month / ~$0.139/hour; 14-day and 28-day options carry higher hourly pricing).
  - **Recovery Point Verification:** A locally generated timestamp (e.g. via PowerShell `(Get-Date).ToUniversalTime()`) is only an operator reference and does **NOT** prove that a valid PITR recovery point exists in Supabase. The operator MUST inspect the actual available recovery window in the Supabase Dashboard (**Database > Backups > Point in Time**), confirming that the current second falls cleanly within the continuous WAL recovery range before executing migrations.
  - **If PITR is NOT active on `asdrrunxpsqzbvswmzgv`:** Do not assume PITR is available. The database relies solely on daily physical snapshots (up to 24 hours RPO), making pre-migration logical dumps and verification even more critical.

### 8.2. Complete Logical Backup Strategy (Roles, Schema, Data, Customizations)

> [!IMPORTANT]
> **Secure Secret Handling:**
> Never commit connection strings, database passwords, or auth secrets to git or version-controlled scripts. Pass the connection string via an environment variable (`$env:SUPABASE_DB_URL`) or prompt securely in PowerShell:
> ```powershell
> # Prompt securely for database password and assemble connection URL
> $securePass = Read-Host -Prompt "Enter Supabase Database Password for asdrrunxpsqzbvswmzgv" -AsSecureString
> $plainPass = [System.Net.NetworkCredential]::new("", $securePass).Password
> $DbUrl = "postgresql://postgres:$([System.Uri]::EscapeDataString($plainPass))@db.asdrrunxpsqzbvswmzgv.supabase.co:5432/postgres"
> ```

The database owner should capture three distinct logical dump layers using the documented Supabase CLI commands (or direct PostgreSQL utilities):

- [ ] **3. Logical Roles & Permissions Backup:**
  - Captures custom database roles, grants, memberships, and authentication flags:
    ```powershell
    supabase db dump --db-url "$DbUrl" -f "urbania_prod_roles_$(Get-Date -Format 'yyyyMMdd_HHmm').sql" --role-only
    ```
    *Alternative using pg_dumpall with connection string:*
    ```powershell
    pg_dumpall --roles-only -d "$DbUrl" -f "urbania_prod_roles_$(Get-Date -Format 'yyyyMMdd_HHmm').sql"
    ```

- [ ] **4. Complete Logical Application Schema Dump (DDL across public schemas):**
  - Captures table structures, constraints, RLS policies, triggers, and functions in application schemas:
    ```powershell
    supabase db dump --db-url "$DbUrl" -f "urbania_prod_schema_$(Get-Date -Format 'yyyyMMdd_HHmm').sql"
    ```
    *Alternative using pg_dump in custom directory format:*
    ```powershell
    pg_dump -d "$DbUrl" --schema-only -Fc -f "urbania_prod_schema_$(Get-Date -Format 'yyyyMMdd_HHmm').dump"
    ```

- [ ] **5. Capturing User-Managed Schema Customizations on Managed Schemas (`auth`, `storage`):**
  - Standard `supabase db dump` excludes managed internal schemas (`auth`, `storage`). To capture user-defined schema customizations on these schemas—such as custom database triggers or user RLS policies on `auth.users` or `storage.objects`—use `supabase db diff`:
    ```powershell
    supabase db diff --linked --schema auth,storage -f "urbania_prod_auth_storage_customizations_$(Get-Date -Format 'yyyyMMdd_HHmm').sql"
    ```
    *Note:* This captures DDL customizations only; it does **not** export Auth user records, encrypted credentials, active sessions, or Storage metadata.

- [ ] **6. Complete Logical Application Data Dump (Table Records):**
  - Captures actual row data across user-facing tables using fast COPY statements:
    ```powershell
    supabase db dump --db-url "$DbUrl" -f "urbania_prod_data_$(Get-Date -Format 'yyyyMMdd_HHmm').sql" --use-copy --data-only
    ```
    *Alternative using pg_dump (excluding ephemeral runtime analytics schemas):*
    ```powershell
    pg_dump -d "$DbUrl" --data-only --exclude-schema _analytics --exclude-schema _realtime -Fc -f "urbania_prod_data_$(Get-Date -Format 'yyyyMMdd_HHmm').dump"
    ```

### 8.3. Storage Bucket Files & Media Assets Backup (Bucket: `menu-images`)

- [ ] **7. Supabase Storage Object Sync (Bucket: `menu-images`):**
  - PostgreSQL table dumps do NOT contain the actual binary media files (menu item images, cafe branding) stored in object storage.
  - The repository utilizes the **`menu-images`** bucket (defined in migration `202610200008` and managed via `MenuManager.tsx`).
  - **Inspection Status:** The latest read-only inspection found **zero objects** in `menu-images` (initial setup state), but the operator must recheck object count before any backup or migration.
  - Sync all bucket objects locally using AWS CLI with Supabase S3 Access Keys (obtained from **Supabase Dashboard > Project Settings > Storage > S3 Access Keys**):
    ```powershell
    aws s3 sync s3://menu-images ./urbania_storage_backup/menu-images --endpoint-url https://asdrrunxpsqzbvswmzgv.supabase.co/storage/v1/s3
    ```
  - **Data Integrity & Count Verification:**
    Never claim Storage backup success without verifying actual object counts and file integrity:
    ```powershell
    # Verify remote object count
    $remoteCount = (aws s3 ls s3://menu-images --recursive --endpoint-url https://asdrrunxpsqzbvswmzgv.supabase.co/storage/v1/s3 | Measure-Object).Count
    # Verify local downloaded file count
    $localCount = (Get-ChildItem -Path ./urbania_storage_backup/menu-images -Recurse -File | Measure-Object).Count
    Write-Host "Remote S3 objects: $remoteCount, Local synced files: $localCount"
    if ($remoteCount -ne $localCount) {
        throw "Storage sync mismatch! Remote has $remoteCount files but local has $localCount."
    }
    ```

### 8.4. Project Configuration & Settings Backup

- [ ] **8. Project Settings & Auth Configuration Snapshot:**
  - Export and archive non-secret project configurations from Supabase Dashboard:
    - PostgREST API settings (exposed schemas, extra search path)
    - Auth settings (external providers, email templates, rate limits, JWT expiry)
    - Custom extensions (`pgcrypto`, etc.)
    - Environment variables configured in Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

### 8.5. Selected Logical SQL Restore Validation Protocol (Disposable PostgreSQL 17 Container)

Before applying migrations to production, the operator should validate that the captured logical SQL dumps are complete, syntactically valid, and restorable.

> [!WARNING]
> **Scope Demarcation — Selected Logical SQL Restore vs. Complete Supabase Restore:**
> Running restoration against a disposable, plain PostgreSQL 17 Docker container tests **selected logical SQL restoration only** (application public schema, table rows, and custom database roles). It does **NOT** constitute a complete Supabase platform restoration.
>
> A plain PostgreSQL container does **NOT** restore or verify:
> 1. Managed `auth` user data, encrypted credentials, active sessions, and GoTrue service configurations.
> 2. Supabase Storage service metadata, internal bucket definitions, and Storage API policies.
> 3. Binary Storage media objects (stored in S3, not PostgreSQL).
> 4. Supabase platform-managed roles (`supabase_admin`, `authenticator`, etc.), internal extensions, and background microservices (GoTrue, PostgREST, Realtime, Kong).
> 5. Dashboard configuration, OAuth third-party providers, redirect URLs, and SMTP settings.
>
> Do **NOT** create a hosted staging project or hosted restore target. Retain full project backup/restore verification as an owner-controlled gate.

- [ ] **9. Rehearse Selected Logical SQL Restoration on a Disposable PostgreSQL 17 Container:**
  - Production database `asdrrunxpsqzbvswmzgv` runs **PostgreSQL 17.11** (`PostgreSQL 17.11 on aarch64-unknown-linux-gnu`). Rehearsal must be performed on an isolated **PostgreSQL 17** container (`postgres:17`).
  - *Isolation Guarantee:* This rehearsal runs in a dedicated ephemeral Docker container on port `54433` and NEVER touches production or the persistent local Supabase instance at `54321`.
  - Launch an isolated temporary PostgreSQL 17 instance on ephemeral port `54433`:
    ```powershell
    docker run --name urbania-backup-verify -e POSTGRES_PASSWORD=postgres -p 54433:5432 -d postgres:17
    ```
  - Wait for PostgreSQL 17 container initialization:
    ```powershell
    Start-Sleep -Seconds 5
    ```
  - Restore roles:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -f "urbania_prod_roles_*.sql"
    ```
  - Restore application schema:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -f "urbania_prod_schema_*.sql"
    ```
  - Restore application data:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -f "urbania_prod_data_*.sql"
    ```

- [ ] **10. Run Structural and Row-Count Parity Verification:**
  - Check tables existence and row count parity against the production preflight baseline:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -c @"
    SELECT 'orders' AS tbl, count(*) FROM public.orders
    UNION ALL SELECT 'bills', count(*) FROM public.bills
    UNION ALL SELECT 'bill_audit_events', count(*) FROM public.bill_audit_events
    UNION ALL SELECT 'menu_items', count(*) FROM public.menu_items
    UNION ALL SELECT 'admin_profiles', count(*) FROM public.admin_profiles
    UNION ALL SELECT 'schema_migrations', count(*) FROM supabase_migrations.schema_migrations;
    "@
    ```
  - Verify Row-Level Security (RLS) is enabled on all restored application tables:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';"
    ```
  - Verify functions, triggers, and extensions:
    ```powershell
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -c "SELECT proname FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid WHERE nspname = 'public';"
    psql -h 127.0.0.1 -p 54433 -U postgres -d postgres -c "SELECT extname, extversion FROM pg_extension;"
    ```

- [ ] **11. Teardown Verification Container:**
  - After verifying logical backup integrity, terminate and remove the disposable container:
    ```powershell
    docker rm -f urbania-backup-verify
    ```

### 8.6. Owner Gate Status

- [ ] **Owner Action Required:** The automated agent and non-owner operators have read-only access to production and cannot capture credentials, download full production database backups, or manage platform PITR.
- **GATE-6 Status:** 🔴 **PENDING OWNER EXECUTION**. Full project backup and restore verification remains strictly gated until the repository and database owner completes the above checklist and verifies restorability through supported Supabase procedures.

---

## 9. Step-by-Step Migration Execution Order with Stop Conditions

1. **Step 1:** Run `supabase/preflight-production-release.sql` and archive query output.
   - *STOP CONDITION:* If any baseline row counts deviate from documented expectations, halt and investigate.
2. **Step 2:** Verify owner backup dump.
   - *STOP CONDITION:* Do not execute migration DDL without an offline dump.
3. **Step 3:** Apply migrations 0016 through 0026 in order.
   - *STOP CONDITION:* If any statement fails with relation, constraint, or syntax error, halt immediately.
4. **Step 4:** Reload PostgREST schema cache:
   ```sql
   notify pgrst, 'reload schema';
   ```
5. **Step 5:** Run Section 9C post-migration verification in `supabase/preflight-production-release.sql`.
   - *STOP CONDITION:* Verify `Post-Migration Discrepancy Check` reports 0 rows, and `Post-Migration False-Paid Cancelled Bills Check` reports 0 rows.
6. **Step 6:** Promote PR #8 into `main` on Vercel.
7. **Step 7:** Run post-migration smoke tests.

---

## 10. Go/No-Go Decision Gates

The first read-only production baseline has been captured and archived on 2026-10-30. Gate 5 is satisfied for this snapshot only; repeat it immediately before execution because production records can change.

| Gate ID | Gate Name | Required Criterion | Current Status | Gate Verdict |
|---|---|---|---|---|
| **GATE-1** | **Software Build & Verification** | Typecheck, lint, build, unit tests, and disposable integration test suite pass cleanly. | All passed (Unit: 517/517 OK; Financial Integration: 12/12 OK; TypeScript & ESLint: 0 errors; Build: OK) | 🟢 **PASSED** |
| **GATE-2** | **Backfill Correction Verification** | Deterministic regression tests prove findings 1, 2, 3 and multiple-bill safety gates are resolved. | `tests/payment-reconciliation-migration.test.ts` passed (13/13 OK) | 🟢 **PASSED** |
| **GATE-3** | **Preflight Script Readiness** | Read-only SQL diagnostic verified on legacy and modern databases without relation or column errors. | `supabase/preflight-production-release.sql` verified on both 0015 and 0026 schemas | 🟢 **PASSED** |
| **GATE-4** | **Rehearsal on Clean Container** | Isolated two-phase replay applies 0016–0026 over real historical fixtures, and dedicated fail-closed harness tests actual migration 0018 failure against duplicate-bill fixtures. | Verified via `npm run test:migration:replay` (9/9 post-migration assertions OK) and `npm run test:migration:fail-closed` (exit code 1, URB:ambiguous_multiple_bills_detected, 0 partial changes) | 🟢 **PASSED** |
| **GATE-5** | **Production Baseline Inspection** | Read-only preflight executed and baseline archived; repeat immediately before migration. | Captured 2026-10-30 and archived in `docs/production-baseline-2026-10-30.md`; refresh required before change window. | 🟢 **BASELINE CAPTURED (RECHECK REQUIRED)** |
| **GATE-6** | **Owner Backup Verification** | Complete project backup & recovery readiness: Platform snapshot/PITR verification, logical dumps (roles, schema, data, customizations diff), storage sync (`menu-images`), and supported restore verification. | Pending owner execution | 🔴 **PENDING (Owner action)** |
| **GATE-7** | **Owner Accounting Sign-Off** | Owner accepts NULL/unreconciled classification for cancelled bills, issued-bill paid balances, and unpaid unbilled orders. | Explicitly approved 2026-10-31; latest checkpoint is 18 cancelled bills / ₹4,911 and 4 issued discounted manual bills / ₹163 delta. | 🟢 **APPROVED** |
| **GATE-8** | **Security Migration 0027 Rehearsal** | Disposable Postgres/Supabase replay, anonymous-vs-authenticated grants, RLS policies, public QR paths, and role-self/cross-user checks all pass. | Migration and tests prepared on a separate hardening branch; no disposable replay or test execution yet. | 🔴 **PENDING** |
| **GATE-9** | **Maintenance Window Scheduling** | Dedicated change window approved by business owners. | Pending owner scheduling | 🔴 **PENDING (Owner authorization)** |

### Final Verdict:
**🔴 NO-GO FOR PRODUCTION EXECUTION until Gates 5, 6, 8, and 9 are satisfied.** Gate 7 accounting sign-off is complete; supported backup/restore, refreshed preflight, and security migration rehearsal remain outstanding.
