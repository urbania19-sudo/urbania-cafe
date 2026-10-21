import type { Bill, BillAuditEvent } from "@/lib/billing";

/**
 * Escapes a single cell for RFC 4180 CSV export with Spreadsheet Formula Injection defense.
 * If the string starts with '=', '+', '-', '@', '\t', or '\r', a leading single quote (')
 * is prepended so Excel and other spreadsheet applications treat it strictly as text.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // Formula injection defense (CSV / DDE injection prevention)
  if (/^\s*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If the cell contains quotes, commas, or newlines, enclose in quotes and double internal quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return `"${str}"`;
}

/**
 * Generates an RFC 4180 compliant CSV string with a UTF-8 Byte Order Mark (BOM).
 * The BOM (\uFEFF) ensures Microsoft Excel and spreadsheet tools open the file
 * with correct UTF-8 encoding for currency symbols and non-ASCII text.
 */
export function generateCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(","));
  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}\r\n`;
}

/**
 * Formats bills into the official Bills CSV export.
 */
export function exportBillsCsv(bills: Bill[]): string {
  const headers = [
    "Bill ID",
    "Bill Number",
    "Order ID",
    "Order Number",
    "Issued At (ISO)",
    "Issued Date (IST)",
    "Issued Time (IST)",
    "Order Source",
    "Service Mode",
    "Table Number",
    "Table Label",
    "Customer Name",
    "Guest Count",
    "Subtotal (₹)",
    "Tax Rate (%)",
    "Tax (₹)",
    "Total (₹)",
    "Status",
    "Issued By (User ID)",
    "Notes",
    "Cancelled At",
    "Cancellation Reason",
  ];

  const rows = bills.map((b) => {
    const dateObj = new Date(b.issued_at);
    const dateStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";
    const timeStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";

    return [
      b.id,
      b.bill_number,
      b.order_id,
      b.order_number,
      b.issued_at,
      dateStr,
      timeStr,
      b.order_source || "qr",
      b.service_mode || "dine_in",
      b.table_number ?? 0,
      b.table_label || "",
      b.customer_name || "",
      (b as unknown as { guest_count?: number }).guest_count ?? 1,
      (b.subtotal_paise / 100).toFixed(2),
      ((b.tax_rate || 0) * 100).toFixed(0),
      ((b.tax_paise || 0) / 100).toFixed(2),
      (b.total_paise / 100).toFixed(2),
      b.status,
      b.issued_by || "",
      b.notes || "",
      b.cancelled_at || "",
      b.cancellation_reason || "",
    ];
  });

  return generateCsv(headers, rows);
}

/**
 * Formats individual line items into the official Bill Items CSV export.
 * Avoids ambiguous row flattening by providing a clear, itemized dataset.
 */
export function exportBillItemsCsv(bills: Bill[]): string {
  const headers = [
    "Bill ID",
    "Bill Number",
    "Order Number",
    "Item ID",
    "Item Name",
    "Item Type",
    "Quantity",
    "Unit Price (₹)",
    "Line Total (₹)",
    "Selected Options",
    "Item Note",
    "Bill Status",
    "Issued At (ISO)",
  ];

  const rows: (string | number | boolean | null | undefined)[][] = [];

  for (const b of bills) {
    const items = b.items_snapshot || [];
    for (const item of items) {
      const optionsStr = item.selected_options?.map((o) => o.name).join("; ") || "";
      const itemType = item.is_custom ? "Custom Item" : "Catalogue";
      rows.push([
        b.id,
        b.bill_number,
        b.order_number,
        item.id,
        item.name,
        itemType,
        item.quantity,
        (item.unit_price_paise / 100).toFixed(2),
        (item.line_total_paise / 100).toFixed(2),
        optionsStr,
        item.note || "",
        b.status,
        b.issued_at,
      ]);
    }
  }

  return generateCsv(headers, rows);
}

/**
 * Formats audit logs into the official Audit Events CSV export.
 */
export function exportAuditEventsCsv(events: BillAuditEvent[]): string {
  const headers = [
    "Event ID",
    "Bill ID",
    "Bill Number",
    "Event Timestamp (ISO)",
    "Event Date (IST)",
    "Event Time (IST)",
    "Event Type",
    "Actor ID",
    "Actor Role",
    "Actor Email",
    "Metadata",
  ];

  const rows = events.map((e) => {
    const dateObj = new Date(e.created_at);
    const dateStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";
    const timeStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";

    return [
      e.id,
      e.bill_id,
      e.bill_number,
      e.created_at,
      dateStr,
      timeStr,
      e.event_type,
      e.actor_id || "",
      e.actor_role || "",
      e.actor_email || "",
      JSON.stringify(e.metadata || {}),
    ];
  });

  return generateCsv(headers, rows);
}
