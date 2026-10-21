import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffDb } from "@/lib/owner";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const manualOrderSchema = z.object({
  serviceMode: z.enum(["dine_in", "takeaway", "counter", "delivery"]).default("dine_in"),
  tableId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(60).optional().nullable(),
  customerNote: z.string().max(300).optional().nullable(),
  guestCount: z.number().int().min(1).max(20).default(1),
  idempotencyKey: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid().optional().nullable(),
        name: z.string().max(100).optional().nullable(),
        quantity: z.number().int().min(1).max(20),
        unitPricePaise: z.number().int().min(0).optional(),
        optionIds: z.array(z.string().uuid()).optional(),
        note: z.string().max(180).optional().nullable(),
        isCustom: z.boolean().optional(),
      })
    )
    .min(1)
    .max(25),
});

export async function POST(req: NextRequest) {
  const previewGuard = enforcePreviewWriteGuard();
  if (previewGuard) return previewGuard;

  const db = await staffDb();
  if (!db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = manualOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid order payload" },
      { status: 400 }
    );
  }

  const { serviceMode, tableId, customerName, customerNote, guestCount, items } = parsed.data;
  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();

  try {
    // 1. Try atomic database RPC
    const { data: rpcData, error: rpcError } = await db.rpc("create_manual_order", {
      p_payload: {
        serviceMode,
        tableId: tableId ?? null,
        customerName: customerName ?? null,
        customerNote: customerNote ?? null,
        guestCount,
        idempotencyKey,
        items,
      },
    });

    if (!rpcError && rpcData?.ok) {
      return NextResponse.json(rpcData, { status: 201 });
    }

    // 2. Fallback logic if RPC is not yet compiled in the database
    // Check idempotency first
    const { data: existingOrder } = await db
      .from("orders")
      .select("id, order_number, status, total_paise, service_mode")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json(
        {
          ok: true,
          order_id: existingOrder.id,
          order_number: existingOrder.order_number,
          status: existingOrder.status,
          total_paise: existingOrder.total_paise,
        },
        { status: 200 }
      );
    }

    // Validate table if dine-in
    let finalTableId: string | null = null;
    if (serviceMode === "dine_in" && tableId) {
      const { data: table } = await db
        .from("cafe_tables")
        .select("id, is_active")
        .eq("id", tableId)
        .maybeSingle();
      if (table && table.is_active) {
        finalTableId = table.id;
      }
    }

    // Process and validate items
    let totalPaise = 0;
    const processedItems: {
      menuItemId: string | null;
      name: string;
      unitPricePaise: number;
      quantity: number;
      lineTotalPaise: number;
      note: string | null;
      options: { name: string; price_delta_paise: number }[];
      isCustom: boolean;
    }[] = [];

    for (const item of items) {
      if (item.isCustom) {
        const customName = item.name?.trim();
        if (!customName) {
          return NextResponse.json(
            { error: "Each custom item requires a valid dish or service name." },
            { status: 400 }
          );
        }
        const unitPrice = item.unitPricePaise ?? 0;
        const lineTotal = unitPrice * item.quantity;
        totalPaise += lineTotal;

        processedItems.push({
          menuItemId: null,
          name: customName,
          unitPricePaise: unitPrice,
          quantity: item.quantity,
          lineTotalPaise: lineTotal,
          note: item.note?.trim() || null,
          options: [],
          isCustom: true,
        });
      } else {
        if (!item.menuItemId) {
          return NextResponse.json(
            { error: "Catalogue item must provide a valid menuItemId." },
            { status: 400 }
          );
        }
        const { data: menuItem } = await db
          .from("menu_items")
          .select("id, name, price_paise, is_available")
          .eq("id", item.menuItemId)
          .maybeSingle();

        if (!menuItem || !menuItem.is_available) {
          return NextResponse.json(
            { error: `Item "${menuItem?.name || "Selected item"}" is currently unavailable.` },
            { status: 400 }
          );
        }

        let optionsDelta = 0;
        const selectedOptions: { name: string; price_delta_paise: number }[] = [];

        if (item.optionIds && item.optionIds.length > 0) {
          const { data: optionsData } = await db
            .from("menu_item_options")
            .select("id, name, price_delta_paise, is_available")
            .in("id", item.optionIds)
            .eq("menu_item_id", menuItem.id);

          for (const opt of optionsData || []) {
            if (opt.is_available) {
              selectedOptions.push({
                name: opt.name,
                price_delta_paise: opt.price_delta_paise,
              });
              optionsDelta += opt.price_delta_paise;
            }
          }
        }

        const unitPrice = menuItem.price_paise + optionsDelta;
        const lineTotal = unitPrice * item.quantity;
        totalPaise += lineTotal;

        processedItems.push({
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPricePaise: unitPrice,
          quantity: item.quantity,
          lineTotalPaise: lineTotal,
          note: item.note?.trim() || null,
          options: selectedOptions,
          isCustom: false,
        });
      }
    }

    const defaultCustomerName =
      serviceMode === "takeaway"
        ? "Takeaway Guest"
        : serviceMode === "delivery"
          ? "Delivery Guest"
          : "Walk-in Guest";

    // Insert order
    const { data: newOrder, error: orderErr } = await db
      .from("orders")
      .insert({
        table_id: finalTableId,
        order_source: "manual",
        service_mode: serviceMode,
        status: "ACCEPTED",
        customer_name: customerName?.trim() || defaultCustomerName,
        guest_count: guestCount,
        customer_note: customerNote?.trim() || null,
        subtotal_paise: totalPaise,
        total_paise: totalPaise,
        idempotency_key: idempotencyKey,
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderErr || !newOrder) {
      console.error("Manual order creation failed:", orderErr);
      return NextResponse.json(
        { error: friendlyBillingError(orderErr) },
        { status: 500 }
      );
    }

    // Insert order items
    const itemInserts = processedItems.map((pi) => ({
      order_id: newOrder.id,
      menu_item_id: pi.menuItemId,
      item_name_snapshot: pi.name,
      unit_price_paise: pi.unitPricePaise,
      quantity: pi.quantity,
      selected_options_snapshot: pi.options,
      line_total_paise: pi.lineTotalPaise,
      item_note: pi.note,
      is_custom: pi.isCustom,
    }));

    const { error: itemsErr } = await db.from("order_items").insert(itemInserts);
    if (itemsErr) {
      console.error("Order items insert failed:", itemsErr);
    }

    return NextResponse.json(
      {
        ok: true,
        order_id: newOrder.id,
        order_number: newOrder.order_number,
        service_mode: newOrder.service_mode,
        status: newOrder.status,
        total_paise: newOrder.total_paise,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("API error in /api/staff/orders:", err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
