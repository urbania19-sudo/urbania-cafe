# Urbania Café — Excel Power Query Integration Guide

This guide describes how to connect a private Microsoft Excel Desktop workbook (using a personal or business Microsoft 365 / Office account) directly to Urbania Café's reporting endpoints using native Power Query.

> [!IMPORTANT]
> **No Paid Services Required**: This integration uses standard Excel Power Query (Get Data → From Web) with HTTP Bearer token authentication. It requires no Power BI Pro licenses, Microsoft Graph, Power Automate, or third-party connectors.

---

## 1. Security Architecture & Credentials

### Authentication Requirement
Every request must include an HTTP Authorization header:
```http
Authorization: Bearer <URBANIA_EXCEL_EXPORT_TOKEN>
```

- Requests without this header or with an incorrect token receive `401 Unauthorized`.
- If `URBANIA_EXCEL_EXPORT_TOKEN` is not configured on the server, endpoints fail closed with `500 Internal Server Error`.
- Tokens are **never** accepted in URL query parameters (to avoid token leakage in browser history, CDN logs, or reverse proxy access logs).
- Tokens are compared using constant-time SHA-256 cryptographic hashes (`crypto.timingSafeEqual`) to protect against timing attacks.
- Privileged database access is executed server-side via Supabase `adminDb()`; database service-role keys are never exposed to clients.
- If a database query fails, the server logs diagnostic details internally and returns a generic sanitized error (`HTTP 500`) to the client without exposing internal database structure. Failures are never disguised as empty reports.

### Server Environment Setup
Configure the dedicated secret in your Vercel project environment settings:

