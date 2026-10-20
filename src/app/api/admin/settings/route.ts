import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { owner } from "@/lib/owner";
import { isValidFssai, isValidGstin } from "@/lib/billing";

const schema = z.object({
  cafe_name: z.string().trim().min(2).max(100),
  legal_name: z.string().trim().min(2).max(120).optional(),
  fssai_number: z.string().trim().optional(),
  fssai_validity_date: z.string().nullable().optional(),
  address_line1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(10).optional(),
  pincode_verified: z.boolean().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  gst_status: z.enum(["unconfirmed", "registered", "not_registered"]),
  gstin: z.string().trim().max(20).nullable().optional(),
  tax_treatment: z.enum(["inclusive", "exclusive", "none"]),
  bill_prefix: z.string().trim().max(10).default("UB-"),
  bill_header_text: z.string().trim().max(300).nullable().optional(),
  bill_footer_text: z.string().trim().max(300).default("Thank you for visiting Urbania Café!"),
});

export async function GET() {
  const db = await owner();
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await db.from("cafe_settings").select("*").limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ settings: data });
}

export async function PATCH(req: NextRequest) {
  const db = await owner();
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid settings format", details: body.error.format() }, { status: 400 });
  }

  const { data } = body;
  if (data.fssai_number && !isValidFssai(data.fssai_number)) {
    return NextResponse.json({ error: "FSSAI licence number must be exactly 14 digits" }, { status: 400 });
  }

  if (data.gst_status === "registered") {
    return NextResponse.json(
      {
        error:
          "GST Tax Invoice generation is disabled pending itemized GST calculation. Please keep GST status as Pending Registration or Not Registered.",
      },
      { status: 400 }
    );
  }

  if (data.gstin && !isValidGstin(data.gstin)) {
    return NextResponse.json({ error: "GSTIN must match standard 15-character format" }, { status: 400 });
  }

  // Fetch single row ID
  const { data: existing } = await db.from("cafe_settings").select("id").limit(1).maybeSingle();

  if (existing?.id) {
    const { error } = await db.from("cafe_settings").update(data).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await db.from("cafe_settings").insert(data);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
