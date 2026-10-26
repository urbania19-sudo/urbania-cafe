import type { Bill } from "@/lib/billing";

export interface ReceiptCanvasOptions {
  scale?: number; // 1 = 384px (exact 1:1 hardware dot pitch), 2 = 768px (crisp 2x)
  isReprint?: boolean;
  ticketType?: "new" | "addon" | "reprint";
  ticketNumber?: number;
}

export interface KitchenTicketOrderItem {
  id?: string;
  menu_item_id?: string | null;
  name?: string;
  item_name_snapshot?: string;
  quantity: number;
  quantity_display?: string;
  unit_price_paise?: number;
  note?: string | null;
  item_note?: string | null;
  is_custom?: boolean;
  selected_options?: { name: string }[];
  selected_options_snapshot?: { name: string }[] | unknown;
  is_addition_increase?: boolean;
}

export interface KitchenTicketOrder {
  id: string;
  order_number: number;
  status?: string;
  created_at?: string;
  customer_name?: string | null;
  guest_count?: number | null;
  customer_note?: string | null;
  service_mode?: string | null;
  table_label?: string | null;
  cafe_tables?: { label: string } | null;
  order_items: KitchenTicketOrderItem[];
  ticket_type?: "new" | "addon" | "reprint";
  ticket_number?: number;
}

export const SAMPLE_KITCHEN_ORDER: KitchenTicketOrder = {
  id: "sample",
  order_number: 101,
  status: "ACCEPTED",
  created_at: "2026-10-25T10:00:00.000Z",
  customer_name: "Walk-in Guest",
  guest_count: 2,
  customer_note: "Less spicy / quick please",
  service_mode: "dine_in",
  cafe_tables: { label: "Table 3" },
  order_items: [
    {
      id: "sample-item-1",
      name: "Cappuccino",
      item_name_snapshot: "Cappuccino",
      quantity: 2,
      note: "Extra hot",
      is_custom: false,
      selected_options: [{ name: "Oat Milk" }],
    },
    {
      id: "sample-item-2",
      name: "Masala Chai",
      item_name_snapshot: "Masala Chai",
      quantity: 1,
      note: "Less sugar",
      is_custom: true,
    },
  ],
};

/**
 * Detects whether a string is an unconfigured template placeholder
 * like "Your Café", "Sample café ordering setup", or empty.
 */
export function isPlaceholderTagline(text?: string | null): boolean {
  if (!text) return true;
  const normalized = text.trim().toLowerCase();
  const placeholders = [
    "your café",
    "your cafe",
    "(your café)",
    "(your cafe)",
    "sample café ordering setup",
    "sample cafe ordering setup",
    "sample ordering setup",
    "tagline",
    "sample tagline",
    "cafe tagline",
    "café tagline",
  ];
  return normalized.length === 0 || placeholders.includes(normalized);
}

/**
 * Returns a meaningful subtitle/tagline if present and non-placeholder.
 * Avoids echoing redundant names when cafe_name is essentially identical to legal_name.
 */
export function getMeaningfulTagline(biz: {
  cafe_name?: string | null;
  legal_name?: string | null;
}): string | null {
  if (!biz.cafe_name) return null;
  const name = biz.cafe_name.trim();
  if (isPlaceholderTagline(name)) return null;

  const normCafe = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normLegal = (biz.legal_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normCafe === normLegal || normLegal.startsWith(normCafe)) {
    return null;
  }

  return name;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    const testLine = currentLine ? currentLine + " " + word : word;
    const width = ctx.measureText(testLine).width;
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    if (ctx.measureText(currentLine).width > maxWidth && currentLine.length > 1) {
      let chunk = "";
      for (const char of currentLine) {
        if (ctx.measureText(chunk + char).width <= maxWidth) {
          chunk += char;
        } else {
          lines.push(chunk);
          chunk = char;
        }
      }
      if (chunk) lines.push(chunk);
    } else {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [text];
}

/**
 * Safely crops a thermal receipt or kitchen token canvas to its exact rendered content height.
 * Scans upward from the bottom of the canvas to detect the last row containing rendered ink
 * (including antialiased edge pixels), then adds a clean intentional bottom margin (e.g. 14px)
 * for the physical printer cutter.
 *
 * This prevents any software-generated trailing blank space or oversized canvas padding
 * from causing 58mm thermal printers (e.g. FunPrint MX11) to feed excess blank paper.
 */
export function cropCanvasToContent(
  canvas: HTMLCanvasElement,
  bottomPadding: number = 14,
): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.getImageData !== "function") return canvas;

  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return canvas;

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, width, height);
  } catch {
    return canvas;
  }

  const data = imgData.data;

  // Scan row by row from bottom to top.
  // The canvas background is filled with pure white (#ffffff, rgb(255, 255, 255)).
  // Dark text, dashed dividers, and antialiased text boundaries have rgb values < 245.
  let lastContentY = -1;
  for (let y = height - 1; y >= 0; y--) {
    let rowHasInk = false;
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // Any pixel with alpha > 20 and darker than pure white indicates rendered content
      if (a > 20 && (r < 245 || g < 245 || b < 245)) {
        rowHasInk = true;
        break;
      }
    }
    if (rowHasInk) {
      lastContentY = y;
      break;
    }
  }

  if (lastContentY < 0) {
    return canvas;
  }

  // Intentional cutter margin after the lowest rendered ink pixel
  const desiredHeight = Math.ceil(lastContentY + 1 + bottomPadding);

  // If desired height is smaller than current canvas height, crop precisely
  if (desiredHeight < height) {
    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = width;
    trimmedCanvas.height = desiredHeight;
    const tCtx = trimmedCanvas.getContext("2d");
    if (tCtx && typeof tCtx.drawImage === "function") {
      tCtx.drawImage(canvas, 0, 0);
      return trimmedCanvas;
    }
  }

  return canvas;
}

