# Urbania Café — Free Database Backup & Disaster Recovery Guide

This guide details zero-cost, reliable backup and recovery workflows for Urbania Café. Supabase PostgreSQL serves as the single authoritative source of truth for all business settings, menu items, table tokens, orders, bills, and immutable audit logs.

No external paid services, cloud subscriptions, or Google Cloud service accounts are required.

---

## 1. Overview of Free Backup Strategies

| Backup Method | Frequency | Format | Cost | Scope & Content |
|---|---|---|---|---|
| **In-App CSV Audit Exports** | Daily / Weekly | RFC 4180 CSV (`.csv`) | Free | High-level financial reporting; offline review in Excel/Google Sheets; tax auditing; printable records |
| **Supabase CLI Logical Dump** | Weekly / Monthly | SQL Dump (`.sql`) | Free | All `public` application tables, indexes, views, and data |
| **Direct `pg_dump` Stream** | Weekly / Pre-deploy | Plain SQL / Custom (`.dump`) | Free | Standard PostgreSQL dump via direct cloud database connection |
| **Supabase Studio CSV Export** | Ad-hoc | CSV (`.csv`) | Free | Table-by-table data export directly from the web browser dashboard |

> [!IMPORTANT]
> **Scope of `public` Schema Backups vs. Auth & Storage:**
> - **Included in `public` dumps**: `cafe_settings`, `cafe_tables`, `menu_categories`, `menu_items`, `menu_item_options`, `orders`, `order_items`, `bills`, `bill_audit_events`, and `admin_profiles`.
> - **NOT included in `public` dumps**:
>   1. **Supabase Auth Users (`auth.users`)**: Passwords, email hashes, and authentication tokens live in the protected `auth` schema. To safeguard staff/owner accounts, maintain a secure record of staff emails/roles or export auth metadata from **Supabase Dashboard > Authentication > Users**.
>   2. **Storage Files (`storage.objects`)**: Uploaded menu photos and receipts are stored in cloud object storage buckets (`menu-images`), not inside PostgreSQL table rows. Keep offline copies of menu photo assets.

---

## 2. In-App Zero-Cost Transaction Exports (Daily Operational Workflow)

Urbania Café includes a built-in Audit & Reports module accessible at `/admin/reports` by authenticated owners.

### Available Exports:
1. **Bills CSV (`/api/admin/reports/export/bills`)**:
   - Bill numbers (`UB-XXXXX`), order numbers, timestamps (ISO and IST).
   - Order source (`QR Code` vs `Counter / Manual`), service mode (`Dine-in`, `Takeaway`, `Counter`, `Delivery`).
   - Item counts, subtotal, tax, and final amount in INR (₹).
   - Cancellation audit details (timestamp and reason).
2. **Bill Items CSV (`/api/admin/reports/export/items`)**:
   - Itemized lines snapshotting the exact historical price, quantity, custom notes, and customization flags at the time of billing.
3. **Audit Events CSV (`/api/admin/reports/export/events`)**:
   - Complete chronology of `issued`, `reprinted`, and `cancelled` operations with actor ID, email, role, and metadata.

> [!NOTE]
> All exports feature **UTF-8 Byte Order Marks (BOM)** for clean rendering in Microsoft Excel and automatic **Formula Injection Defense** (`'` prepended to `=`, `+`, `-`, `@`, `\t`, `\r` prefixes).

---

## 3. Full Database Backup via Supabase CLI (Local & Staging)

When working locally or managing a linked Supabase project, use the Supabase CLI to create logical dumps.

### Step 3.1: Export Application Data Only
To export all records (settings, tables, orders, bills, audit events) while keeping the schema migrations separate:

*(On Windows PowerShell)*:
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
npx supabase db dump --local --data-only -f "supabase/backups/data_backup_$date.sql"
```

### Step 3.2: Export Full Local Database (Schema + Data)
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
npx supabase db dump --local -f "supabase/backups/full_backup_$date.sql"
```

