import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffDb } from "@/lib/owner";
import { friendlyBillingError } from "@/lib/billing";
import { enforcePreviewWriteGuard } from "@/lib/preview-guard";

const manualOrderSchema = z.object({
  orderSource: z.enum(["manual", "swiggy", "zomato", "delivery_platform"]).default("manual"),
  serviceMode: z.enum(["dine_in", "takeaway", "counter", "delivery"]).default("dine_in"),
  tableId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(60).optional().nullable(),
  customerNote: z.string().max(300).optional().nullable(),
  guestCount: z.number().int().min(1).max(20).default(1),
  externalPlatformName: z.string().max(50).optional().nullable(),
  externalPlatformRef: z.string().max(50).optional().nullable(),
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
}).superRefine((data, ctx) => {
  const isPlatform =
    data.orderSource === 'swiggy' || data.orderSource === 'zomato' || data.orderSource === 'delivery_platform';
  if (!isPlatform && data.serviceMode !== 'dine_in' && data.serviceMode !== 'takeaway') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manual orders only support Dine-in and Takeaway service modes",
      path: ["serviceMode"],
    });
  }
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

  const {
    orderSource,
    serviceMode,
    tableId,
    customerName,
    customerNote,
    guestCount,
    externalPlatformName,
    externalPlatformRef,
    items,
  } = parsed.data;
  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();

  const isPlatformOrder =
    orderSource === 'swiggy' || orderSource === 'zomato' || orderSource === 'delivery_platform';

  const finalPlatformName = isPlatformOrder
    ? externalPlatformName?.trim() || (orderSource === 'swiggy' ? 'Swiggy' : 'Zomato')
    : null;
  const finalPlatformRef = isPlatformOrder ? externalPlatformRef?.trim() || null : null;
  const finalServiceMode = isPlatformOrder ? 'delivery' : serviceMode;

  try {
    // 1. Standard manual orders (dine-in, takeaway, counter) MUST execute atomic database RPC
    if (!isPlatformOrder) {
      const { data: rpcData, error: rpcError } = await db.rpc("create_manual_order", {
        p_payload: {
          serviceMode: finalServiceMode,
          tableId: tableId ?? null,
          customerName: customerName ?? null,
          customerNote: customerNote ?? null,
          guestCount,
          idempotencyKey,
          items,
        },
      });

      if (rpcError) {
        console.error("Error in create_manual_order RPC:", rpcError);
        const errCode = (rpcError as { code?: string }).code;
        const errMsg = rpcError.message || "";
        const isExactRpc = errMsg.includes("create_manual_order");
        const isPermissionDenied = errMsg.toLowerCase().includes("permission denied");

        const isMissingFunction =
          !isPermissionDenied &&
          (errCode === "PGRST202" ||
            (errCode === "42883" && isExactRpc) ||
            (isExactRpc &&
              (errMsg.includes("does not exist") || errMsg.includes("Could not find the function"))));

        if (isMissingFunction) {
          return NextResponse.json(
            { error: "Manual order service is temporarily unavailable (database function pending migration)." },
            { status: 503 }
          );
        }

        return NextResponse.json(
          { error: friendlyBillingError(rpcError) },
          { status: 400 }
        );
      }

      if (!rpcData?.ok) {
        return NextResponse.json(
          { error: rpcData?.error || "Failed to create manual order." },
          { status: 400 }
        );
      }

      return NextResponse.json(rpcData, { status: 201 });
    }

    // 2. External delivery platform orders (Swiggy, Zomato, delivery_platform)
    const { data: platformRpcData, error: platformRpcErr } = await db.rpc("create_external_platform_order", {
      p_payload: {
        orderSource,
        externalPlatformName: finalPlatformName,
        externalPlatformRef: finalPlatformRef,
        customerName,
        customerNote,
        guestCount,
        idempotencyKey,
        items,
      },
    });

    if (platformRpcErr) {
      console.error("Error in create_external_platform_order RPC:", platformRpcErr);
      const errCode = (platformRpcErr as { code?: string }).code;
      const errMsg = platformRpcErr.message || "";
      const isExactRpc = errMsg.includes("create_external_platform_order");
      const isPermissionDenied = errMsg.toLowerCase().includes("permission denied");

      const isMissingFunction =
        !isPermissionDenied &&
        (errCode === "PGRST202" ||
          (errCode === "42883" && isExactRpc) ||
          (isExactRpc &&
            (errMsg.includes("does not exist") || errMsg.includes("Could not find the function"))));

      if (isMissingFunction) {
        return NextResponse.json(
          { error: "External platform order service is temporarily unavailable (database function pending migration)." },
          { status: 503 }
        );
      }

      const status = errMsg.includes("forbidden") ? 403 : 400;
      return NextResponse.json(
        { error: friendlyBillingError(platformRpcErr) },
        { status }
      );
    }

    if (!platformRpcData?.ok) {
      return NextResponse.json(
        { error: platformRpcData?.error || "Failed to create external platform order." },
        { status: 400 }
      );
    }

    return NextResponse.json(platformRpcData, { status: 201 });
  } catch (err) {
    console.error("API error in /api/staff/orders:", err);
    return NextResponse.json(
      { error: friendlyBillingError(err) },
      { status: 500 }
    );
  }
}
