import type { Bill } from "@/lib/billing";

export interface ReceiptCanvasOptions {
  scale?: number; // 1 = 384px (exact 1:1 hardware dot pitch), 2 = 768px (crisp 2x)
  isReprint?: boolean;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Calculates total receipt height and renders the complete bill to an HTML5 canvas.
 * Target: 384 dots (48 mm printable area on 58 mm / 203 DPI mini thermal printers like MX11).
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

  // Layout coordinate markers
  const leftX = 10;
  const rightX = baseWidth - 10;
  const centerX = baseWidth / 2;
  const colQtyX = 220;
  const colRateRight = 295;
  const colAmtRight = rightX;
  const itemColWidth = 190;

  let y = 14;

  // Header height calculation
  y += 20; // Legal name
  if (biz.cafe_name && biz.cafe_name !== biz.legal_name) y += 16;
  y += 16; // Address
  if (biz.phone) y += 14;
  if (biz.fssai_number) y += 16;
  if (biz.gst_status === "registered" && biz.gstin) y += 16;
  else if (biz.gst_status === "unconfirmed") y += 14;

  y += 12; // Divider
  y += 18; // Document Title (BILL / CASH RECEIPT / TAX INVOICE)
  if (isReprint) y += 14; // Reprint indicator
  y += 12; // Divider

  // Metadata height
  y += 15; // Bill No & Order No
  y += 15; // Date & Time
  y += 15; // Table & Dine-in
  y += 12; // Divider

  // Table header
  y += 16;
  y += 6;

  // Items
  ctx.font = `bold 12px ${fontMono}`;
  for (const item of bill.items_snapshot) {
    const nameLines = wrapText(ctx, item.name, itemColWidth);
    y += nameLines.length * 15;

    if (item.selected_options && item.selected_options.length > 0) {
      y += 14;
    }
    if (item.note) {
      y += 14;
    }
  }

  y += 10; // Divider
  y += 18; // Subtotal
  if (bill.tax_paise > 0) y += 16; // Tax
  y += 20; // TOTAL
  y += 12; // Divider

  // Footer & FSSAI declaration
  if (biz.bill_footer_text) y += 16;
  y += 14; // FSSAI Licence No
  y += 20; // Extra bottom margin

  const totalHeight = Math.ceil(y);
  canvas.height = totalHeight * scale;