export interface PreparedReceiptItem {
  item: Bill["items_snapshot"][number];
  nameLines: string[];
  optionLines: string[];
  noteLines: string[];
}

export function layoutReceiptItem(
  ctx: CanvasRenderingContext2D,
  item: Bill["items_snapshot"][number],
  maxContentWidth: number,
  fontMono: string,
  fontSans: string,
): PreparedReceiptItem {
  ctx.font = `bold 18px ${fontMono}`;
  const nameLines = wrapText(ctx, item.name, maxContentWidth);

  let optionLines: string[] = [];
  if (item.selected_options && item.selected_options.length > 0) {
    ctx.font = `italic 14px ${fontMono}`;
    const optText = `+ ${item.selected_options.map((m) => m.name).join(", ")}`;
    optionLines = wrapText(ctx, optText, maxContentWidth - 8);
  }

  let noteLines: string[] = [];
  if (item.note) {
    ctx.font = `italic 14px ${fontSans}`;
    noteLines = wrapText(ctx, `Note: ${item.note}`, maxContentWidth - 8);
  }

  return { item, nameLines, optionLines, noteLines };
}

/**
 * Calculates total receipt height and renders the complete bill to an HTML5 canvas.
 * Target: 384 dots (48 mm printable area on 58 mm / 203 DPI mini thermal printers like MX11).
 *
 * Optimizations:
 * - Wasted blank thermal paper eliminated: tight, clean divider gaps and minimal margins.
 * - Single FSSAI print: printed only once in top header, duplicate footer FSSAI removed.
 * - Conditional GST: GST messages hidden when unregistered/pending; zero vertical space reserved.
 * - Strict parity maintained between Pass 1 (dry-run measurement) and Pass 2 (drawing).
 * - Safe content-boundary auto-crop detects last rendered content row and trims trailing whitespace.
 */
