# Urbania Café — Production Read-Only Baseline

**Captured:** 2026-10-30 (UTC date)
**Supabase project:** `asdrrunxpsqzbvswmzgv`
**Region / engine:** `ap-south-1` / PostgreSQL 17.11
**Purpose:** Pre-migration baseline for PR #8. All production queries used for this capture were read-only SELECTs.

## Migration history and release compatibility

- Latest recorded production migration: `202610260015_reconcile_kitchen_ticket_acknowledgement_rpc`.
- Release migrations `202610280016` through `202610290026`: not recorded as applied at capture time.
- The required `customer_payments` and `admin_credit_settlements` tables were absent.
- Payment columns `payment_status`, `paid_paise`, and `payment_method` were absent on the inspected `orders` and `bills` tables.
- RPCs `record_customer_payment` and `settle_admin_credit_payment` were absent.

## Historical order and bill backfill populations

| Diagnostic population | Rows | Amount |
|---|---:|---:|
| Cancelled QR/manual orders without a bill | 4 | 147,600 paise (₹1,476) |
| Completed QR/manual orders without a bill | 3 | 38,700 paise (₹387) |
| Completed QR/manual orders with an issued bill | 24 | 663,500 paise (₹6,635) |
| Of those, QR issued-bill orders | 1 | 25,800 paise (₹258) |
| Of those, manual issued-bill orders | 23 | 637,700 paise (₹6,377) |
| Discounted issued manual bills | 5 | 160,000 paise order total; 138,800 paise bill total |
| Discount difference on those manual bills | 5 | 21,200 paise (₹212) |
| Cancelled QR/manual bills | 17 | 481,100 paise (₹4,811) |

The 17 cancelled bills have an unknown historical payment outcome. Cancellation is not proof of non-payment or a refund. Keep their payment status unresolved under the proposed migration semantics; do not invent cash collections or refund transactions.

## Multiple-bill safety baseline

| Condition | Orders at capture |
|---|---:|
| More than one bill for an order | 0 |
| Both issued and cancelled bills for one order | 0 |
| More than one issued bill for an order | 0 |

These counts are a point-in-time snapshot. Re-run all multiple-bill diagnostics immediately before any approved migration window.

## Storage inventory

| Bucket | Public | Objects at capture |
|---|---:|---:|
| `menu-images` | Yes | 0 |

Storage object counts can change. Recheck before backup and migration.

## Preflight execution

The 13 read-only SELECT statements from `supabase/preflight-production-release.sql` were executed individually against this project and returned without SQL errors. The full multi-statement file was not submitted as one request because the connected SQL execution interface accepts one statement per call.

## Safety and limitations

- No production migration, DDL, DML, repair, or migration-history write was executed.
- No production backup was captured or restored as part of this baseline.
- Security-advisor findings remain a separate review item.
- The figures above are snapshots, not migration authorization. Re-run the preflight immediately before any production change.
- Production remains **NO-GO** until backup/restore readiness, accounting sign-off, security review, maintenance window, and explicit owner approval are complete.
