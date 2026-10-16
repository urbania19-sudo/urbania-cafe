import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
if (!siteUrl || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase or site URL environment variables.');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: tables, error } = await db.from('cafe_tables').select('table_number,label,qr_token').eq('is_active', true).order('table_number');
if (error) throw error;
if (tables?.length !== 5) throw new Error(`Expected 5 active tables, found ${tables?.length ?? 0}.`);
const output = new URL('../outputs/table-qr-codes/', import.meta.url);
await mkdir(output, { recursive: true });
const cards = [];
for (const table of tables) {
  const url = `${siteUrl}/menu/${table.qr_token}`;
  const filename = `table-${table.table_number}.svg`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 1200, color: { dark: '#1d1612', light: '#ffffff' } });
  await writeFile(new URL(filename, output), svg);
  cards.push(`<article><img src="${filename}" alt="QR code for ${table.label}"><h1>${table.label}</h1><p>Scan to order at your table</p></article>`);
}
await writeFile(new URL('print-all.html', output), `<!doctype html><html><head><meta charset="utf-8"><title>Café Table QR Codes</title><style>body{font-family:Arial,sans-serif;color:#1d1612;margin:18mm}header{text-align:center;margin-bottom:10mm}h1{margin:0;font-size:24pt}header p{color:#725f52}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}article{border:1px solid #cab9a9;padding:8mm;text-align:center;break-inside:avoid}article img{width:48mm;height:48mm}article h1{font-size:18pt;margin:3mm 0}article p{font-size:11pt;margin:0;color:#725f52}@media print{body{margin:12mm}}</style></head><body><header><h1>Café Table QR Codes</h1><p>Scan to order at your table. Test every card before printing.</p></header><main class="grid">${cards.join('')}</main></body></html>`);
console.log(`Created 5 QR codes in ${output.pathname}`);