export function renderReceiptToCanvas(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): HTMLCanvasElement {
  const scale = options.scale ?? 1;
  const baseWidth = 384;
  const isReprint = !!options.isReprint;
  const biz = bill.business_snapshot;
  const hasDiscount = Boolean(bill.discount_paise && bill.discount_paise > 0);

  // Create canvas for measuring and rendering
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.scale(scale, scale);

  const fontMono =
    '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const fontSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Layout coordinate markers for 58 mm / 384px printhead
  const leftX = 14;
  const rightX = baseWidth - 14; // 370
  const centerX = baseWidth / 2; // 192
  const colQtyX = 150;           // centered quantity column
  const colRateRight = 260;      // right-aligned unit rate column
  const colAmtRight = rightX;    // right-aligned line total column (370)
  const maxContentWidth = rightX - leftX; // 356px

  const meaningfulTagline = getMeaningfulTagline(biz);

  // Pre-calculate line layouts for 100% mathematical parity between Pass 1 and Pass 2
  ctx.font = `bold 22px ${fontSans}`;
  const legalName = (biz.legal_name || "URBANIA CAFE AND JUICE BAR").toUpperCase();
  const legalLines = wrapText(ctx, legalName, maxContentWidth);

  let tagLines: string[] = [];
  if (meaningfulTagline) {
    ctx.font = `italic bold 14px ${fontSans}`;
    tagLines = wrapText(ctx, `(${meaningfulTagline})`, maxContentWidth);
  }

  ctx.font = `14px ${fontSans}`;
  const addressParts = [
    biz.address_line1 || "17/456, Chopasni Housing Board",
    biz.city || "Jodhpur",
    biz.state || "Rajasthan",
    biz.pincode ? `PIN: ${biz.pincode}` : "",
  ].filter(Boolean);
  const addressLines = wrapText(ctx, addressParts.join(", "), maxContentWidth);

  const preparedReceiptItems = (bill.items_snapshot || []).map((item) =>
    layoutReceiptItem(ctx, item, maxContentWidth, fontMono, fontSans),
  );

  let footerLines: string[] = [];
  if (biz.bill_footer_text) {
    ctx.font = `italic 14px ${fontSans}`;
    footerLines = wrapText(ctx, biz.bill_footer_text, maxContentWidth);
  }

  // ---------------------------------------------------------------------------
  // Height dry-run calculation (Pass 1)
  // Keeps exact vertical parity with Pass 2 so canvas height perfectly wraps text
  // ---------------------------------------------------------------------------
  let y = 20;

  // Header height: Café legal name (22px bold)
  y += (legalLines.length - 1) * 28;

  if (tagLines.length > 0) {
    y += tagLines.length * 20;
  }

  y += 6; // gap before address

  // Address (14px sans)
  y += addressLines.length * 19;

  if (biz.phone) y += 19;

  // Single FSSAI Licence Top Header (14px bold mono) — printed only once
  if (biz.fssai_number) y += 20;

  // Conditional GST Info (14px mono) — ONLY displayed if registered with actual GSTIN
  if (biz.gst_status === "registered" && biz.gstin) {
    y += 20;
  }

  // Divider + Document title (21px bold mono)
  y += 10 + 26; // divider clearance (10) + title ascender & breathing room (26)
  if (bill.status === "cancelled") y += 22;
  if (isReprint) y += 22;
  y += 10 + 21; // divider clearance (10) + metadata ascender & breathing room (21)

  // Metadata block (3 rows of 15px mono)
  y += 22; // Bill No & Order No
  y += 22; // Date & Time
  y += 22; // Table & Service Mode
  y += 10 + 21; // divider clearance (10) + header ascender & breathing room (21)

  // Table column headers (15px bold mono: ITEM, QTY, RATE, AMOUNT)
  y += 9; // divider under column headers

  // Items list (Multi-line item layout: 18px bold dish name + 16px pricing row)
  for (const prepared of preparedReceiptItems) {
    y += 24; // first line of dish name (10px clear space below divider or previous item)
    if (prepared.nameLines.length > 1) {
      y += (prepared.nameLines.length - 1) * 22;
    }

    // Line 2: QTY, RATE, AMOUNT
    y += 20;

    // Modifiers / options (14px italic mono)
    if (prepared.optionLines.length > 0) {
      y += prepared.optionLines.length * 18;
    }

    // Preparation notes (14px italic sans)
    if (prepared.noteLines.length > 0) {
      y += prepared.noteLines.length * 18;
    }

    y += 12; // deliberate spacing between item blocks
  }

  // Divider + Totals
  y += 10 + 23; // divider clearance (10) + subtotal ascender & breathing room (23)
  if (bill.tax_paise > 0 && biz.gst_status === "registered") y += 22; // GST (17px mono)
  if (hasDiscount) y += 22; // Discount row (17px mono)
  y += 10 + 28; // divider clearance (10) + final amount ascender & breathing room (28)
  y += 12 + 21; // divider clearance (12) + footer ascender & breathing room (21)

  // Footer text
  if (footerLines.length > 0) {
    if (footerLines.length > 1) {
      y += (footerLines.length - 1) * 18;
    }
  }
  // No duplicate FSSAI in footer — single FSSAI printed in top header only
  y += 14; // Clean, intentional 14px bottom margin for thermal paper cutter

  const totalHeight = Math.ceil(y);
  canvas.height = totalHeight * scale;

  // Re-acquire context after canvas height resize
  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) throw new Error("Canvas 2D context not available");

  renderCtx.scale(scale, scale);

  // Fill pure white background
  renderCtx.fillStyle = "#ffffff";
  renderCtx.fillRect(0, 0, baseWidth, totalHeight);

  // High-contrast black ink for thermal printhead
  renderCtx.fillStyle = "#000000";
  renderCtx.strokeStyle = "#000000";
  renderCtx.lineWidth = 1;
  (renderCtx as unknown as { textRendering?: string }).textRendering = "geometricPrecision";
  (renderCtx as unknown as { imageSmoothingQuality?: string }).imageSmoothingQuality = "high";

  function drawDashedLine(lineY: number) {
    if (!renderCtx) return;
    renderCtx.save();
    renderCtx.setLineDash([4, 3]);
    renderCtx.lineWidth = 1;
    const yCoord = Math.round(lineY) + 0.5;
    renderCtx.beginPath();
    renderCtx.moveTo(leftX, yCoord);
    renderCtx.lineTo(rightX, yCoord);
    renderCtx.stroke();
    renderCtx.restore();
  }

  // ---------------------------------------------------------------------------
  // Drawing pass (Pass 2)
  // ---------------------------------------------------------------------------
  let curY = 20;

  // 1. Café Legal Name (22px bold — prominent primary branding)
  renderCtx.font = `bold 22px ${fontSans}`;
  renderCtx.textAlign = "center";
  renderCtx.fillText(legalLines[0] || legalName, centerX, curY);
  for (let k = 1; k < legalLines.length; k++) {
    curY += 28;
    renderCtx.fillText(legalLines[k] || "", centerX, curY);
  }

  // 2. Meaningful Tagline / Subtitle (only if genuine, placeholder suppressed)
  if (tagLines.length > 0) {
    renderCtx.font = `italic bold 14px ${fontSans}`;
    for (const line of tagLines) {
      curY += 20;
      renderCtx.fillText(line, centerX, curY);
    }
  }

  curY += 6;

  // 3. Address (14px sans)
  renderCtx.font = `14px ${fontSans}`;
  for (const line of addressLines) {
    curY += 19;
    renderCtx.fillText(line, centerX, curY);
  }

  // 4. Phone (14px sans)
  if (biz.phone) {
    curY += 19;
    renderCtx.fillText(`Tel: ${biz.phone}`, centerX, curY);
  }

  // 5. Single FSSAI Licence Top Header (14px bold mono) — printed once
  if (biz.fssai_number) {
    curY += 20;
    renderCtx.font = `bold 14px ${fontMono}`;
    renderCtx.fillText(`FSSAI Lic No: ${biz.fssai_number}`, centerX, curY);
  }

  // 6. Conditional GST Info (14px mono) — ONLY displayed if registered with actual GSTIN
  if (biz.gst_status === "registered" && biz.gstin) {
    curY += 20;
    renderCtx.font = `bold 14px ${fontMono}`;
    renderCtx.fillText(`GSTIN: ${biz.gstin}`, centerX, curY);
  }

  curY += 10;
  drawDashedLine(curY);
  curY += 26;

  // 7. Document Title (21px bold mono)
  renderCtx.font = `bold 21px ${fontMono}`;
  const docTitle =
    bill.document_type === "tax_invoice" && biz.gst_status === "registered"
      ? "TAX INVOICE"
      : "BILL / CASH RECEIPT";
  renderCtx.fillText(docTitle, centerX, curY);

  if (bill.status === "cancelled") {
    curY += 22;
    renderCtx.font = `bold 15px ${fontMono}`;
    renderCtx.fillText("*** CANCELLED / VOID ***", centerX, curY);
  }

  if (isReprint) {
    curY += 22;
    renderCtx.font = `bold 15px ${fontMono}`;
    renderCtx.fillText("*** DUPLICATE / REPRINT ***", centerX, curY);
  }

  curY += 10;
  drawDashedLine(curY);
  curY += 21;

  // 8. Metadata block (15px mono, 2 columns)
  renderCtx.font = `15px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(`Bill No:  ${bill.bill_number}`, leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`Order: #${bill.order_number}`, rightX, curY);
  curY += 22;

  const dateObj = new Date(bill.issued_at);
  const dateStr = dateObj.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = dateObj.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  renderCtx.textAlign = "left";
  renderCtx.fillText(`Date:     ${dateStr}`, leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`Time:  ${timeStr}`, rightX, curY);
  curY += 22;

  renderCtx.textAlign = "left";
  const hasSpecificTable = Boolean(bill.table_label || bill.table_number);
  const tableDisplay = hasSpecificTable
    ? (bill.table_label || `Table ${bill.table_number}`)
    : null;
  const serviceLabel =
    bill.service_mode === "takeaway"
      ? "Takeaway"
      : bill.service_mode === "delivery"
        ? "Delivery"
        : bill.service_mode === "counter"
          ? "Counter"
          : "Dine-in";

  if (tableDisplay) {
    renderCtx.fillText(`Table:    ${tableDisplay}`, leftX, curY);
    renderCtx.textAlign = "right";
    renderCtx.fillText(serviceLabel, rightX, curY);
  } else {
    renderCtx.fillText(`Service:  ${serviceLabel}`, leftX, curY);
  }
  curY += 22;

  curY += 10;
  drawDashedLine(curY);
  curY += 21;

  // 9. Items table column headers (15px bold mono)
  renderCtx.font = `bold 15px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("ITEM", leftX, curY);
  renderCtx.textAlign = "center";
  renderCtx.fillText("QTY", colQtyX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText("RATE", colRateRight, curY);
  renderCtx.fillText("AMOUNT", colAmtRight, curY);

  curY += 9;
  drawDashedLine(curY);

  // 10. Items list (Multi-line layout: 18px bold dish name + 16px QTY/RATE/AMOUNT)
  for (const prepared of preparedReceiptItems) {
    curY += 24; // first line of dish name (10px clear space below divider or previous item)
    const item = prepared.item;
    const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
    const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);

    // Line 1: Item dish name (18px bold mono, full printable width)
    renderCtx.font = `bold 18px ${fontMono}`;
    renderCtx.textAlign = "left";
    renderCtx.fillText(prepared.nameLines[0] || item.name, leftX, curY);

    // Subsequent wrapped lines for long names (indented 8px)
    for (let k = 1; k < prepared.nameLines.length; k++) {
      curY += 22;
      renderCtx.fillText(prepared.nameLines[k] || "", leftX + 8, curY);
    }

    // Line 2: Pricing row (16px mono, clearly aligned with column headers)
    curY += 20;
    renderCtx.font = `16px ${fontMono}`;
    renderCtx.textAlign = "center";
    renderCtx.fillText(String(item.quantity), colQtyX, curY);

    renderCtx.textAlign = "right";
    renderCtx.fillText((unitPaise / 100).toFixed(2), colRateRight, curY);
    renderCtx.fillText((linePaise / 100).toFixed(2), colAmtRight, curY);

    // Selected options / modifiers (14px italic mono, indented 8px)
    if (prepared.optionLines.length > 0) {
      renderCtx.font = `italic 14px ${fontMono}`;
      renderCtx.textAlign = "left";
      for (const line of prepared.optionLines) {
        curY += 18;
        renderCtx.fillText(line, leftX + 8, curY);
      }
    }

    // Preparation note (14px italic sans, indented 8px)
    if (prepared.noteLines.length > 0) {
      renderCtx.font = `italic 14px ${fontSans}`;
      renderCtx.textAlign = "left";
      for (const line of prepared.noteLines) {
        curY += 18;
        renderCtx.fillText(line, leftX + 8, curY);
      }
    }

    curY += 12; // deliberate spacing between items
  }

  curY += 10;
  drawDashedLine(curY);
  curY += 23;

  // 11. Summary totals (17px mono subtotal & tax, 22px bold total)
  const subtotalPaise = bill.subtotal_paise ?? (bill as unknown as { subtotal_cents: number }).subtotal_cents ?? 0;
  const taxPaise = bill.tax_paise ?? (bill as unknown as { tax_cents: number }).tax_cents ?? 0;
  const totalPaise = bill.total_paise ?? (bill as unknown as { total_cents: number }).total_cents ?? 0;
  const discountPaise = bill.discount_paise ?? 0;
  const subtotalBeforeDiscountPaise =
    bill.subtotal_before_discount_paise ?? (totalPaise + discountPaise);

  renderCtx.font = `17px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(hasDiscount ? "BILL TOTAL:" : "Subtotal:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${((hasDiscount ? subtotalBeforeDiscountPaise : subtotalPaise) / 100).toFixed(2)}`, rightX, curY);

  if (taxPaise > 0 && biz.gst_status === "registered") {
    curY += 22;
    renderCtx.textAlign = "left";
    const taxLabel = bill.tax_rate
      ? biz.tax_treatment === "inclusive"
        ? `Incl. GST (${(bill.tax_rate * 100).toFixed(0)}%):`
        : `GST (${(bill.tax_rate * 100).toFixed(0)}%):`
      : "Tax:";
    renderCtx.fillText(taxLabel, leftX, curY);
    renderCtx.textAlign = "right";
    renderCtx.fillText(`₹${(taxPaise / 100).toFixed(2)}`, rightX, curY);
  }

  if (hasDiscount) {
    curY += 22;
    let discountLabel = "Discount:";
    if (bill.discount_type === "percentage" && bill.discount_value != null) {
      discountLabel = `Discount (${bill.discount_value}%):`;
    } else if (bill.discount_type === "fixed" && bill.discount_value != null) {
      discountLabel = `Discount (₹${bill.discount_value}):`;
    } else if (bill.discount_type === "percentage") {
      const pct = Math.round((discountPaise / (subtotalBeforeDiscountPaise || 1)) * 100);
      discountLabel = `Discount (${pct}%):`;
    } else if (bill.discount_type === "fixed") {
      discountLabel = `Discount (₹${(discountPaise / 100).toFixed(2)}):`;
    }
    renderCtx.textAlign = "left";
    renderCtx.fillText(discountLabel, leftX, curY);
    renderCtx.textAlign = "right";
    renderCtx.fillText(`-₹${(discountPaise / 100).toFixed(2)}`, rightX, curY);
  }

  curY += 10;
  drawDashedLine(curY);
  curY += 28;

  // 12. Final Total Amount (22px bold mono — high visual prominence)
  renderCtx.font = `bold 22px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(hasDiscount ? "AMOUNT TO PAY:" : "TOTAL AMOUNT:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${(totalPaise / 100).toFixed(2)}`, rightX, curY);

  curY += 12;
  drawDashedLine(curY);
  curY += 21;

  // 13. Footer (pure customer message, no duplicate FSSAI)
  renderCtx.textAlign = "center";
  if (footerLines.length > 0) {
    renderCtx.font = `italic 14px ${fontSans}`;
    renderCtx.fillText(footerLines[0] || "", centerX, curY);
    for (let k = 1; k < footerLines.length; k++) {
      curY += 18;
      renderCtx.fillText(footerLines[k] || "", centerX, curY);
    }
  }

  curY += 14; // Clean intentional 14px bottom margin for thermal paper cutter

  // Trim canvas height so printer does not feed excess blank thermal paper
  const contentHeight = Math.ceil(curY);
  let finalCanvas = canvas;
  if (contentHeight !== totalHeight) {
    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = baseWidth * scale;
    trimmedCanvas.height = contentHeight * scale;
    const tCtx = trimmedCanvas.getContext("2d");
    if (tCtx && typeof tCtx.drawImage === "function") {
      tCtx.drawImage(canvas, 0, 0);
      finalCanvas = trimmedCanvas;
    }
  }

  // Safe content-boundary auto-crop detects actual rendered content ink and trims trailing whitespace
  return cropCanvasToContent(finalCanvas, 14 * scale);
}