1. Open your project dashboard at [vercel.com](https://vercel.com).
2. Go to **Settings** → **Environment Variables**.
3. Add a new variable:
   - **Key**: `URBANIA_EXCEL_EXPORT_TOKEN`
   - **Value**: Generate a long, high-entropy random string (e.g. using `openssl rand -hex 32` or a password manager with 40+ characters). *Never commit this secret to Git.*
   - **Environments**: Select **Production** and optionally **Preview**.
4. Redeploy the application so the environment variable becomes active.

> [!WARNING]
> **Workbook Security**: The Power Query definition in your Excel file will contain your export token. 
> - Treat the Excel workbook as a confidential financial credential.
> - **Do not email or share the `.xlsx` workbook** with anyone who is not authorized to access café financial data.
> - **Never commit the `.xlsx` file to a public or shared Git repository.**

### Token Revocation and Rotation
If the token is ever compromised or exposed:
1. Immediately generate a new token string.
2. In Vercel Settings → Environment Variables, update `URBANIA_EXCEL_EXPORT_TOKEN` to the new string.
3. Redeploy the site in Vercel. All existing queries using the old token will immediately be rejected with `401 Unauthorized`.
4. In your Excel workbook, open **Home** → **Transform Data** → update the `UrbaniaExportToken` parameter with the new token.

---

## 2. API Endpoints & Response Contracts

All endpoints are strictly **read-only GET** endpoints (`POST`, `PUT`, `PATCH`, `DELETE` are rejected with `405 Method Not Allowed`). Responses include `Cache-Control: no-store, max-age=0`.

| Endpoint | Base Path | Description |
| :--- | :--- | :--- |
| **Bills** | `/api/reports/excel/bills` | Master ledger of issued and cancelled bills, totals, taxes, and customer details. |
| **Bill Items** | `/api/reports/excel/items` | Itemized line-by-line breakdown of ordered products, options, quantities, and line totals with item-level pagination. |
| **Audit Events** | `/api/reports/excel/events` | Operational security log of bill creation, reprints, cancellations, and views. |

### Query Parameters

All parameters are optional.

| Parameter | Type | Default | Allowed Values | Description |
| :--- | :--- | :--- | :--- | :--- |
| `limit` | integer | `200` | `1` to `1000` | Number of records per page (for `/items`, strictly bounds individual item rows). |
| `cursor` | string | `null` | URL-safe base64 | Opaque cursor token from the previous page's `next_cursor`. |
| `startDate` | string | `null` | `YYYY-MM-DD` | Inclusive start date in India Standard Time (`Asia/Kolkata`). Converted to UTC boundary (`00:00:00 IST` = `18:30:00Z` on previous day). |
| `endDate` | string | `null` | `YYYY-MM-DD` | Inclusive end date in India Standard Time (`Asia/Kolkata`). Converted to UTC boundary (`23:59:59.999 IST` = `18:29:59.999Z` on same day). |
| `status` | string | `all` | `all`, `issued`, `cancelled` | Filter bills/items by billing status (*Bills & Items only*). |
| `orderSource`| string | `all` | `all`, `qr`, `manual` | Filter by order channel (*Bills & Items only*). |
| `eventType` | string | `all` | `all`, `issued`, `reprinted`, `cancelled`, `viewed` | Filter by event type (*Events only*). |
| `billId` | string | `null` | UUID | Filter events for a specific bill (*Events only*). |
| `sort` | string | `desc` | `desc`, `asc` | Primary ordering by timestamp (`desc` = newest first). |

### Indian Business Date Boundaries (`Asia/Kolkata`)
The café operates in India Standard Time (UTC+05:30 with no daylight saving time). Date-only query parameters represent business dates in `Asia/Kolkata`:
- `startDate=2026-10-24` begins at `2026-10-24 00:00:00.000 IST`, querying database timestamps $\ge$ `2026-10-23T18:30:00.000Z`.
- `endDate=2026-10-24` ends at `2026-10-24 23:59:59.999 IST`, querying database timestamps $\le$ `2026-10-24T18:29:59.999Z`.
- Non-existent calendar dates (e.g. `2026-02-31`, `2026-04-31`) and unsupported timestamp formats are rejected with `HTTP 400 Bad Request`.

### Standard Response Envelope
```json
{
  "data": [ ... ],
  "next_cursor": "eyJ0IjoiMjAyNi0xMC0yNFQwODowMDowMC4wMDBaIiwiaWQiOiJmMTky...==",
  "has_more": true,
  "page_size": 200
}
```
When there are no further records, `next_cursor` is `null` and `has_more` is `false`.

---

## 3. Excel Setup: Shared Parameters

To keep your workbook organized and make token rotation easy, set up two Power Query Parameters once. All three report queries will reference them.

### Step 1: Open the Power Query Editor
1. In Excel Desktop, create a new blank workbook (e.g., `Urbania-Cafe-Ledger.xlsx`).
2. Go to the **Data** tab on the Excel ribbon.
3. Click **Get Data** → **Launch Power Query Editor...**.

### Step 2: Create Parameters
1. In Power Query Editor, click **Home** → **Manage Parameters** → **New Parameter**.
2. Create Parameter 1:
   - **Name**: `UrbaniaBaseUrl`
   - **Type**: Text
   - **Current Value**: `https://urbania-cafe.vercel.app` (or your custom domain)
3. Click **New** to create Parameter 2:
   - **Name**: `UrbaniaExportToken`
   - **Type**: Text
   - **Current Value**: Paste your `URBANIA_EXCEL_EXPORT_TOKEN` secret.
4. Click **OK**.

---

## 4. Query 1: Bills Ledger (`UrbaniaBills`)

### Step 1: Create Blank Query
1. In Power Query Editor, click **Home** → **New Source** → **Blank Query**.
2. Rename the query in the right-hand panel to `UrbaniaBills`.
3. Click **Home** → **Advanced Editor**.
4. Replace the entire contents with the following Power Query M code:

```powerquery
let
    // Base configuration from workbook parameters
    EndpointUrl = UrbaniaBaseUrl & "/api/reports/excel/bills",
    Token = UrbaniaExportToken,
    PageLimit = 200,

    // Helper function to fetch a single page with visible error handling
    FetchPage = (cursor as nullable text) =>
        let
            QueryParams = [
                limit = Text.From(PageLimit)
            ],
            QueryParamsWithCursor = if cursor <> null and cursor <> "" 
                then Record.AddField(QueryParams, "cursor", cursor) 
                else QueryParams,
            
            Source = Web.Contents(EndpointUrl, [
                Query = QueryParamsWithCursor,
                Headers = [
                    #"Authorization" = "Bearer " & Token,
                    #"Accept" = "application/json"
                ],
                ManualStatusHandling = {400, 401, 403, 404, 405, 500}
            ]),

            ResponseMeta = Value.Metadata(Source),
            HttpStatus = Record.FieldOrDefault(ResponseMeta, "Response.Status", 200),
            
            // Parse response body
            ParsedJson = try Json.Document(Source) otherwise null,
            ServerErrorMessage = if ParsedJson <> null and Record.HasFields(ParsedJson, "error") 
                then Text.From(ParsedJson[error]) 
                else "HTTP " & Text.From(HttpStatus)
        in
            if HttpStatus >= 400 then
                error Error.Record("UrbaniaApiError", "Urbania Café API error (" & Text.From(HttpStatus) & "): " & ServerErrorMessage, [Status = HttpStatus])
            else if ParsedJson = null or not Record.HasFields(ParsedJson, "data") or not (ParsedJson[data] is list) then
                error Error.Record("UrbaniaApiError", "Invalid API response structure: missing 'data' array", [Status = HttpStatus])
            else
                ParsedJson,

    // Paginate through all records using List.Generate until next_cursor is null.
    // Continues through valid empty pages when has_more is true.
    Pages = List.Generate(
        () => FetchPage(null),
        each _ <> null and Record.HasFields(_, "data"),
        each if Record.FieldOrDefault(_, "has_more", false) = true and Record.FieldOrDefault(_, "next_cursor", null) <> null
             then FetchPage([next_cursor])
             else null,
        each [data]
    ),

    // Combine all pages into a single record list
    CombinedList = List.Combine(Pages),

    // Convert record list into an Excel Table
    RawTable = if List.IsEmpty(CombinedList) 
        then #table({}, {}) 
        else Table.FromRecords(CombinedList),

    // Set standard data types for calculations and charts
    TypedTable = if Table.IsEmpty(RawTable) then RawTable else Table.TransformColumnTypes(RawTable, {
        {"bill_id", type text},
        {"bill_number", type text},
        {"order_id", type text},
        {"order_number", Int64.Type},
        {"issued_at", type datetimezone},
        {"issued_date_ist", type text},
        {"issued_time_ist", type text},
        {"order_source", type text},
        {"service_mode", type text},
        {"table_number", Int64.Type},
        {"table_label", type text},
        {"customer_name", type text},
        {"guest_count", Int64.Type},
        {"subtotal_paise", Int64.Type},
        {"subtotal_inr", type number},
        {"tax_rate", type number},
        {"tax_rate_percent", Int64.Type},
        {"tax_paise", Int64.Type},
        {"tax_inr", type number},
        {"total_paise", Int64.Type},
        {"total_inr", type number},
        {"status", type text},
        {"issued_by", type text},
        {"notes", type text},
        {"cancelled_at", type text},
        {"cancellation_reason", type text}
    })
in
    TypedTable
```

5. Click **Done**.

---

## 5. Query 2: Bill Line Items (`UrbaniaBillItems`)

This query imports individual item rows with enforced maximum page sizing, automatic multi-batch scanning, and stable ordering across bill boundaries.

### Step 1: Create Blank Query
1. In Power Query Editor, click **Home** → **New Source** → **Blank Query**.
2. Rename the query to `UrbaniaBillItems`.
3. Click **Home** → **Advanced Editor**.
4. Replace the code with:

```powerquery
let
    // Base configuration from workbook parameters
    EndpointUrl = UrbaniaBaseUrl & "/api/reports/excel/items",
    Token = UrbaniaExportToken,
    PageLimit = 200,

    // Helper function to fetch a single page of items with visible error handling
    FetchPage = (cursor as nullable text) =>
        let
            QueryParams = [
                limit = Text.From(PageLimit)
            ],
            QueryParamsWithCursor = if cursor <> null and cursor <> "" 
                then Record.AddField(QueryParams, "cursor", cursor) 
                else QueryParams,
            
            Source = Web.Contents(EndpointUrl, [
                Query = QueryParamsWithCursor,
                Headers = [
                    #"Authorization" = "Bearer " & Token,
                    #"Accept" = "application/json"
                ],
                ManualStatusHandling = {400, 401, 403, 404, 405, 500}
            ]),

            ResponseMeta = Value.Metadata(Source),
            HttpStatus = Record.FieldOrDefault(ResponseMeta, "Response.Status", 200),
            
            // Parse response body
            ParsedJson = try Json.Document(Source) otherwise null,
            ServerErrorMessage = if ParsedJson <> null and Record.HasFields(ParsedJson, "error") 
                then Text.From(ParsedJson[error]) 
                else "HTTP " & Text.From(HttpStatus)
        in
            if HttpStatus >= 400 then
                error Error.Record("UrbaniaApiError", "Urbania Café API error (" & Text.From(HttpStatus) & "): " & ServerErrorMessage, [Status = HttpStatus])
            else if ParsedJson = null or not Record.HasFields(ParsedJson, "data") or not (ParsedJson[data] is list) then
                error Error.Record("UrbaniaApiError", "Invalid API response structure: missing 'data' array", [Status = HttpStatus])
            else
                ParsedJson,

    // Paginate through all batches until next_cursor is null.
    // Continues through valid empty pages when has_more is true.
    Pages = List.Generate(
        () => FetchPage(null),
        each _ <> null and Record.HasFields(_, "data"),
        each if Record.FieldOrDefault(_, "has_more", false) = true and Record.FieldOrDefault(_, "next_cursor", null) <> null
             then FetchPage([next_cursor])
             else null,
        each [data]
    ),

    // Combine all item records
    CombinedList = List.Combine(Pages),

    // Convert into an Excel Table
    RawTable = if List.IsEmpty(CombinedList) 
        then #table({}, {}) 
        else Table.FromRecords(CombinedList),

    // Apply strict column data types
    TypedTable = if Table.IsEmpty(RawTable) then RawTable else Table.TransformColumnTypes(RawTable, {
        {"bill_id", type text},
        {"bill_number", type text},
        {"order_number", Int64.Type},
        {"item_id", type text},
        {"item_name", type text},
        {"item_type", type text},
        {"quantity", Int64.Type},
        {"unit_price_paise", Int64.Type},
        {"unit_price_inr", type number},
        {"line_total_paise", Int64.Type},
        {"line_total_inr", type number},
        {"selected_options", type text},
        {"item_note", type text},
        {"bill_status", type text},
        {"issued_at", type datetimezone}
    })
in
    TypedTable
```

5. Click **Done**.

---

## 6. Query 3: Audit Events (`UrbaniaAuditEvents`)

### Step 1: Create Blank Query
1. In Power Query Editor, click **Home** → **New Source** → **Blank Query**.
2. Rename the query to `UrbaniaAuditEvents`.
3. Click **Home** → **Advanced Editor**.
4. Replace the code with:

```powerquery
let
    // Base configuration from workbook parameters
    EndpointUrl = UrbaniaBaseUrl & "/api/reports/excel/events",
    Token = UrbaniaExportToken,
    PageLimit = 200,

    // Helper function to fetch a single page of audit events with visible error handling
    FetchPage = (cursor as nullable text) =>
        let
            QueryParams = [
                limit = Text.From(PageLimit)
            ],
            QueryParamsWithCursor = if cursor <> null and cursor <> "" 
                then Record.AddField(QueryParams, "cursor", cursor) 
                else QueryParams,
            
            Source = Web.Contents(EndpointUrl, [
                Query = QueryParamsWithCursor,
                Headers = [
                    #"Authorization" = "Bearer " & Token,
                    #"Accept" = "application/json"
                ],
                ManualStatusHandling = {400, 401, 403, 404, 405, 500}
            ]),

            ResponseMeta = Value.Metadata(Source),
            HttpStatus = Record.FieldOrDefault(ResponseMeta, "Response.Status", 200),
            
            // Parse response body
            ParsedJson = try Json.Document(Source) otherwise null,
            ServerErrorMessage = if ParsedJson <> null and Record.HasFields(ParsedJson, "error") 
                then Text.From(ParsedJson[error]) 
                else "HTTP " & Text.From(HttpStatus)
        in
            if HttpStatus >= 400 then
                error Error.Record("UrbaniaApiError", "Urbania Café API error (" & Text.From(HttpStatus) & "): " & ServerErrorMessage, [Status = HttpStatus])
            else if ParsedJson = null or not Record.HasFields(ParsedJson, "data") or not (ParsedJson[data] is list) then
                error Error.Record("UrbaniaApiError", "Invalid API response structure: missing 'data' array", [Status = HttpStatus])
            else
                ParsedJson,

    // Paginate through all audit events until next_cursor is null.
    // Continues through valid empty pages when has_more is true.
    Pages = List.Generate(
        () => FetchPage(null),
        each _ <> null and Record.HasFields(_, "data"),
        each if Record.FieldOrDefault(_, "has_more", false) = true and Record.FieldOrDefault(_, "next_cursor", null) <> null
             then FetchPage([next_cursor])
             else null,
        each [data]
    ),

    // Combine all pages
    CombinedList = List.Combine(Pages),

    // Convert into an Excel Table
    RawTable = if List.IsEmpty(CombinedList) 
        then #table({}, {}) 
        else Table.FromRecords(CombinedList),

    // Apply strict column types
    TypedTable = if Table.IsEmpty(RawTable) then RawTable else Table.TransformColumnTypes(RawTable, {
        {"event_id", type text},
        {"bill_id", type text},
        {"bill_number", type text},
        {"event_timestamp", type datetimezone},
        {"event_date_ist", type text},
        {"event_time_ist", type text},
        {"event_type", type text},
        {"actor_id", type text},
        {"actor_role", type text},
        {"actor_email", type text}
    })
in
    TypedTable
```

5. Click **Done**.

---

## 7. Loading Into Worksheets & Automatic Refresh

### Loading to Separate Worksheets
1. In the Power Query Editor, click **Home** → **Close & Load** (or **Close & Load To...**).
2. Choose **Table** on **New worksheet** for each query.
3. Rename the resulting worksheet tabs:
   - `Bills` (displays `UrbaniaBills`)
   - `Bill Items` (displays `UrbaniaBillItems`)
   - `Audit Events` (displays `UrbaniaAuditEvents`)

### Enabling Automatic Refresh
To refresh all tables on demand or automatically whenever the workbook is opened:

1. On the Excel ribbon, go to **Data** → **Queries & Connections**.
2. Right-click the `UrbaniaBills` query in the task pane → click **Properties**.
3. In the **Usage** tab:
   - Check **Refresh data when opening the file**.
   - (Optional) Check **Refresh every X minutes** (e.g. every 60 minutes).
4. Repeat for `UrbaniaBillItems` and `UrbaniaAuditEvents`.
5. Save the workbook (`Ctrl + S`).

Now, clicking **Data** → **Refresh All** (or `Ctrl + Alt + F5`) automatically pulls all new bills, items, and audit records into your Excel spreadsheet.