---

## 4. Full Database Backup via `pg_dump` (Hosted Cloud Supabase)

Hosted Supabase Free Tier allows direct PostgreSQL connections via port 5432 or port 6543 (transaction pooler). You can run PostgreSQL's standard `pg_dump` tool directly against your cloud database to generate a portable SQL backup.

### Step 4.1: Retrieve Connection String
From your Supabase Dashboard:
1. Navigate to **Project Settings** > **Database**.
2. Under **Connection string**, select **URI**.
3. Format: `postgresql://postgres:[YOUR-PASSWORD]@db.rexeyagnvssvjlukjcbd.supabase.co:5432/postgres`

### Step 4.2: Execute `pg_dump`
```bash
# Create a logical backup file containing the public schema and all café data:
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.rexeyagnvssvjlukjcbd.supabase.co:5432/postgres" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="urbania_cloud_backup_$(date +%Y%m%d).sql"
```

*(On Windows PowerShell)*:
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.rexeyagnvssvjlukjcbd.supabase.co:5432/postgres" `
  --schema=public `
  --no-owner `
  --no-privileges `
  --file="urbania_cloud_backup_$date.sql"
```

---

## 5. Disaster Recovery & Restoration (Isolated & Recovery Workflows)

> [!CAUTION]
> **DESTRUCTIVE RESTORATION WARNING**
> Restoration commands overwrite or reset database state. **NEVER** run restore or reset commands when intending to perform a backup. Restoration should only be executed during a planned disaster recovery exercise or when initializing a fresh development environment.

### Scenario A: Restoring to Local Development Supabase
To recreate the local development database from scratch and populate from a backup SQL dump:
```powershell
# 1. Reset local database to clean migration baseline (DESTRUCTIVE to local DB):
npx supabase db reset

# 2. Populate from backup SQL dump:
Get-Content "supabase/backups/data_backup_20261021.sql" | npx supabase db query
```

### Scenario B: Restoring to a Fresh Cloud Database via `psql`
```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[NEW-PROJECT-REF].supabase.co:5432/postgres" \
  -f "urbania_cloud_backup_20261021.sql"
```

---

## 6. Post-Restoration Verification Checklist

After restoring data or verifying database integrity, run these SQL verification checks in Supabase Studio SQL Editor (`http://127.0.0.1:54323` locally or Cloud Dashboard):

1. **Verify Bill Sequence & Format Continuity**:
   ```sql
   SELECT last_value, is_called FROM public.bill_number_seq;
   SELECT max(bill_seq), max(bill_number) FROM public.bills;
   ```
   > [!NOTE]
   > In Urbania Café, `bill_number_seq` starts at `1001`. Bill numbers are formatted as `UB-01001`, `UB-01002`, `UB-01003`, etc. (5-digit zero-padded string with prefix `UB-`). Do not expect `UB-00001`.

2. **Verify Settings & FSSAI Details**:
   ```sql
   SELECT legal_name, fssai_number, gst_status, bill_prefix FROM public.cafe_settings LIMIT 1;
   ```
   *Must return Urbania's registered 14-digit FSSAI number `12226032000212` and prefix `UB-`.*

3. **Verify Audit Trail Counts & Immutability**:
   ```sql
   SELECT event_type, count(*) FROM public.bill_audit_events GROUP BY event_type;
   SELECT has_table_privilege('authenticated', 'public.bill_audit_events', 'INSERT');
   ```
   *`can_insert` must return `false`. Direct inserts are revoked; all events are generated via security-definer RPCs.*

4. **Verify Table QR Tokens in `cafe_tables`**:
   ```sql
   SELECT table_number, label, qr_token, is_active FROM public.cafe_tables ORDER BY table_number;
   ```
   *(Note: The active database table is `public.cafe_tables`). Ensure all active tables have valid UUID QR tokens matching physical table QR stickers.*
