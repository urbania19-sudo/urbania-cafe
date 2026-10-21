/**
 * Verification script for Urbania Café 58mm Thermal Bill (384px).
 * Simulates rendering, validates column coordinates, checks font sizes,
 * and exports an SVG / HTML preview for visual inspection.
 */
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { renderReceiptToCanvas } from "../src/lib/thermal-canvas";
import type { Bill } from "../src/lib/billing";

// Setup headless DOM for canvas execution
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.document = dom.window.document as unknown as Document;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

const sampleBill: Bill = {
  id: "b-verify-001",
  order_id: "ord-101",
  bill_number: "UB-01050",
  bill_seq: 1050,
  order_number: 14,
  table_number: 3,
  table_label: "Table 3",
  status: "issued",
  document_type: "bill",
  business_snapshot: {
    cafe_name: "Urbania Café",
    legal_name: "URBANIA CAFE AND JUICE BAR",
    fssai_number: "12226032000212",
    address_line1: "17/456, Chopasni Housing Board",
    city: "Jodhpur",
    state: "Rajasthan",
    pincode: "342008",
    phone: "9876543210",
    gst_status: "unconfirmed",
    bill_footer_text: "Thank you for dining at Urbania Café!",
  },
  items_snapshot: [
    {
      id: "i-1",
      name: "Iced Spanish Latte",
      unit_price_paise: 24000,
      quantity: 1,
      line_total_paise: 24000,
      selected_options: [
        { name: "Oat Milk", price_delta_paise: 3000 },
        { name: "Extra Shot", price_delta_paise: 4000 },
      ],
    },
    {
      id: "i-2",
      name: "Artisanal Multigrain Sourdough Toast with Truffle Mushroom",
      unit_price_paise: 38000,
      quantity: 2,
      line_total_paise: 76000,
      note: "Extra crispy crust",
    },
  ],
  subtotal_paise: 100000,
  tax_rate: 0,
  tax_paise: 0,
  total_paise: 100000,
  notes: null,
  issued_at: "2026-10-20T16:45:00Z",
  issued_by: "staff-lead",
};

interface RenderedText {
  text: string;
  x: number;
  y: number;
  font: string;
  textAlign: string;
}

interface RenderedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function verifyAndExport() {
  console.log("=== Urbania Café Thermal Receipt Layout Verification ===");

  const textCalls: RenderedText[] = [];
  const lineCalls: RenderedLine[] = [];

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
    const ctx = origGetContext.call(this, "2d") as unknown as Record<string, unknown>;
    let currentFont = "";
    let currentAlign = "left";
    let curX = 0;
    let curY = 0;

