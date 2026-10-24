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

export type DiscountType = "fixed" | "percentage";

export interface DiscountInput {
  type: DiscountType;
  value: number; // in Rupees for fixed (e.g. 50), or percentage 0..100 (e.g. 10)
}

export interface DiscountCalculation {
  subtotalBeforeDiscountPaise: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountPaise: number;
  totalPaise: number;
  hasDiscount: boolean;
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
  subtotal_before_discount_paise?: number;
  discount_type?: DiscountType | null;
  discount_value?: number | null;
  discount_paise?: number;
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
  id: "sample",
  order_id: "00000000-0000-0000-0000-000000000000",
  bill_number: "UB-TEST-0001",
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
    legal_name: "URBANIA CAFE AND JUICE BAR",
    fssai_number: "12226032000212",
    fssai_validity_date: "2027-02-22",
    address_line1: "17/456, Chopasni Housing Board",
    city: "Jodhpur",
    state: "Rajasthan",
    pincode: "342008",
    pincode_verified: false,
    phone: null,
    gst_status: "unconfirmed",
    gstin: null,
    tax_treatment: "inclusive",
    bill_header_text: null,
    bill_footer_text: "Thank you for visiting Urbania Café!",
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
  subtotal_before_discount_paise: 35000,
  discount_type: null,
  discount_value: null,
  discount_paise: 0,
  subtotal_paise: 35000,
  tax_rate: 0,
  tax_paise: 0,
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

export interface EditOrderItemInput {
  menuItemId?: string;
  name?: string;
  quantity: number;
  unitPricePaise?: number;
  unitPriceRupees?: number;
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

/**
 * Calculates deterministic bill discount in paise.
 * Base: bill total before discount.
 * Fixed: value in INR converted to integer paise.
 * Percentage: deterministic rounding to nearest paise Math.round((base * pct) / 100).
 */
export function calculateBillDiscount(
  baseTotalPaise: number,
  discount?: { type?: string | null; value?: number | null } | null
): DiscountCalculation {
  if (baseTotalPaise < 0) {
    throw new Error("Invalid base total amount");
  }

  if (!discount || !discount.type || discount.value == null || discount.value === 0) {
    return {
      subtotalBeforeDiscountPaise: baseTotalPaise,
      discountType: null,
      discountValue: null,
      discountPaise: 0,
      totalPaise: baseTotalPaise,
      hasDiscount: false,
    };
  }

  const { type, value } = discount;

  if (typeof value !== "number" || isNaN(value) || !isFinite(value)) {
    throw new Error("Invalid discount value");
  }

  if (value < 0) {
    throw new Error(
      type === "fixed"
        ? "Fixed discount amount must be greater than zero"
        : "Percentage discount must be between 0 and 100"
    );
  }

  if (type === "percentage") {
    if (value > 100) {
      throw new Error("Percentage discount must be between 0 and 100");
    }
    const roundedValue = Math.round(value * 100) / 100;
    const discountPaise = Math.round((baseTotalPaise * roundedValue) / 100);
    const totalPaise = Math.max(0, baseTotalPaise - discountPaise);
    return {
      subtotalBeforeDiscountPaise: baseTotalPaise,
      discountType: "percentage",
      discountValue: roundedValue,
      discountPaise,
      totalPaise,
      hasDiscount: discountPaise > 0,
    };
  } else if (type === "fixed") {
    if (value <= 0) {
      throw new Error("Fixed discount amount must be greater than zero");
    }
    const roundedValue = Math.round(value * 100) / 100;
    const discountPaise = Math.round(roundedValue * 100);
    if (discountPaise > baseTotalPaise) {
      throw new Error("Discount amount cannot exceed total bill amount");
    }
    const totalPaise = Math.max(0, baseTotalPaise - discountPaise);
    return {
      subtotalBeforeDiscountPaise: baseTotalPaise,
      discountType: "fixed",
      discountValue: roundedValue,
      discountPaise,
      totalPaise,
      hasDiscount: discountPaise > 0,
    };
  } else {
    throw new Error("Invalid discount type. Must be 'fixed' or 'percentage'");
  }
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
  if (msg.includes("URB:invalid_discount_type")) {
    return "Invalid discount type. Please select Fixed Amount or Percentage.";
  }
  if (msg.includes("URB:invalid_discount_value")) {
    return "Invalid discount value. Please enter a valid non-negative amount or percentage up to 100%.";
  }
  if (msg.includes("URB:discount_exceeds_total")) {
    return "Discount cannot exceed the total bill amount.";
  }
  if (msg.includes("custom item name required")) return "Please enter a name for each custom line item.";
  if (msg.includes("invalid custom price")) return "Custom item price must be a valid non-negative amount.";
  if (msg.includes("already been billed")) return "This order has already been billed and cannot be edited.";
  if (msg.includes("active bill")) return "This order has an active bill and cannot be edited.";
  if (msg.includes("cannot be edited in")) return "This order cannot be edited because it is already completed or cancelled.";
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
