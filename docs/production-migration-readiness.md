# Urbania Café — Production Database Migration Readiness & Runbook

**Document Version:** 1.1.0 (Corrected Financial Backfill & Historical Reclassification)  
**Release Candidate Commit:** [`5ccc920`](https://github.com/urbania19-sudo/urbania-cafe/commit/5ccc920) (Targeting updated release commit)  
**Pull Request:** [#8 (feat: operational improvements)](https://github.com/urbania19-sudo/urbania-cafe/pull/8)  
**Production Supabase Reference:** `asdrrunxpsqzbvswmzgv`  
**Production Vercel Branch:** `main`  
**Vercel Preview Deployment:** Verified live at PR #8  

---

## 1. Executive Summary & Verdict

### Current Verdict: 🔴 STRICT NO-GO FOR PRODUCTION EXECUTION

While the application software, UI components, mobile dialogs, and TypeScript backend in PR #8 are fully verified and passing all integration suites on a disposable container, **production database migration execution is strictly gated and must NOT proceed until mandatory pre-requisites are fulfilled by the repository and database owners**.

```
+-----------------------------------------------------------------------------------------------+
|                                    VERDICT: NO-GO                                             |
+-----------------------------------------------------------------------------------------------+
|  1. Software Release Candidate 5ccc920+: VERIFIED & READY                                     |
|  2. Migration Scripts 0016–0026: CORRECTED & REHEARSED                                        |
|  3. Production Preflight Inspection: SCRIPT PREPARED (supabase/preflight-production-release.sql)|
|  4. Production Database asdrrunxpsqzbvswmzgv: UNPREPARED (Stopped at 0015)                    |
|  5. Verified Cold/Hot Backup & Restore: PENDING OWNER EXECUTION                               |
|  6. Formal Maintenance Window & Change Approval: PENDING OWNER SIGN-OFF                       |
|  7. Owner Reconciliation of 17 Cancelled Historical Bills: PENDING OWNER DECISION             |
+-----------------------------------------------------------------------------------------------+
```

### Why Production Execution is Currently Blocked:
1. **Unapplied Migration Delta:** Production Supabase project `asdrrunxpsqzbvswmzgv` currently stops at migration `202610260015`. Migrations `0016` through `0026` (11 distinct migration files) have not yet been applied.
2. **Missing Financial Infrastructure:** In production, `public.customer_payments`, `public.admin_credit_settlements`, `orders.payment_status`, and `bills.paid_paise` do not exist. Any direct deployment of PR #8 code to production without applying the database migrations will result in immediate runtime errors for billing and order workflows.
3. **Backup / Recovery Point Pending:** The owner has not yet captured and verified a point-in-time recovery backup or downloadable logical dump (`pg_dump`) immediately preceding this 11-migration batch.
4. **Append-Only Trigger Safety:** Migration 0018 installs an immutable trigger preventing deletion/updates to `customer_payments`. Applying this requires scheduled maintenance authorization.
5. **Historical Cancelled Bills Reconciliation:** Production has 17 cancelled bills totaling 481,100 paise (₹4,811) with unknown payment status. The owner must be informed of their unreconciled (`payment_status = NULL`) state.

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

The database operator must run [`supabase/preflight-production-release.sql`](file:///C:/Users/Rumble/.gemini/antigravity/scratch/urbania-cafe-nextjs-port/supabase/preflight-production-release.sql) in the Supabase SQL Editor on `asdrrunxpsqzbvswmzgv`.

### Expected Pre-Migration Diagnostic Findings on Production:

1. **Finding 1 — Unbilled Orders:**
   - Cancelled QR/Manual orders without bill: **4 rows**, total **147,600 paise** (₹1,476).
   - Completed QR/Manual orders without bill: **3 rows**, total **38,700 paise** (₹387).
   - Completed QR/Manual orders with issued bill: **1 row**, total **25,800 paise** (₹258).
   - *Pre-migration total:* 8 orders, 212,100 paise.
   - *Post-migration expectation:* Exactly 1 order marked paid (₹258); 7 unbilled orders remain `unpaid` with `paid_paise = 0`.
2. **Finding 2 — Discounted Manual Bills:**
   - Issued manual bills where order total exceeds bill total: **5 rows**, aggregate difference **21,200 paise** (₹212).
   - *Pre-migration state:* `orders.total_paise` = 165,000 paise; `bills.total_paise` = 143,800 paise.
   - *Post-migration expectation:* `orders.paid_paise` = `bills.paid_paise` = 143,800 paise. Zero discrepancy.
3. **Finding 3 — Cancelled Historical Bills:**
   - Cancelled historical bills: **17 rows**, total **481,100 paise** (₹4,811).
   - *Pre-migration state:* Retains invalid 0016 default `paid` with `paid_paise = 0`.
   - *Post-migration expectation:* `payment_status = NULL`, `paid_paise = 0`. False `paid` state eliminated.
4. **Post-Migration Verification Invariant:**
   - Discrepancy between `orders.paid_paise` and `bills.total_paise` on issued bills must be **0 rows** and **0 paise**.
   - Cancelled bills with `payment_status = 'paid'` must be **0 rows**.

---

## 7. Remaining Accounting Decisions Requiring Owner Reconciliation

> [!IMPORTANT]
> **Owner Sign-Off Required for 17 Cancelled Historical Bills:**
> Production contains 17 cancelled bills issued before migration 0016, with an aggregate value of ₹4,811 (481,100 paise).
> Because the legacy system did not record payment transaction logs or refund slips, the database cannot know whether:
> 1. Cash was collected by staff and later voided/pocketed.
> 2. The order was cancelled before the customer paid (customer walked away or cancelled order).
> 3. The customer paid and was given a manual cash refund from the till.
> 
> **Action:** Migration 0018 safely sets `payment_status = NULL` and `paid_paise = 0` so these bills do not artificially inflate financial receipts. The owner should review the list of 17 cancelled bill numbers (available from Section 9C of `preflight-production-release.sql`) and reconcile them with physical cash register books if desired.

---

## 8. Backup & Restore Readiness Checklist

- [ ] **1. Cloud Snapshot Verification:**
  - Verify in Supabase Dashboard (**Database > Backups**) that automatic daily backups are healthy and PITR is enabled.
- [ ] **2. Pre-Migration Logical Dump (`pg_dump`):**
  ```powershell
  pg_dump -h db.asdrrunxpsqzbvswmzgv.supabase.co -U postgres -d postgres -n public -n supabase_migrations -Fc -f "urbania_prod_pre_0016_$(Get-Date -Format 'yyyyMMdd_HHmm').dump"
  ```
- [ ] **3. Dump Verification:**
  - Verify file size > 0 bytes and verify `TABLE DATA` entries exist.

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

| Gate ID | Gate Name | Required Criterion | Current Status | Gate Verdict |
|---|---|---|---|---|
| **GATE-1** | **Software Build & Verification** | Typecheck, lint, build, unit tests, and disposable integration test suite pass cleanly. | All passed (`npm run test:integration:disposable` 11/11 OK) | 🟢 **PASSED** |
| **GATE-2** | **Backfill Correction Verification** | Deterministic regression tests prove findings 1, 2, 3 are resolved. | `tests/payment-reconciliation-migration.test.ts` passed (11/11 OK) | 🟢 **PASSED** |
| **GATE-3** | **Preflight Script Readiness** | Read-only SQL diagnostic prepared with pre/post checks. | `supabase/preflight-production-release.sql` updated | 🟢 **PASSED** |
| **GATE-4** | **Rehearsal on Clean Container** | Full 0001–0026 sequence applies from scratch and passes financial assertions. | Verified via disposable runner on ports 54421/54422 | 🟢 **PASSED** |
| **GATE-5** | **Production Baseline Inspection** | Operator runs preflight SQL on `asdrrunxpsqzbvswmzgv` and archives baseline. | Not yet run on live production | 🔴 **PENDING (Operator action)** |
| **GATE-6** | **Owner Backup Verification** | Full logical pg_dump / PITR snapshot confirmed and verified. | Pending owner action | 🔴 **PENDING (Owner action)** |
| **GATE-7** | **Owner Accounting Sign-Off** | Owner accepts unreconciled NULL status for 17 cancelled bills. | Pending owner review | 🔴 **PENDING (Owner action)** |
| **GATE-8** | **Maintenance Window Scheduling** | Dedicated change window approved by business owners. | Pending owner scheduling | 🔴 **PENDING (Owner authorization)** |

### Final Verdict:
**🔴 NO-GO FOR PRODUCTION EXECUTION until Gates 5, 6, 7, and 8 are satisfied.**
