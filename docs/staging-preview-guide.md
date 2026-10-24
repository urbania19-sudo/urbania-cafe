# Urbania Café — Staging Database & Vercel Preview Billing Guide

This guide documents how to safely configure and use an isolated Supabase staging database for Vercel Preview deployments, allowing staff order management, bill generation, thermal receipt printing, reprinting, cancellation, and discount testing without putting production café records at risk.

---

## 1. Safety Architecture & Fail-Closed Guard

Urbania Café enforces a strict fail-closed write-safety policy (`src/lib/preview-guard.ts`):

- **Production (`VERCEL_ENV=production`)**: Normal operations permitted against the production database (`rexeyagnvssvjlukjcbd`).
- **Local Development (`VERCEL_ENV` undefined)**: Normal operations permitted against local Docker Supabase (`http://127.0.0.1:54321`).
- **Vercel Preview (`VERCEL_ENV=preview`)**: All database mutations (`POST`, `PATCH`, `PUT`, `DELETE`) are **blocked by default** (`HTTP 403 PREVIEW_READ_ONLY`) when Preview deployments share or inherit the production database.

### Preview Write Requirements
Preview deployments are permitted to perform write operations **only** when all of the following conditions are simultaneously verified:

1. `VERCEL_ENV === 'preview'`
2. `ISOLATED_STAGING_DB=true` explicitly confirms that an isolated staging project is configured.
3. `ALLOW_PREVIEW_WRITES=true` explicitly enables writes for testing.
4. `BLOCK_PREVIEW_WRITES` is unset or not `true`.
5. No configured database connection URL (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_INTERNAL_URL`, `SUPABASE_URL`, `POSTGRES_URL`, `DATABASE_URL`) matches or contains the known production project reference (`rexeyagnvssvjlukjcbd`).
6. No configured database connection matches `PRODUCTION_SUPABASE_URL` or `PRODUCTION_DATABASE_URL`.
7. All configured candidate URLs point to the same consistent staging database target. Missing or unrecognized database targets fail closed.

> [!CAUTION]
> **Never set `ALLOW_PREVIEW_WRITES=true` or `ISOLATED_STAGING_DB=true` in Preview if any connection URL points to the production Supabase database.**

---

## 2. Setting Up an Isolated Staging Supabase Project

### Step 1: Create a Staging Supabase Project
1. Log in to [Supabase](https://supabase.com/dashboard).
2. Click **New Project** and name it `urbania-cafe-staging` (choose region `ap-south-1` Mumbai to match production).
3. Set a strong database password and save it securely.

### Step 2: Retrieve API Keys
In Supabase Dashboard, navigate to **Project Settings** → **API**:
- **Project URL**: `https://<staging-ref>.supabase.co`
- **Project API Keys**:
  - `anon` `public` key
  - `service_role` `secret` key

### Step 3: Apply Database Migrations in Order
In the Supabase SQL Editor for the **staging project only**, execute the migrations in chronological sequence:

1. `supabase/migrations/202610160001_initial.sql` — Initial schema, tables, RLS policies, order placement RPC.
2. `supabase/migrations/202610160002_staff_roles.sql` — Staff roles and `admin_profiles` table.
3. `supabase/migrations/202610160003_protect_table_tokens.sql` — Restricts table QR tokens to owners.
4. `supabase/migrations/202610160004_order_guest_details.sql` — Guest count and customer details.
5. `supabase/migrations/202610160005_staff_profile_access.sql` — Self-profile reading permissions.
6. `supabase/migrations/202610160006_staff_reject_edit.sql` — Staff rejection and order adjustments.
7. `supabase/migrations/202610200007_billing_and_fssai.sql` — Bills table, FSSAI fields, settings.
8. `supabase/migrations/202610200008_align_admin_and_storage_policies.sql` — Storage policies alignment.
9. `supabase/migrations/202610210009_billing_audit_and_manual_orders.sql` — Audit events, reprint tracking, manual orders.
10. `supabase/migrations/202610210010_harden_billing_audit_events.sql` — Audit event immutability.
11. `supabase/migrations/202610220011_edit_order_items_and_status_transitions.sql` — Item editing and direct status transitions.
12. *(If bill discount PR is merged)* `supabase/migrations/202610240012_bill_level_discounts.sql` — Bill-level discounts and generate_bill RPC update.

### Step 4: Seed Staging Data
Run `supabase/seed.sql` in the staging SQL editor:
- Creates the 5 standard café tables (Tables 1 through 5) with active QR tokens.
- Populates menu categories (Sandwiches, Pizzas, Burgers, Mocktails, etc.).
- Populates standard menu items with integer-paise pricing.

### Step 5: Create Staging Staff and Owner Accounts
1. In the Supabase Dashboard, go to **Authentication** → **Users** → **Add User** → **Create User**:
   - Create owner user: e.g. `owner@staging.urbania.cafe` with a temporary password.
   - Create staff user: e.g. `staff@staging.urbania.cafe` with a temporary password.
2. Copy the generated User UUIDs from the dashboard.
3. In the SQL Editor, run:
   ```sql
   insert into public.admin_profiles (user_id, role)
   values
     ('<owner-user-uuid>', 'owner'),
     ('<staff-user-uuid>', 'staff');
   ```

### Step 6: Configure Staging Café Settings
Verify that `cafe_settings` has the default café information:
```sql
insert into public.cafe_settings (
  cafe_name,
  legal_name,
  gst_status,
  tax_treatment,
  bill_prefix,
  bill_header_text,
  bill_footer_text
) values (
  'Urbania Café (Staging)',
  'Urbania Foods Pvt Ltd',
  'not_registered',
  'none',
  'UB-STG-',
  'Urbania Café Staging Environment',
  'Thank you for visiting Urbania Café!'
) on conflict do nothing;
```

---

## 3. Configuring Vercel Preview Environment Variables

1. Log in to [Vercel Dashboard](https://vercel.com) and open the **urbania-cafe** project.
2. Navigate to **Settings** → **Environment Variables**.
3. Add the following variables, checking **ONLY Preview** (uncheck Production and Development):

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

> [!IMPORTANT]
> **Trigger a New Deployment:** Changes to Vercel environment variables do not automatically update already-running Preview deployments. Go to **Deployments** → Select the active Preview deployment → Click **Redeploy**, or push a new commit to the pull request branch.

---

## 4. End-to-End Testing Verification Checklist

Once the staging project is seeded and Vercel Preview environment variables are configured and redeployed:

1. **Staff Login**:
   - Navigate to `https://<preview-deployment-url>/staff/login`.
   - Sign in using `staff@staging.urbania.cafe`.
2. **Order Management**:
   - Open `/staff` order queue.
   - Click **New Order** to create a manual order (or open `/menu/<qr_token>` for a customer order).
   - Verify the order appears in the staff queue with status `Order Placed` / `Accepted`.
3. **Status Transitions & Editing**:
   - Click **Completed** on an accepted order. Verify the order completes smoothly.
   - Click **Edit Items** on an active order to adjust line item quantities.
4. **Bill Generation**:
   - Click **Bill** on an order to generate the bill.
   - Verify the bill is created and stored in `bills` in the staging Supabase project.
5. **Thermal Receipt Printing & Reprints**:
   - Open the bill modal and click **View Image**.
   - Verify the 384px receipt canvas renders accurately.
   - Click **Print Receipt** or **Reprint** and verify a `reprinted` audit event is logged in `billing_audit_events`.
6. **Cancellation**:
   - Log in as owner (`owner@staging.urbania.cafe`) and navigate to `/admin/reports`.
   - Click **Cancel Bill** with a test reason.
   - Verify the bill status updates to `cancelled` and an audit event is recorded.
7. **Production Verification**:
   - Check the production Supabase database (`rexeyagnvssvjlukjcbd`).
   - Confirm that **zero** test orders, test bills, or audit logs were created in production.
