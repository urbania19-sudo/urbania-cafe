# Urbania Café — Free Database Backup & Disaster Recovery Guide

This guide details zero-cost, reliable backup and recovery workflows for Urbania Café. Supabase PostgreSQL serves as the single authoritative source of truth for all business settings, menu items, table tokens, orders, bills, and immutable audit logs.

No external paid services, cloud subscriptions, or Google Cloud service accounts are required.

---

## 1. Overview of Free Backup Strategies

| Backup Method | Frequency | Format | Cost | Best For |
|---|---|---|---|---|
| **In-App CSV Audit Exports** | Daily / Weekly | RFC 4180 CSV (`.csv`) | Free | Instant offline review in Excel/Google Sheets; tax auditing; printable records |
| **Supabase CLI Logical Dump** | Weekly / Monthly | SQL Dump (`.sql`) | Free | Complete offline copy of schema, tables, and roles |
| **Direct `pg_dump` Stream** | Weekly / Pre-deploy | Plain SQL / Custom (`.dump`) | Free | Standard PostgreSQL backup via direct database connection |
| **Supabase Studio CSV Export** | Ad-hoc | CSV (`.csv`) | Free | Quick visual check and export directly from browser dashboard |

---

## 2. In-App Zero-Cost Transaction Exports (Daily Workflow)

Urbania Café includes a built-in Audit & Reports module accessible at `/admin/reports` by authenticated owners.

### Available Exports:
1. **Bills CSV (`/api/admin/reports/export/bills`)**:
   - Bill numbers (`UB-XXXXX`), order numbers, timestamps (ISO and IST).
   - Order source (`QR Code` vs `Counter / Manual`), service mode (`Dine-in`, `Takeaway`, etc.).
   - Item counts, subtotal, tax, and final amount in INR (₹).
   - Cancellation audit details (timestamp and reason).
2. **Bill Items CSV (`/api/admin/reports/export/items`)**:
   - Itemized lines snapshotting the exact historical price, quantity, custom notes, and customization flags at the time of billing.
3. **Audit Events CSV (`/api/admin/reports/export/events`)**:
   - Complete chronology of `issued`, `reprinted`, and `cancelled` operations with actor ID, email, role, and metadata.

> [!NOTE]
> All exports feature **UTF-8 Byte Order Marks (BOM)** for clean rendering in Microsoft Excel and automatic **Formula Injection Defense** (`'` prepended to `=`, `+`, `-`, `@`, `\t`, `\r` prefixes).

---

## 3. Full Database Backup via Supabase CLI

If you are using the local Supabase environment or have linked your hosted Supabase project, you can dump the entire database using the Supabase CLI.

### Step 3.1: Export Data Only
To export all records (settings, tables, orders, bills, audit events) while keeping the schema migrations separate:
```bash
# In your project folder:
npx supabase db dump --data-only -f supabase/backups/backup_data_$(date +%Y%m%d).sql
```
*(On Windows PowerShell)*:
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
npx supabase db dump --data-only -f "supabase/backups/data_backup_$date.sql"
```

### Step 3.2: Export Full Database (Schema + Data)
```powershell
$date = Get-Date -Format "yyyyMMdd_HHmm"
npx supabase db dump -f "supabase/backups/full_backup_$date.sql"
```

---

## 4. Full Database Backup via `pg_dump` (Hosted Cloud Supabase)

Hosted Supabase Free Tier allows direct PostgreSQL connections via port 5432 or port 6543 (transaction pooler). You can run PostgreSQL's standard `pg_dump` tool directly against your cloud database.

### Step 4.1: Retrieve Connection String
From your Supabase Dashboard:
1. Navigate to **Project Settings** > **Database**.
2. Under **Connection string**, select **URI**.
3. Format: `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

### Step 4.2: Execute `pg_dump`
```bash
# Create a logical backup file containing schema and data:
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  --no-owner \
  --no-privileges \
  --file="urbania_cloud_backup_$(date +%Y%m%d).sql"
```

---

## 5. Disaster Recovery & Restoration

### Scenario A: Restoring to Local Development Supabase
To restore a data dump into your local Supabase database:
```powershell
# 1. Reset database to latest migration state:
npx supabase db reset

# 2. Populate from backup SQL dump:
Get-Content "supabase/backups/data_backup_20261021.sql" | npx supabase db execute
```

### Scenario B: Restoring to Hosted Supabase via `psql`
```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  -f "urbania_cloud_backup_20261021.sql"
```

---

## 6. Post-Restoration Verification Checklist

After restoring data, execute these verification checks in Supabase Studio SQL Editor (`http://127.0.0.1:54323` locally or Cloud Dashboard):

1. **Verify Bill Sequence Continuity**:
   ```sql
   SELECT last_value FROM bill_number_seq;
   SELECT max(bill_seq) FROM bills;
   ```
   *Ensure the sequence is synchronized with the latest bill number.*

2. **Verify Settings & FSSAI Details**:
   ```sql
   SELECT legal_name, fssai_number, gst_status FROM cafe_settings LIMIT 1;
   ```
   *Must return Urbania's registered 14-digit FSSAI number `12226032000212`.*

3. **Verify Audit Trail Count**:
   ```sql
   SELECT event_type, count(*) FROM bill_audit_events GROUP BY event_type;
   ```
   *Ensure `issued`, `reprinted`, and `cancelled` counts match historical bill operations.*

4. **Verify Table QR Tokens**:
   ```sql
   SELECT table_number, label, qr_token, is_active FROM cafe_tables ORDER BY table_number;
   ```
   *Ensure all active tables have valid UUID QR tokens matching physical table QR stickers.*
