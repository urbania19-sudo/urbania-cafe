export interface BillItemSnapshot {
  id: string;
  name: string;
  unit_price_paise: number;
  quantity: number;
  line_total_paise: number;
  note?: string | null;
  selected_options?: { name: string; price_delta_paise: number }[];
  modifiers?: { name: string; price_delta_cents: number }[];
}

export interface BillBusinessSnapshot {
  cafe_name: string;
  legal_name?: string;
  fssai_number?: string;
  fssai_validity_date?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string | null;
  email?: string | null;
  gst_status?: "unconfirmed" | "registered" | "not_registered";
  gstin?: string | null;
  tax_treatment?: "inclusive" | "exclusive" | "none";
  bill_header_text?: string | null;
  bill_footer_text?: string | null;
}

export interface Bill {
  id: string;
  order_id: string;
  bill_number: string;
  bill_seq: number;
  order_number: number;
  table_number: number;
  table_label?: string;
  status: "issued" | "cancelled";
  document_type: "bill" | "tax_invoice";
  business_snapshot: BillBusinessSnapshot;
  items_snapshot: BillItemSnapshot[];
  subtotal_paise: number;
  tax_rate: number;
  tax_paise: number;
  total_paise: number;
  notes: string | null;
  issued_at: string;
  issued_by: string | null;
}

export function friendlyBillingError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (msg.includes("URB:forbidden")) return "You are not authorised to generate or view bills.";
  if (msg.includes("URB:not_found")) return "Order not found.";
  if (msg.includes("URB:order_cancelled")) return "Cannot generate a bill for a cancelled order.";
  if (msg.includes("URB:order_not_accepted")) return "Please accept the order before generating its bill.";
  if (msg.includes("URB:settings_missing")) return "Café settings are not configured in the database.";
  return msg || "An unexpected billing error occurred.";
}

export function isValidFssai(licence: string): boolean {
  return /^[0-9]{14}$/.test(licence.trim());
}

export function isValidGstin(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim());
}