    return {
      ...ctx,
      set font(f: string) {
        currentFont = f;
      },
      get font() {
        return currentFont;
      },
      set textAlign(a: string) {
        currentAlign = a;
      },
      get textAlign() {
        return currentAlign;
      },
      scale: () => {},
      fillRect: () => {},
      save: () => {},
      restore: () => {},
      setLineDash: () => {},
      beginPath: () => {},
      moveTo: (x: number, y: number) => {
        curX = x;
        curY = y;
      },
      lineTo: (x: number, y: number) => {
        lineCalls.push({ x1: curX, y1: curY, x2: x, y2: y });
      },
      stroke: () => {},
      measureText: (text: string) => {
        // Approximate width: mono char is ~8.4px at 14px, ~7.8px at 13px, sans char is ~9px at 18px
        const isMono = currentFont.includes("mono");
        const sizeMatch = currentFont.match(/(\d+)px/);
        const size = sizeMatch ? parseInt(sizeMatch[1] ?? "12", 10) : 12;
        const charWidth = isMono ? size * 0.6 : size * 0.55;
        return { width: text.length * charWidth };
      },
      fillText: (text: string, x: number, y: number) => {
        textCalls.push({ text, x, y, font: currentFont, textAlign: currentAlign });
      },
    };
  };

  const canvas = renderReceiptToCanvas(sampleBill, { scale: 1 });
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = origGetContext;

  console.log(`Canvas Dimensions: Width=${canvas.width}px, Height=${canvas.height}px`);
  if (canvas.width !== 384) {
    throw new Error(`Expected canvas width 384px, got ${canvas.width}px`);
  }

  // Check fonts
  const legalCall = textCalls.find((t) => t.text.includes("URBANIA CAFE AND JUICE BAR"));
  console.log(`- Café Legal Name: "${legalCall?.text}" (font: ${legalCall?.font})`);
  if (!legalCall?.font.includes("22px")) {
    throw new Error("Legal name font size is not 22px!");
  }

  const docTitleCall = textCalls.find((t) => t.text === "BILL / CASH RECEIPT");
  console.log(`- Document Title: "${docTitleCall?.text}" (font: ${docTitleCall?.font})`);
  if (!docTitleCall?.font.includes("21px")) {
    throw new Error("Doc title font size is not 21px!");
  }

  const itemHeader = textCalls.find((t) => t.text === "ITEM");
  const qtyHeader = textCalls.find((t) => t.text === "QTY");
  const rateHeader = textCalls.find((t) => t.text === "RATE");
  const amtHeader = textCalls.find((t) => t.text === "AMOUNT");
  console.log(`- Columns: ITEM(x=${itemHeader?.x}), QTY(x=${qtyHeader?.x}), RATE(x=${rateHeader?.x}), AMOUNT(x=${amtHeader?.x})`);

  if (itemHeader?.x !== 14 || qtyHeader?.x !== 150 || rateHeader?.x !== 260 || amtHeader?.x !== 370) {
    throw new Error("Column alignment coordinates mismatch!");
  }

  const totalCall = textCalls.find((t) => t.text === "TOTAL AMOUNT:");
  console.log(`- Total Amount: "${totalCall?.text}" (font: ${totalCall?.font})`);
  if (!totalCall?.font.includes("22px")) {
    throw new Error("Total amount font size is not 22px!");
  }

  // Verify placeholder tagline is NOT rendered
  const placeholderCall = textCalls.find((t) => t.text.toLowerCase().includes("your café") || t.text.toLowerCase().includes("your cafe"));
  if (placeholderCall) {
    throw new Error("Found placeholder tagline in rendered text!");
  }

  const fssaiCalls = textCalls.filter((t) => t.text.includes("12226032000212"));
  console.log(`- FSSAI Declarations found: ${fssaiCalls.length}`);
  if (fssaiCalls.length < 2) {
    throw new Error("Missing top or bottom FSSAI declaration!");
  }

  // Generate SVG representation of the 384px receipt
  const svgLines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 ${canvas.height}" width="384" height="${canvas.height}" style="background:#ffffff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">`,
    `  <rect width="384" height="${canvas.height}" fill="#ffffff" />`,
  ];

  for (const line of lineCalls) {
    svgLines.push(`  <line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="#000000" stroke-width="1" stroke-dasharray="4,3" />`);
  }

  for (const t of textCalls) {
    let anchor = "start";
    if (t.textAlign === "center") anchor = "middle";
    else if (t.textAlign === "right") anchor = "end";

    // Extract font weight and size
    const isBold = t.font.includes("bold") ? 'font-weight="bold"' : "";
    const isItalic = t.font.includes("italic") ? 'font-style="italic"' : "";
    const sizeMatch = t.font.match(/(\d+)px/);
    const fontSize = sizeMatch ? `font-size="${sizeMatch[1]}px"` : 'font-size="12px"';
    const isSans = t.font.includes("system-ui") ? 'font-family="system-ui, -apple-system, sans-serif"' : "";

    const escaped = t.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    svgLines.push(
      `  <text x="${t.x}" y="${t.y}" text-anchor="${anchor}" ${fontSize} ${isBold} ${isItalic} ${isSans} fill="#000000">${escaped}</text>`
    );
  }
  svgLines.push("</svg>");

  const outputDir = path.resolve(__dirname, "../tests/output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const svgPath = path.join(outputDir, "receipt-preview-384px.svg");
  fs.writeFileSync(svgPath, svgLines.join("\n"), "utf-8");
  console.log(`Saved SVG Preview to: ${svgPath}`);

  // Generate HTML preview simulator
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Urbania Café — 58mm Thermal Bill Print Preview</title>
  <style>
    body {
      background: #1e1e24;
      color: #f3f4f6;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 30px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      max-width: 520px;
      margin-bottom: 24px;
      text-align: center;
    }
    .badge {
      display: inline-block;
      background: #059669;
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 8px;
    }
    p {
      font-size: 13px;
      color: #9ca3af;
      margin: 0;
      line-height: 1.5;
    }
    .paper-frame {
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #374151;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">MX11 / 58 mm Mini Printer Verified</div>
    <h1>Thermal Receipt Preview (384px Dot Pitch)</h1>
    <p>Target Dot Pitch: 384px width | 203 DPI (8 dots/mm) | Print area: ~48mm on 58mm thermal paper roll.</p>
  </div>

  <div class="paper-frame">
    ${svgLines.join("\n")}
  </div>
</body>
</html>`;

  const htmlPath = path.join(outputDir, "receipt-preview-384px.html");
  fs.writeFileSync(htmlPath, htmlContent, "utf-8");
  console.log(`Saved HTML Preview to: ${htmlPath}`);
  console.log("Verification completed successfully!");
}

verifyAndExport();