export interface PreparedKitchenItem {
  nameLines: string[];
  optionLines: string[];
  noteLines: string[];
}

export function layoutKitchenItem(
  ctx: CanvasRenderingContext2D,
  item: KitchenTicketOrder["order_items"][number],
  maxContentWidth: number,
  fontSans: string,
  fontMono: string,
): PreparedKitchenItem {
  const rawName = item.item_name_snapshot || item.name || "Dish";
  const qtyPrefix = item.quantity_display || `${item.quantity}×`;
  const displayName = `${qtyPrefix} ${item.is_custom ? `[CUSTOM] ${rawName}` : rawName}`;

  ctx.font = `bold 21px ${fontSans}`;
  const nameLines = wrapText(ctx, displayName, maxContentWidth);

  const optionsList = Array.isArray(item.selected_options)
    ? item.selected_options
    : Array.isArray(item.selected_options_snapshot)
    ? (item.selected_options_snapshot as { name: string }[])
    : [];

  let optionLines: string[] = [];
  if (optionsList.length > 0) {
    ctx.font = `italic 15px ${fontMono}`;
    const optText = `+ ${optionsList.map((m) => m.name).join(", ")}`;
    optionLines = wrapText(ctx, optText, maxContentWidth - 16);
  }

  let noteLines: string[] = [];
  const noteText = item.note || item.item_note;
  if (noteText) {
    ctx.font = `italic 15px ${fontSans}`;
    noteLines = wrapText(ctx, `Note: ${noteText}`, maxContentWidth - 16);
  }

  return { nameLines, optionLines, noteLines };
}

