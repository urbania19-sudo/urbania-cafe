import type { Bill } from "@/lib/billing";

export interface ReceiptCanvasOptions {
  scale?: number; // 1 = 384px (exact 1:1 hardware dot pitch), 2 = 768px (crisp 2x)
  isReprint?: boolean;
}

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
 * Calculates total receipt height and renders the complete bill to an HTML5 canvas.
 * Target: 384 dots (48 mm printable area on 58 mm / 203 DPI mini thermal printers like MX11).
 *
 * Sizing & Layout Strategy:
 * - Substantially increased font sizes (20–30% larger) for maximum readability.
 * - Multi-line item layout gives dish names the full printable width in bold 18px,
 *   with quantity, rate, and amount aligned directly under column headers on the line below.
 * - Suppresses irrelevant placeholder taglines ("Your Café") naturally.
 * - Paper height grows dynamically with content; generous padding and tear-off margins prevent clipping.
 */
export function renderReceiptToCanvas(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): HTMLCanvasElement {
  const scale = options.scale ?? 1;
  const baseWidth = 384;
  const isReprint = !!options.isReprint;
  const biz = bill.business_snapshot;

  // Create canvas for measuring and rendering
  const canvas = document.createElement("canvas");
  canvas.width = baseWidth * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.scale(scale, scale);

  const fontMono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const fontSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Layout coordinate markers for 58 mm / 384px printhead
  // 14px margin gives 356px usable width with comfortable borders
  const leftX = 14;
  const rightX = baseWidth - 14; // 370
  const centerX = baseWidth / 2; // 192
  const colQtyX = 150;           // centered quantity column
  const colRateRight = 260;      // right-aligned unit rate column
  const colAmtRight = rightX;    // right-aligned line total column (370)
  const maxContentWidth = rightX - leftX; // 356px

  const meaningfulTagline = getMeaningfulTagline(biz);

  // ---------------------------------------------------------------------------
  // Height dry-run calculation (Pass 1)
  // Keeps exact vertical parity with Pass 2 so canvas height perfectly wraps text
  // ---------------------------------------------------------------------------
  let y = 18;

  // Header height: Café legal name (22px bold)
  ctx.font = `bold 22px ${fontSans}`;
  const legalName = (biz.legal_name || "URBANIA CAFE AND JUICE BAR").toUpperCase();
  const legalLines = wrapText(ctx, legalName, maxContentWidth);
  y += legalLines.length * 28;

  if (meaningfulTagline) {
    ctx.font = `italic bold 14px ${fontSans}`;
    const tagLines = wrapText(ctx, `(${meaningfulTagline})`, maxContentWidth);
    y += tagLines.length * 20;
  }

  y += 6; // gap before address

  // Address (14px sans)
  ctx.font = `14px ${fontSans}`;
  const addressParts = [
    biz.address_line1 || "17/456, Chopasni Housing Board",
    biz.city || "Jodhpur",
    biz.pincode ? `PIN: ${biz.pincode}` : "",
  ].filter(Boolean);
  const addressLines = wrapText(ctx, addressParts.join(", "), maxContentWidth);
  y += addressLines.length * 20;

  if (biz.phone) y += 20;

  // Header FSSAI Licence (14px bold mono)
  if (biz.fssai_number) y += 21;

  // GST Info (14px mono / sans)
  if (biz.gst_status === "registered" && biz.gstin) y += 21;
  else if (biz.gst_status === "not_registered") y += 20;
  else if (biz.gst_status === "unconfirmed") y += 20;

  // Divider + Document title (21px bold mono)
  y += 8 + 18; // divider gap (26)
  y += 24;     // title font height
  if (bill.status === "cancelled") y += 20;
  if (isReprint) y += 20;
  y += 6 + 18; // divider gap (24)

  // Metadata block (3 rows of 15px mono)
  y += 22; // Bill No & Order No
  y += 22; // Date & Time
  y += 22; // Table & Dine-in
  y += 8 + 20; // divider gap (28)

  // Table column headers (15px bold mono: ITEM, QTY, RATE, AMOUNT)
  y += 20;
  y += 8 + 20; // divider gap (28)

  // Items list (Multi-line item layout: 18px bold dish name + 16px pricing row)
  for (const item of bill.items_snapshot) {
    ctx.font = `bold 18px ${fontMono}`;
    const nameLines = wrapText(ctx, item.name, maxContentWidth);
    y += 22; // Line 1: dish name
    if (nameLines.length > 1) {
      y += (nameLines.length - 1) * 21;
    }

    // Line 2: QTY, RATE, AMOUNT
    y += 20;

    // Modifiers / options (14px italic mono)
    if (item.selected_options && item.selected_options.length > 0) {
      ctx.font = `italic 14px ${fontMono}`;
      const optText = `+ ${item.selected_options.map((m) => m.name).join(", ")}`;
      const optLines = wrapText(ctx, optText, maxContentWidth - 8);
      y += optLines.length * 18;
    }

    // Preparation notes (14px italic sans)
    if (item.note) {
      ctx.font = `italic 14px ${fontSans}`;
      const noteLines = wrapText(ctx, `Note: ${item.note}`, maxContentWidth - 8);
      y += noteLines.length * 18;
    }

    y += 10; // spacing between item blocks
  }

  // Divider + Totals
  y += 6 + 20; // divider gap (26)
  y += 24;     // Subtotal (17px mono)
  if (bill.tax_paise > 0) y += 24; // GST (17px mono)
  y += 8 + 22; // divider gap (30)
  y += 32;     // TOTAL AMOUNT (22px bold mono)
  y += 12 + 24; // divider gap (36)

  // Footer & FSSAI declaration
  if (biz.bill_footer_text) {
    ctx.font = `italic 14px ${fontSans}`;
    const footerLines = wrapText(ctx, biz.bill_footer_text, maxContentWidth);
    y += footerLines.length * 20;
  }
  y += 22; // FSSAI Licence No (14px bold mono)
  y += 32; // Generous bottom tear-off margin

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

  function drawDashedLine(lineY: number) {
    if (!renderCtx) return;
    renderCtx.save();
    renderCtx.setLineDash([4, 3]);
    renderCtx.beginPath();
    renderCtx.moveTo(leftX, lineY);
    renderCtx.lineTo(rightX, lineY);
    renderCtx.stroke();
    renderCtx.restore();
  }

  // ---------------------------------------------------------------------------
  // Drawing pass (Pass 2)
  // ---------------------------------------------------------------------------
  let curY = 18;

  // 1. Café Legal Name (22px bold — prominent primary branding)
  renderCtx.font = `bold 22px ${fontSans}`;
  renderCtx.textAlign = "center";
  const renderLegalLines = wrapText(renderCtx, legalName, maxContentWidth);
  for (const line of renderLegalLines) {
    renderCtx.fillText(line, centerX, curY);
    curY += 28;
  }

  // 2. Meaningful Tagline / Subtitle (only if genuine, placeholder suppressed)
  if (meaningfulTagline) {
    renderCtx.font = `italic bold 14px ${fontSans}`;
    const renderTagLines = wrapText(renderCtx, `(${meaningfulTagline})`, maxContentWidth);
    for (const line of renderTagLines) {
      renderCtx.fillText(line, centerX, curY);
      curY += 20;
    }
  }

  curY += 6;

  // 3. Address (14px sans)
  renderCtx.font = `14px ${fontSans}`;
  const renderAddressLines = wrapText(renderCtx, addressParts.join(", "), maxContentWidth);
  for (const line of renderAddressLines) {
    renderCtx.fillText(line, centerX, curY);
    curY += 20;
  }

  // 4. Phone (14px sans)
  if (biz.phone) {
    renderCtx.fillText(`Tel: ${biz.phone}`, centerX, curY);
    curY += 20;
  }

  // 5. FSSAI Licence Top Header (14px bold mono)
  if (biz.fssai_number) {
    renderCtx.font = `bold 14px ${fontMono}`;
    renderCtx.fillText(`FSSAI Lic No: ${biz.fssai_number}`, centerX, curY);
    curY += 21;
  }

  // 6. GST Info (14px mono / sans)
  if (biz.gst_status === "registered" && biz.gstin) {
    renderCtx.font = `bold 14px ${fontMono}`;
    renderCtx.fillText(`GSTIN: ${biz.gstin}`, centerX, curY);
    curY += 21;
  } else if (biz.gst_status === "not_registered") {
    renderCtx.font = `14px ${fontSans}`;
    renderCtx.fillText("GST: Not Registered (Not a Tax Invoice)", centerX, curY);
    curY += 20;
  } else if (biz.gst_status === "unconfirmed") {
    renderCtx.font = `14px ${fontSans}`;
    renderCtx.fillText("GST: Pending Registration (Not a Tax Invoice)", centerX, curY);
    curY += 20;
  }

  curY += 8;
  drawDashedLine(curY);
  curY += 18;

  // 7. Document Title (21px bold mono)
  renderCtx.font = `bold 21px ${fontMono}`;
  const docTitle =
    bill.document_type === "tax_invoice" && biz.gst_status === "registered"
      ? "TAX INVOICE"
      : "BILL / CASH RECEIPT";
  renderCtx.fillText(docTitle, centerX, curY);
  curY += 24;

  if (bill.status === "cancelled") {
    renderCtx.font = `bold 15px ${fontMono}`;
    renderCtx.fillText("*** CANCELLED / VOID ***", centerX, curY);
    curY += 20;
  }

  if (isReprint) {
    renderCtx.font = `bold 15px ${fontMono}`;
    renderCtx.fillText("*** DUPLICATE / REPRINT ***", centerX, curY);
    curY += 20;
  }

  curY += 6;
  drawDashedLine(curY);
  curY += 18;

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
  const isTakeawayOrCounter =
    bill.service_mode === "takeaway" ||
    bill.service_mode === "counter" ||
    bill.service_mode === "delivery";
  const tableDisplay =
    bill.table_label ||
    (bill.table_number ? `Table ${bill.table_number}` : isTakeawayOrCounter ? "None" : "Table ?");
  renderCtx.fillText(`Table:    ${tableDisplay}`, leftX, curY);
  renderCtx.textAlign = "right";
  const serviceLabel =
    bill.service_mode === "takeaway"
      ? "Takeaway"
      : bill.service_mode === "delivery"
        ? "Delivery"
        : bill.service_mode === "counter"
          ? "Counter"
          : "Dine-in";
  renderCtx.fillText(serviceLabel, rightX, curY);
  curY += 8;

  drawDashedLine(curY);
  curY += 20;

  // 9. Items table column headers (15px bold mono)
  renderCtx.font = `bold 15px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("ITEM", leftX, curY);
  renderCtx.textAlign = "center";
  renderCtx.fillText("QTY", colQtyX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText("RATE", colRateRight, curY);
  renderCtx.fillText("AMOUNT", colAmtRight, curY);
  curY += 8;

  drawDashedLine(curY);
  curY += 20;

  // 10. Items list (Multi-line layout: 18px bold dish name + 16px QTY/RATE/AMOUNT)
  for (const item of bill.items_snapshot) {
    const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
    const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);

    // Line 1: Item dish name (18px bold mono, full printable width)
    renderCtx.font = `bold 18px ${fontMono}`;
    const nameLines = wrapText(renderCtx, item.name, maxContentWidth);
    renderCtx.textAlign = "left";
    renderCtx.fillText(nameLines[0] || item.name, leftX, curY);
    curY += 22;

    // Subsequent wrapped lines for long names (indented 8px)
    for (let k = 1; k < nameLines.length; k++) {
      renderCtx.fillText(nameLines[k] || "", leftX + 8, curY);
      curY += 21;
    }

    // Line 2: Pricing row (16px mono, clearly aligned with column headers)
    renderCtx.font = `16px ${fontMono}`;
    renderCtx.textAlign = "center";
    renderCtx.fillText(String(item.quantity), colQtyX, curY);

    renderCtx.textAlign = "right";
    renderCtx.fillText((unitPaise / 100).toFixed(2), colRateRight, curY);
    renderCtx.fillText((linePaise / 100).toFixed(2), colAmtRight, curY);
    curY += 20;

    // Selected options / modifiers (14px italic mono, indented 8px)
    if (item.selected_options && item.selected_options.length > 0) {
      renderCtx.font = `italic 14px ${fontMono}`;
      renderCtx.textAlign = "left";
      const optText = `+ ${item.selected_options.map((m) => m.name).join(", ")}`;
      const optLines = wrapText(renderCtx, optText, maxContentWidth - 8);
      for (const line of optLines) {
        renderCtx.fillText(line, leftX + 8, curY);
        curY += 18;
      }
    }

    // Preparation note (14px italic sans, indented 8px)
    if (item.note) {
      renderCtx.font = `italic 14px ${fontSans}`;
      renderCtx.textAlign = "left";
      const noteLines = wrapText(renderCtx, `Note: ${item.note}`, maxContentWidth - 8);
      for (const line of noteLines) {
        renderCtx.fillText(line, leftX + 8, curY);
        curY += 18;
      }
    }

    curY += 10; // breathing room between items
  }

  curY += 6;
  drawDashedLine(curY);
  curY += 20;

  // 11. Summary totals (17px mono subtotal & tax, 22px bold total)
  const subtotalPaise = bill.subtotal_paise ?? (bill as unknown as { subtotal_cents: number }).subtotal_cents ?? 0;
  const taxPaise = bill.tax_paise ?? (bill as unknown as { tax_cents: number }).tax_cents ?? 0;
  const totalPaise = bill.total_paise ?? (bill as unknown as { total_cents: number }).total_cents ?? 0;

  renderCtx.font = `17px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("Subtotal:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${(subtotalPaise / 100).toFixed(2)}`, rightX, curY);
  curY += 24;

  if (taxPaise > 0) {
    renderCtx.textAlign = "left";
    const taxLabel = bill.tax_rate ? `GST (${(bill.tax_rate * 100).toFixed(0)}%):` : "Tax:";
    renderCtx.fillText(taxLabel, leftX, curY);
    renderCtx.textAlign = "right";
    renderCtx.fillText(`₹${(taxPaise / 100).toFixed(2)}`, rightX, curY);
    curY += 24;
  }

  curY += 8;
  drawDashedLine(curY);
  curY += 22;

  // 12. Final Total Amount (22px bold mono — high visual prominence)
  renderCtx.font = `bold 22px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("TOTAL AMOUNT:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${(totalPaise / 100).toFixed(2)}`, rightX, curY);
  curY += 12;

  drawDashedLine(curY);
  curY += 24;

  // 13. Footer & FSSAI declaration
  renderCtx.textAlign = "center";
  if (biz.bill_footer_text) {
    renderCtx.font = `italic 14px ${fontSans}`;
    const renderFooterLines = wrapText(renderCtx, biz.bill_footer_text, maxContentWidth);
    for (const line of renderFooterLines) {
      renderCtx.fillText(line, centerX, curY);
      curY += 20;
    }
  }

  renderCtx.font = `bold 14px ${fontMono}`;
  renderCtx.fillText(`FSSAI LICENCE NO. ${biz.fssai_number || "12226032000212"}`, centerX, curY);

  return canvas;
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
  link.target = "_blank";
  link.rel = "noopener noreferrer";
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

export const FUN_PRINT_ANDROID_INTENT =
  "intent:#Intent;package=com.fun.mxw;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.fun.mxw;end";

export const FUN_PRINT_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fun.mxw";

export const FUN_PRINT_APP_STORE_URL = "https://apps.apple.com/app/fun-print/id1573516086";

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