  // Re-acquire context after height change
  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) throw new Error("Canvas 2D context not available");

  renderCtx.scale(scale, scale);

  // Fill pure white background
  renderCtx.fillStyle = "#ffffff";
  renderCtx.fillRect(0, 0, baseWidth, totalHeight);

  // Black ink only
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

  let curY = 16;

  // Header: Legal & Trade Name
  renderCtx.font = `bold 14px ${fontSans}`;
  renderCtx.textAlign = "center";
  renderCtx.fillText((biz.legal_name || "URBANIA CAFE AND JUICE BAR").toUpperCase(), centerX, curY);
  curY += 18;

  if (biz.cafe_name && biz.cafe_name !== biz.legal_name) {
    renderCtx.font = `italic 12px ${fontSans}`;
    renderCtx.fillText(`(${biz.cafe_name})`, centerX, curY);
    curY += 16;
  }

  // Address
  renderCtx.font = `11px ${fontSans}`;
  const addressParts = [
    biz.address_line1 || "17/456, Chopasni Housing Board",
    biz.city || "Jodhpur",
    biz.pincode ? `PIN: ${biz.pincode}` : "",
  ].filter(Boolean);
  renderCtx.fillText(addressParts.join(", "), centerX, curY);
  curY += 15;

  if (biz.phone) {
    renderCtx.fillText(`Tel: ${biz.phone}`, centerX, curY);
    curY += 14;
  }

  // FSSAI Licence Top Header
  if (biz.fssai_number) {
    renderCtx.font = `bold 11px ${fontMono}`;
    renderCtx.fillText(`FSSAI Lic No: ${biz.fssai_number}`, centerX, curY);
    curY += 16;
  }

  // GST Info
  if (biz.gst_status === "registered" && biz.gstin) {
    renderCtx.font = `bold 11px ${fontMono}`;
    renderCtx.fillText(`GSTIN: ${biz.gstin}`, centerX, curY);
    curY += 16;
  } else if (biz.gst_status === "unconfirmed") {
    renderCtx.font = `10px ${fontSans}`;
    renderCtx.fillText("GST: Pending Registration (Not a Tax Invoice)", centerX, curY);
    curY += 14;
  }

  curY += 6;
  drawDashedLine(curY);
  curY += 16;

  // Document Title
  renderCtx.font = `bold 14px ${fontMono}`;
  const docTitle =
    bill.document_type === "tax_invoice" && biz.gst_status === "registered"
      ? "TAX INVOICE"
      : "BILL / CASH RECEIPT";
  renderCtx.fillText(docTitle, centerX, curY);
  curY += 14;

  if (isReprint) {
    renderCtx.font = `bold 11px ${fontMono}`;
    renderCtx.fillText("*** DUPLICATE / REPRINT ***", centerX, curY);
    curY += 14;
  }

  curY += 2;
  drawDashedLine(curY);
  curY += 15;

  // Metadata block (2 columns)
  renderCtx.font = `11px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText(`Bill No:  ${bill.bill_number}`, leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`Order: #${bill.order_number}`, rightX, curY);
  curY += 15;

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
  curY += 15;

  renderCtx.textAlign = "left";
  const tableDisplay = bill.table_label || (bill.table_number ? `Table ${bill.table_number}` : "Table ?");
  renderCtx.fillText(`Table:    ${tableDisplay}`, leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText("Dine-in", rightX, curY);
  curY += 8;

  drawDashedLine(curY);
  curY += 16;

  // Items table header
  renderCtx.font = `bold 11px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("ITEM", leftX, curY);
  renderCtx.textAlign = "center";
  renderCtx.fillText("QTY", colQtyX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText("RATE", colRateRight, curY);
  renderCtx.fillText("AMOUNT", colAmtRight, curY);
  curY += 4;

  drawDashedLine(curY);
  curY += 16;

  // Items list
  for (const item of bill.items_snapshot) {
    const unitPaise = item.unit_price_paise ?? (item as unknown as { unit_price_cents: number }).unit_price_cents ?? 0;
    const linePaise = item.line_total_paise ?? (item as unknown as { line_total_cents: number }).line_total_cents ?? (unitPaise * item.quantity);

    renderCtx.font = `bold 11px ${fontMono}`;
    const nameLines = wrapText(renderCtx, item.name, itemColWidth);

    renderCtx.textAlign = "left";
    renderCtx.fillText(nameLines[0] || item.name, leftX, curY);

    renderCtx.textAlign = "center";
    renderCtx.fillText(String(item.quantity), colQtyX, curY);

    renderCtx.textAlign = "right";
    renderCtx.fillText((unitPaise / 100).toFixed(2), colRateRight, curY);
    renderCtx.fillText((linePaise / 100).toFixed(2), colAmtRight, curY);
    curY += 15;

    for (let k = 1; k < nameLines.length; k++) {
      renderCtx.textAlign = "left";
      renderCtx.fillText(nameLines[k] || "", leftX + 8, curY);
      curY += 15;
    }

    if (item.selected_options && item.selected_options.length > 0) {
      renderCtx.font = `italic 10px ${fontMono}`;
      renderCtx.textAlign = "left";
      const optText = item.selected_options.map((m) => m.name).join(", ");
      renderCtx.fillText(`+ ${optText}`, leftX + 8, curY);
      curY += 14;
    }

    if (item.note) {
      renderCtx.font = `italic 10px ${fontSans}`;
      renderCtx.textAlign = "left";
      renderCtx.fillText(`Note: ${item.note}`, leftX + 8, curY);
      curY += 14;
    }
  }

  curY += 2;
  drawDashedLine(curY);
  curY += 18;

  // Summary totals
  const subtotalPaise = bill.subtotal_paise ?? (bill as unknown as { subtotal_cents: number }).subtotal_cents ?? 0;
  const taxPaise = bill.tax_paise ?? (bill as unknown as { tax_cents: number }).tax_cents ?? 0;
  const totalPaise = bill.total_paise ?? (bill as unknown as { total_cents: number }).total_cents ?? 0;

  renderCtx.font = `11px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("Subtotal:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${(subtotalPaise / 100).toFixed(2)}`, rightX, curY);
  curY += 16;

  if (taxPaise > 0) {
    renderCtx.textAlign = "left";
    const taxLabel = bill.tax_rate ? `GST (${(bill.tax_rate * 100).toFixed(0)}%):` : "Tax:";
    renderCtx.fillText(taxLabel, leftX, curY);
    renderCtx.textAlign = "right";
    renderCtx.fillText(`₹${(taxPaise / 100).toFixed(2)}`, rightX, curY);
    curY += 16;
  }

  renderCtx.font = `bold 14px ${fontMono}`;
  renderCtx.textAlign = "left";
  renderCtx.fillText("TOTAL AMOUNT:", leftX, curY);
  renderCtx.textAlign = "right";
  renderCtx.fillText(`₹${(totalPaise / 100).toFixed(2)}`, rightX, curY);
  curY += 10;

  drawDashedLine(curY);
  curY += 18;

  // Footer notes & FSSAI
  renderCtx.textAlign = "center";
  renderCtx.font = `italic 11px ${fontSans}`;
  if (biz.bill_footer_text) {
    renderCtx.fillText(biz.bill_footer_text, centerX, curY);
    curY += 16;
  }

  renderCtx.font = `bold 10px ${fontMono}`;
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

export async function downloadReceiptImage(
  bill: Bill,
  options: ReceiptCanvasOptions = {},
): Promise<void> {
  const blob = await exportReceiptBlob(bill, options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bill-${bill.bill_number}-384px.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
 * 2. If Web Share API with files is supported, prompts native share sheet (allowing user to select Fun Print).
 * 3. When user cancels or dismisses the share sheet (AbortError), returns "cancelled" without triggering a download.
 * 4. If file sharing is unavailable or fails with a non-abort error, automatically downloads the PNG as reliable fallback.
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

    if (
      file &&
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      typeof navigator.share === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: `Urbania Café Bill #${bill.bill_number}`,
          text: `Urbania Café receipt for Table ${bill.table_number}`,
        });
        return { action: "shared" };
      } catch (shareErr: unknown) {
        if (isAbortError(shareErr)) {
          return { action: "cancelled" };
        }
        console.warn("navigator.share failed, falling back to download:", shareErr);
      }
    }

    await downloadReceiptImage(bill, options);
    return { action: "downloaded" };
  } catch (err) {
    if (isAbortError(err)) {
      return { action: "cancelled" };
    }
    console.error("shareOrDownloadReceipt failed:", err);
    return { action: "failed", error: err };
  }
}
