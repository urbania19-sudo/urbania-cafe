# Urbania Café — Production Read-Only Baseline (2026-10-31)

**Project:** `asdrrunxpsqzbvswmzgv` (ap-south-1, PostgreSQL 17.11)  
**Captured:** 2026-10-31 (Asia/Kolkata)  
**Scope:** SELECT-only production inspection. No production migration, DDL, DML, role grant, or deployment promotion was executed.  
**Release candidate:** `feat/operational-improvements`, PR [#8](https://github.com/urbania19-sudo/urbania-cafe/pull/8).  
**Historical reference:** [Baseline 2026-10-30](production-baseline-2026-10-30.md) remains unchanged and records the earlier point-in-time state.

---

## 1. Migration and schema state

- Latest migration recorded in production: `202610260015_reconcile_kitchen_ticket_acknowledgement_rpc`.
- Pending application migrations at the time of this capture: `0016–0026`; feature branch additionally contains security migration `202610310027_harden_rpc_execution_privileges.sql`.
- Payment tables, payment columns, settlement ledger and their release RPCs are not yet present in production.
- Production storage bucket `menu-images` was previously read-only inspected with zero objects; recheck immediately before any approved backup.

## 2. Financial populations

All currency values below are derived from integer paise in production.

| Diagnostic population | Current count | Amount |
|---|---:|---:|
| Cancelled QR/manual bills | 19 | ₹5,090.00 |
| Issued discounted manual bills | 4 | ₹1,451.00 before discount |
| Aggregate discount on those issued bills | — | ₹163.00 |
| Actual billed total for those four discounted bills | — | ₹1,288.00 |
| Cancelled QR/manual orders with no bill | 4 | ₹1,476.00 |
| Completed QR/manual orders with no bill | 3 | ₹387.00 |
| Completed QR/manual orders with an issued bill | 23 | ₹6,323.00 actual billed total |
| Orders with more than one bill | 0 | — |

The four discounted issued manual bills total ₹1,451.00 before discounts, ₹163.00 of discount, and ₹1,288.00 billed after discount. The linked order paid balance must reconcile to the actual bill total, not the original order total.

### Latest additional cancellation

Bill `UB-01042` (Order #49, manual) was issued for ₹179.00 and cancelled on **2026-10-31 at 00:35:51 IST**. Its audit trail records issuance followed by cancellation with reason “Voided by administrator”. This record raised the cancelled-bill population from the previously recorded 18 / ₹4,911 to **19 / ₹5,090**. It does not prove whether customer money was collected or refunded.

The archived 2026-10-30 baseline and the earlier PR note are retained as historical snapshots; they should not be overwritten with later figures.

## 3. Approved historical accounting treatment

The owner approved the following classification on 2026-10-31:

- Cancelled historical bills remain `payment_status = NULL` (unknown / unreconciled), with no invented collection or refund.
- Issued QR/manual bills reconcile to the actual billed total after any bill-level discount.
- QR/manual orders with no bill remain unpaid with zero paid balance.

This approval is an accounting classification decision only. It is **not** authorization to run migrations, repair SQL, or merge PR #8.

## 4. Security findings observed before migration 0027

The read-only Supabase security inspection reported:

- 16 `SECURITY DEFINER` functions executable by `anon`; four are intended token-based customer QR/menu endpoints, and two are trigger/event-trigger entry points. The remaining privileged RPC/helper access requires least-privilege review.
- Broad default function EXECUTE privileges were present for `anon` and `authenticated` under both `postgres` and `supabase_admin` default ACL entries.
- Nine retained `_backup_pre_0009_*` tables had RLS enabled with no policies, while direct `anon` and `authenticated` SELECT and INSERT table privileges were still present.
- Supabase Authentication leaked-password protection was reported disabled.

Migration 0027 was added to PR #8 to narrow internal RLS policies to authenticated users, revoke anonymous execution from privileged RPCs while preserving the four token-based public QR endpoints, remove direct client execution on trigger-only helpers, restrict the legacy archive tables when present, and remove broad future function EXECUTE defaults for the `postgres` migration role. A dedicated static regression test was added.

**Important:** Migration 0027 has not been applied to production and has not yet completed an isolated local replay. The proposed permission changes must be reviewed and replayed before the security gate can be marked passed. Leaked-password protection is a separate dashboard configuration task and has not been changed.

## 5. Release position

- Production migration history remains at 0015.
- The PR remains open and unmerged.
- Vercel reported a successful check for the then-current feature-branch commit after adding migration 0027 and its test; this is not proof that the migration was executed.
- Production backup and restore rehearsal evidence has not been supplied yet.
- Re-run the read-only preflight immediately before any separately approved maintenance window because order/bill records can change.
- Do not run migrations or merge until backup/restore, migration replay, security review, owner scheduling, and explicit production authorization are all complete.
