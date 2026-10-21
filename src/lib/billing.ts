export interface BillItemSnapshot {
  id: string;
  name: string;
  unit_price_paise: number;
  quantity: number;
  line_total_paise: number;
  note?: string | null;
  selected_options?: { name: string; price_delta_paise: number }[];
  modifiers?: { name: string; price_delta_cents: number }[];
  is_custom?: boolean;
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
  pincode_verified?: boolean;
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
  order_source?: "qr" | "manual";
  service_mode?: "dine_in" | "takeaway" | "counter" | "delivery";
  customer_name?: string | null;
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
  issued_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
}

export interface BillAuditEvent {
  id: string;
  bill_id: string;
  bill_number: string;
  event_type: "issued" | "reprinted" | "cancelled" | "viewed";
  actor_id: string | null;
  actor_role: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const SAMPLE_BILL: Bill = {
  id: "00000000-0000-0000-0000-000000000000",
  order_id: "00000000-0000-0000-0000-000000000000",
  bill_number: "URB-TEST-0001",
  bill_seq: 1,
  order_number: 101,
  table_number: 3,
  table_label: "Table 3",
  order_source: "manual",
  service_mode: "dine_in",
  customer_name: "Test Customer",
  status: "issued",
  document_type: "bill",
  business_snapshot: {
    cafe_name: "Urbania Café",
    legal_name: "Urbania Café",
    fssai_number: "12345678901234",
    address_line1: "Near City Center",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    phone: "+91 98765 43210",
    tax_treatment: "inclusive",
    bill_header_text: "Welcome to Urbania Café",
    bill_footer_text: "Thank you for dining with us!",
  },
  items_snapshot: [
    {
      id: "item-sample-1",
      name: "Cappuccino",
      unit_price_paise: 15000,
      quantity: 1,
      line_total_paise: 15000,
    },
    {
      id: "item-sample-2",
      name: "Blueberry Muffin",
      unit_price_paise: 20000,
      quantity: 1,
      line_total_paise: 20000,
    },
  ],
  subtotal_paise: 35000,
  tax_rate: 0.05,
  tax_paise: 1750,
  total_paise: 35000,
  notes: "Test thermal print for MX11 Fun Print alignment",
  issued_at: new Date().toISOString(),
};

export interface ManualOrderItemInput {
  menuItemId?: string;
  name?: string;
  quantity: number;
  unitPricePaise?: number;
  optionIds?: string[];
  note?: string;
  isCustom?: boolean;
}

export interface CreateManualOrderInput {
  serviceMode: "dine_in" | "takeaway" | "counter" | "delivery";
  tableId?: string;
  customerName?: string;
  customerNote?: string;
  guestCount?: number;
  items: ManualOrderItemInput[];
}

export function friendlyBillingError(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : String(err || "");
  if (msg.includes("URB:forbidden")) return "You are not authorised to generate or view bills.";
  if (msg.includes("URB:not_found")) return "Order not found.";
  if (msg.includes("URB:order_cancelled")) return "Cannot generate a bill for a cancelled order.";
  if (msg.includes("URB:order_not_accepted")) return "Please accept the order before generating its bill.";
  if (msg.includes("URB:settings_missing")) return "Café settings are not configured in the database.";
  if (msg.includes("URB:tax_invoice_not_configured")) {
    return "GST Tax Invoices are not yet enabled pending itemized tax calculation. Please keep GST status as Pending Registration or Not Registered in Settings.";
  }
  if (msg.includes("custom item name required")) return "Please enter a name for each custom line item.";
  if (msg.includes("invalid custom price")) return "Custom item price must be a valid non-negative amount.";
  if (msg.includes("invalid service mode")) return "Please select a valid service mode (Dine-in, Takeaway, Counter, or Delivery).";
  if (msg.includes("already_cancelled")) return "This bill has already been cancelled.";
  if (msg.includes("invalid quantity")) return "Item quantity must be between 1 and 20.";
  if (msg.includes("invalid item count")) return "An order must contain between 1 and 25 items.";
  if (msg.includes("order_source") || msg.includes("service_mode") || msg.includes("cancelled_at") || msg.includes("bill_audit_events")) {
    return "This operation requires database Migration 0009 to be applied to the database first.";
  }
  return msg || "An unexpected billing error occurred.";
}

export function isValidFssai(licence: string): boolean {
  return /^[0-9]{14}$/.test(licence.trim());
}

export function isValidGstin(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim());
}