/**
 * Calculates total kitchen token height and renders a dedicated Kitchen Order Ticket (KOT)
 * to an HTML5 canvas. Target: 384 dots (58 mm thermal printers).
 *
 * Requirements:
 * - Large readable order token/number and service mode/table.
 * - Timestamp, customer name, and customer notes.
 * - Items list with quantities, dish names, modifiers, and preparation instructions.
 * - Custom dishes clearly tagged.
 * - ZERO pricing, subtotal, tax, discounts, totals, GST, or FSSAI information.
 * - Reusable and re-printable at any time without duplicating orders or mutating bills.
 */
export function renderKitchenTicketToCanvas(
  order: KitchenTicketOrder,
  options: ReceiptCanvasOptions = {},
): HTMLCanvasElement {
  const scale = options.scale ?? 1;
  const baseWidth = 384;
  const isReprint = Boolean(options.isReprint);

  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.scale(scale, scale);

  const fontMono =
    '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const fontSans =
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const leftX = 14;
  const rightX = baseWidth - 14; // 370
  const centerX = baseWidth / 2; // 192
  const maxContentWidth = rightX - leftX; // 356px

  const rawTable = order.table_label || order.cafe_tables?.label;
  const tableDisplay = rawTable
    ? rawTable.toUpperCase()
    : (order.service_mode ? order.service_mode.toUpperCase().replace("_", " ") : "COUNTER / TAKEAWAY");

  const dateObj = order.created_at ? new Date(order.created_at) : new Date();
  const dateStr = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const timeStr = dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  const guestCountStr = order.guest_count ? ` (${order.guest_count} guests)` : "";

  const explicitType = options.ticketType || order.ticket_type;
  const isAddon = explicitType === "addon";
  const isFullReprint = explicitType === "reprint" || isReprint;
  const isNewExplicit = explicitType === "new";

  let orderTitle = `ORDER #${order.order_number}`;
  let bannerText: string | null = null;

  if (isAddon) {
    orderTitle = `ADD-ON ORDER #${order.order_number}`;
    bannerText = "*** ADD-ON ITEMS ONLY ***";
  } else if (isNewExplicit) {
    orderTitle = `NEW ORDER — ORDER #${order.order_number}`;
  } else if (isFullReprint) {
    bannerText = "*** DUPLICATE KITCHEN TICKET — FULL ORDER ***";
  }

  // Pre-calculate item layouts using ctx so that Pass 1 and Pass 2 share identical line measurements
  const preparedItems = (order.order_items || []).map((item) =>
    layoutKitchenItem(ctx, item, maxContentWidth, fontSans, fontMono),
  );

  // Measure title font size dynamically to fit within 356px maxContentWidth
  let titleFontSize = 34;
  ctx.font = `bold ${titleFontSize}px ${fontMono}`;
  while (titleFontSize > 20 && ctx.measureText(orderTitle).width > maxContentWidth) {
    titleFontSize -= 2;
    ctx.font = `bold ${titleFontSize}px ${fontMono}`;
  }

  // ---------------------------------------------------------------------------
  // Height dry-run calculation (Pass 1)
  // ---------------------------------------------------------------------------
  let y = 20;

  // Header Title: URBANIA CAFE — KITCHEN TOKEN (17px bold mono)
  ctx.font = `bold 17px ${fontMono}`;
  y += 36; // line height to order number

  // Order / Token Number: Prominent bold mono
  ctx.font = `bold ${titleFontSize}px ${fontMono}`;
  y += 32; // line height to banner or table
  if (bannerText) {
    ctx.font = `bold 14px ${fontMono}`;
    y += 24;
  }

  // Table / Service Mode (19px bold mono)
  ctx.font = `bold 19px ${fontMono}`;
  y += 24; // line height to timestamp

  // Timestamp (15px mono)
  ctx.font = `15px ${fontMono}`;
  y += 22;

  // Guest Info (16px sans)
  if (order.customer_name) {
    ctx.font = `16px ${fontSans}`;
    y += 22;
  }

  // Customer / Order Note (16px sans italic)
  if (order.customer_note) {
    ctx.font = `italic 16px ${fontSans}`;
    const noteLines = wrapText(ctx, `Note: ${order.customer_note}`, maxContentWidth);
    y += noteLines.length * 22;
  }

  // Divider + Section Title: ITEMS TO PREPARE (16px bold mono)
  y += 10 + 22; // divider clearance (10) + section title ascender & breathing room (22)
  ctx.font = `bold 16px ${fontMono}`;
  y += 10 + 28; // divider clearance (10) + first item 21px ascender & breathing room (28)

  // Items List (21px bold sans for far-view kitchen visibility)
  for (let i = 0; i < preparedItems.length; i++) {
    const itemLayout = preparedItems[i];
    if (itemLayout.nameLines.length > 1) {
      y += (itemLayout.nameLines.length - 1) * 26;
    }
    if (itemLayout.optionLines.length > 0) {
      y += 22 + (itemLayout.optionLines.length - 1) * 20;
    }
    if (itemLayout.noteLines.length > 0) {
      y += 22 + (itemLayout.noteLines.length - 1) * 20;
    }
    // Deliberate 34px spacing between items (13px clear vertical whitespace between item boundaries)
    if (i < preparedItems.length - 1) {
      y += 34;
    }
  }

  // Footer: Not a Bill
  y += 16; // divider clearance (16) from last item
  y += 20; // divider to footer baseline (20)
  ctx.font = `bold 13px ${fontMono}`;
  y += 14; // clean intentional bottom margin for thermal paper cutter

  const totalHeight = Math.ceil(y);
  canvas.height = totalHeight * scale;

  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) throw new Error("Canvas 2D context not available");

  renderCtx.scale(scale, scale);

  renderCtx.fillStyle = "#ffffff";
  renderCtx.fillRect(0, 0, baseWidth, totalHeight);

  renderCtx.fillStyle = "#000000";
  renderCtx.strokeStyle = "#000000";
  renderCtx.lineWidth = 1;
  (renderCtx as unknown as { textRendering?: string }).textRendering = "geometricPrecision";
  (renderCtx as unknown as { imageSmoothingQuality?: string }).imageSmoothingQuality = "high";

  function drawDashedLine(lineY: number) {
    if (!renderCtx) return;
    renderCtx.save();
    renderCtx.setLineDash([4, 3]);
    renderCtx.lineWidth = 1;
    const yCoord = Math.round(lineY) + 0.5;
    renderCtx.beginPath();
    renderCtx.moveTo(leftX, yCoord);
    renderCtx.lineTo(rightX, yCoord);
    renderCtx.stroke();
    renderCtx.restore();
  }

  // ---------------------------------------------------------------------------
  // Drawing pass (Pass 2)
  // ---------------------------------------------------------------------------
  let curY = 20;

  // Header Title (17px bold mono)
  renderCtx.font = `bold 17px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("URBANIA CAFE — KITCHEN TOKEN", leftX, curY);
  curY += 36;

  // Token / Order Number (Prominent bold mono for distant visibility)
  renderCtx.font = `bold ${titleFontSize}px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(orderTitle, leftX, curY);
  curY += 32;

  if (bannerText) {
    renderCtx.font = `bold 14px ${fontMono}`;
    renderCtx.textAlign = "left";
    renderCtx.fillText(bannerText, leftX, curY);
    curY += 24;
  }

  // Service Mode & Table (19px bold mono)
  renderCtx.font = `bold 19px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(tableDisplay, leftX, curY);
  if (rawTable && order.service_mode) {
    renderCtx.font = `15px ${fontMono}`;
    renderCtx.textAlign = "right";
    renderCtx.fillText(order.service_mode.toUpperCase().replace("_", " "), rightX, curY);
    renderCtx.textAlign = "left";
  }
  curY += 24;

  // Timestamp (15px mono)
  renderCtx.font = `15px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(`Time: ${dateStr} · ${timeStr}`, leftX, curY);
  curY += 22;

  // Guest Details (16px sans)
  if (order.customer_name) {
    renderCtx.font = `16px ${fontSans}`;
    renderCtx.textAlign = "left";
    renderCtx.fillText(`Guest: ${order.customer_name}${guestCountStr}`, leftX, curY);
    curY += 22;
  }

  // Order Note (16px italic sans)
  if (order.customer_note) {
    renderCtx.font = `italic 16px ${fontSans}`;
    renderCtx.textAlign = "left";
    const renderNoteLines = wrapText(renderCtx, `Note: ${order.customer_note}`, maxContentWidth);
    for (const line of renderNoteLines) {
      renderCtx.fillText(line, leftX, curY);
      curY += 22;
    }
  }

  curY += 10;
  drawDashedLine(curY);
  curY += 22;

  // Items Section Header (16px bold mono)
  renderCtx.font = `bold 16px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("ITEMS TO PREPARE", leftX, curY);

  curY += 10;
  drawDashedLine(curY);
  curY += 28;

  // Items List (21px bold sans for far-view readability)
  for (let i = 0; i < preparedItems.length; i++) {
    const itemLayout = preparedItems[i];

    renderCtx.font = `bold 21px ${fontSans}`;
    renderCtx.textAlign = "left";
    renderCtx.fillText(itemLayout.nameLines[0] || "", leftX, curY);

    for (let k = 1; k < itemLayout.nameLines.length; k++) {
      curY += 26;
      renderCtx.fillText(itemLayout.nameLines[k] || "", leftX + 16, curY);
    }

    if (itemLayout.optionLines.length > 0) {
      curY += 22;
      renderCtx.font = `italic 15px ${fontMono}`;
      renderCtx.textAlign = "left";
      renderCtx.fillText(itemLayout.optionLines[0] || "", leftX + 16, curY);
      for (let k = 1; k < itemLayout.optionLines.length; k++) {
        curY += 20;
        renderCtx.fillText(itemLayout.optionLines[k] || "", leftX + 16, curY);
      }
    }

    if (itemLayout.noteLines.length > 0) {
      curY += 22;
      renderCtx.font = `italic 15px ${fontSans}`;
      renderCtx.textAlign = "left";
      renderCtx.fillText(itemLayout.noteLines[0] || "", leftX + 16, curY);
      for (let k = 1; k < itemLayout.noteLines.length; k++) {
        curY += 20;
        renderCtx.fillText(itemLayout.noteLines[k] || "", leftX + 16, curY);
      }
    }

    // Deliberate 34px spacing to next item (prevents vertical overlapping across dish lines)
    if (i < preparedItems.length - 1) {
      curY += 34;
    }
  }

  curY += 16;
  drawDashedLine(curY);
  curY += 20;

  // Footer: Not a Bill (13px bold mono)
  renderCtx.font = `bold 13px ${fontMono}`;
  renderCtx.textAlign = "center";
  renderCtx.fillText("*** KITCHEN COPY — NOT A BILL ***", centerX, curY);
  curY += 14;

  const contentHeight = Math.ceil(curY);
  let finalCanvas = canvas;
  if (contentHeight !== totalHeight) {
    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = baseWidth * scale;
    trimmedCanvas.height = contentHeight * scale;
    const tCtx = trimmedCanvas.getContext("2d");
    if (tCtx && typeof tCtx.drawImage === "function") {
      tCtx.drawImage(canvas, 0, 0);
      finalCanvas = trimmedCanvas;
    }
  }

  return cropCanvasToContent(finalCanvas, 14 * scale);
}

export function exportKitchenTicketDataUrl(
  order: KitchenTicketOrder,
  options: ReceiptCanvasOptions = {},
): string {
  const canvas = renderKitchenTicketToCanvas(order, options);
  return canvas.toDataURL("image/png");
}

export async function exportReceiptBlob(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): Promise<Blob> {
  const canvas = renderReceiptToCanvas(bill, options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export receipt image"));
    }, "image/png");
  });
}

/**
 * Returns a high-quality data URL (base64) of the 384px thermal receipt image.
 * This is crucial for rendering a native <img> element on mobile iOS so users
 * can press and hold (long-press) to select "Save to Photos".
 */
export function exportReceiptDataUrl(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): string {
  const canvas = renderReceiptToCanvas(bill, options);
  return canvas.toDataURL("image/png");
}

export interface SharingCapabilities {
  isSecureContext: boolean;
  canShare: boolean;
  canShareFiles: boolean;
  isIOS: boolean;
}

/**
 * Accurately determines sharing capabilities and platform constraints.
 * Specifically checks window.isSecureContext because Web Share Level 2 is
 * disabled by WebKit/Blink on insecure HTTP origins (e.g. http://192.168.1.8:3000).
 */
export function getSharingCapabilities(file?: File | null): SharingCapabilities {
  const isSecure =
    typeof window !== "undefined" && typeof window.isSecureContext === "boolean"
      ? window.isSecureContext
      : typeof location !== "undefined" &&
        (location.protocol === "https:" ||
          location.hostname === "localhost" ||
          location.hostname === "127.0.0.1");
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const hasShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const hasCanShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  let canShareFiles = false;
  if (hasCanShare && file) {
    try {
      canShareFiles = Boolean(navigator.canShare({ files: [file] }));
    } catch {
      canShareFiles = false;
    }
  } else if (hasShare && !hasCanShare && isSecure) {
    canShareFiles = true;
  }

  return {
    isSecureContext: isSecure,
    canShare: hasShare,
    canShareFiles,
    isIOS,
  };
}

export async function downloadReceiptImage(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): Promise<{ url: string; isIOS: boolean }> {
  const blob = await exportReceiptBlob(bill, options);
  const url = URL.createObjectURL(blob);
  const fileName = `Bill-${bill.bill_number}-384px.png`;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  // Omit target="_blank": setting target="_blank" in Android WebViews causes
  // the OS to intercept the download as an external window, invoking the "Open with" app chooser
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // On iOS WebKit, do not revoke the blob immediately, as the browser may open it in a tab
  setTimeout(() => URL.revokeObjectURL(url), isIOS ? 60000 : 2000);
  return { url, isIOS };
}

export async function copyReceiptImage(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): Promise<boolean> {
  try {
    const blob = await exportReceiptBlob(bill, options);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      return true;
    }
  } catch (err) {
    console.warn("Clipboard copy failed, fallback required:", err);
  }
  return false;
}

export const FUN_PRINT_PACKAGE_ID = "com.fun.mxw";

export const FUN_PRINT_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fun.mxw";

export const FUN_PRINT_APP_STORE_URL = "https://apps.apple.com/app/fun-print/id1573516086";

// Standard web link rather than intent:// scheme to avoid triggering Android OS "Open with" app chooser
export const FUN_PRINT_ANDROID_INTENT = FUN_PRINT_PLAY_STORE_URL;

export function getFunPrintLaunchInfo(): {
  url: string;
  isAndroid: boolean;
  isIOS: boolean;
  label: string;
} {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua);

  if (isAndroid) {
    return {
      url: FUN_PRINT_ANDROID_INTENT,
      isAndroid: true,
      isIOS: false,
      label: "Open Fun Print (Android)",
    };
  }
  if (isIOS) {
    return {
      url: FUN_PRINT_APP_STORE_URL,
      isAndroid: false,
      isIOS: true,
      label: "Open Fun Print (iOS App Store)",
    };
  }
  return {
    url: FUN_PRINT_PLAY_STORE_URL,
    isAndroid: false,
    isIOS: false,
    label: "Fun Print App (Google Play)",
  };
}

export interface ShareReceiptResult {
  action: "shared" | "downloaded" | "cancelled" | "failed";
  isSecureContext?: boolean;
  error?: unknown;
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; code?: number; message?: string };
  return e.name === "AbortError" || e.code === 20 || /abort|cancel/i.test(e.message || "");
}

/**
 * Primary Fun Print mobile sharing workflow:
 * 1. Generates 384px PNG receipt.
 * 2. Checks secure context and file sharing capability via Web Share API Level 2.
 * 3. If supported, prompts native share sheet (allowing user to select Fun Print or Save to Photos).
 * 4. When user cancels or dismisses the share sheet (AbortError), returns "cancelled" without triggering a download.
 * 5. If file sharing is unavailable (e.g. over insecure HTTP on iPhone Chrome), safely falls back to download/save.
 */
export async function shareOrDownloadReceipt(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): Promise<ShareReceiptResult> {
  try {
    const blob = await exportReceiptBlob(bill, options);
    const fileName = `Bill-${bill.bill_number}-384px.png`;

    let file: File | null = null;
    try {
      file = new File([blob], fileName, { type: "image/png" });
    } catch {
      file = null;
    }

    const capabilities = getSharingCapabilities(file);

    if (capabilities.canShareFiles && file) {
      try {
        await navigator.share({
          files: [file],
          title: `Urbania Café Bill #${bill.bill_number}`,
          text: `Urbania Café receipt for Table ${bill.table_number}`,
        });
        return { action: "shared", isSecureContext: true };
      } catch (shareErr: unknown) {
        if (isAbortError(shareErr)) {
          return { action: "cancelled", isSecureContext: true };
        }
        console.warn("navigator.share failed, falling back to download:", shareErr);
      }
    }

    await downloadReceiptImage(bill, options);
    return { action: "downloaded", isSecureContext: capabilities.isSecureContext };
  } catch (err) {
    if (isAbortError(err)) {
      return { action: "cancelled" };
    }
    console.error("shareOrDownloadReceipt failed:", err);
    return { action: "failed", error: err };
  }
}
