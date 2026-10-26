import type { KitchenTicketOrder, KitchenTicketOrderItem } from '@/lib/thermal-canvas';

export type TicketType = 'new' | 'addon' | 'reprint';

export interface KitchenTicketDeltaResult {
  ticketType: 'new' | 'addon' | 'none';
  hasAdditions: boolean;
  deltaItems: KitchenTicketOrderItem[];
  totalCurrentItemsCount: number;
  addedItemsCount: number;
}

/**
 * Normalizes an order line item into a consistent, deterministic signature string.
 * This ensures that even if database rows are deleted and re-created during order editing,
 * items with equivalent catalogue identity (or custom attributes), modifiers, and notes
 * are matched accurately without false duplicates or lost additions.
 */
export function normalizeItemSignature(item: KitchenTicketOrderItem): string {
  const isCustom = Boolean(item.is_custom) || !item.menu_item_id;
  const note = (item.note || item.item_note || '').trim().toLowerCase();

  if (isCustom) {
    const rawName = (item.name || item.item_name_snapshot || '').trim().toLowerCase();
    const price = item.unit_price_paise ?? 0;
    return `custom:${rawName}:${price}:${note}`;
  }

  // Catalogue item: extract options and sort deterministically
  const rawOptions = item.selected_options || item.selected_options_snapshot || [];
  let optionNames: string[] = [];
  if (Array.isArray(rawOptions)) {
    optionNames = rawOptions
      .map((opt: unknown) => {
        if (typeof opt === 'string') return opt.trim().toLowerCase();
        if (opt && typeof opt === 'object' && 'name' in opt) {
          return String((opt as { name: unknown }).name).trim().toLowerCase();
        }
        return '';
      })
      .filter(Boolean)
      .sort();
  }

  return `cat:${item.menu_item_id}:${optionNames.join('|')}:${note}`;
}

/**
 * Aggregates a list of order items by their normalized signature.
 * Combines quantities of duplicate lines if any exist.
 */
export function aggregateItemsBySignature(items: KitchenTicketOrderItem[]): Map<
  string,
  {
    item: KitchenTicketOrderItem;
    totalQuantity: number;
  }
> {
  const map = new Map<string, { item: KitchenTicketOrderItem; totalQuantity: number }>();

  for (const it of items) {
    const sig = normalizeItemSignature(it);
    const existing = map.get(sig);
    if (existing) {
      existing.totalQuantity += it.quantity;
    } else {
      map.set(sig, {
        item: { ...it },
        totalQuantity: it.quantity,
      });
    }
  }

  return map;
}

/**
 * Compares ticket snapshots by normalized line identity and aggregate quantity.
 * This lets the server reject acknowledgements created from a stale order card
 * instead of silently recording a newer set of dishes as already sent.
 */
export function kitchenTicketItemsMatch(
  left: KitchenTicketOrderItem[],
  right: KitchenTicketOrderItem[]
): boolean {
  const leftAggregate = aggregateItemsBySignature(left);
  const rightAggregate = aggregateItemsBySignature(right);
  if (leftAggregate.size !== rightAggregate.size) return false;

  for (const [signature, leftEntry] of leftAggregate) {
    if (rightAggregate.get(signature)?.totalQuantity !== leftEntry.totalQuantity) return false;
  }
  return true;
}

/**
 * Calculates the delta between current order items and the last acknowledged
 * ticket snapshot sent to the kitchen.
 * 
 * - If no previous ticket has been acknowledged, returns a complete 'new' ticket.
 * - If additions or quantity increases exist, returns an 'addon' ticket containing ONLY the deltas.
 * - If all current items have already been acknowledged, returns 'none'.
 * - Decreases or removals are NEVER treated as additions.
 */
export function computeKitchenTicketDelta(
  currentItems: KitchenTicketOrderItem[],
  acknowledgedSnapshot: KitchenTicketOrderItem[] | null | undefined
): KitchenTicketDeltaResult {
  const currentAgg = aggregateItemsBySignature(currentItems);

  let totalCurrentCount = 0;
  for (const entry of currentAgg.values()) {
    totalCurrentCount += entry.totalQuantity;
  }

  // Case 1: Initial Order (no acknowledged snapshot exists yet)
  if (!acknowledgedSnapshot || acknowledgedSnapshot.length === 0) {
    if (currentItems.length === 0) {
      return {
        ticketType: 'none',
        hasAdditions: false,
        deltaItems: [],
        totalCurrentItemsCount: 0,
        addedItemsCount: 0,
      };
    }

    const deltaItems: KitchenTicketOrderItem[] = [];
    for (const entry of currentAgg.values()) {
      deltaItems.push({
        ...entry.item,
        quantity: entry.totalQuantity,
        quantity_display: `${entry.totalQuantity}×`,
        is_addition_increase: false,
      });
    }

    return {
      ticketType: 'new',
      hasAdditions: true,
      deltaItems,
      totalCurrentItemsCount: totalCurrentCount,
      addedItemsCount: totalCurrentCount,
    };
  }

  // Case 2: Subsequent Ticket — compare against last acknowledged snapshot
  const ackAgg = aggregateItemsBySignature(acknowledgedSnapshot);
  const deltaItems: KitchenTicketOrderItem[] = [];
  let addedCount = 0;

  for (const [sig, currentEntry] of currentAgg.entries()) {
    const ackEntry = ackAgg.get(sig);
    const ackQty = ackEntry ? ackEntry.totalQuantity : 0;
    const deltaQty = currentEntry.totalQuantity - ackQty;

    if (deltaQty > 0) {
      addedCount += deltaQty;
      const isIncrease = ackQty > 0;
      deltaItems.push({
        ...currentEntry.item,
        quantity: deltaQty,
        // For increased quantity on an existing item: "+2×", for newly added item: "1×" or "+1×"
        quantity_display: isIncrease ? `+${deltaQty}×` : `${deltaQty}×`,
        is_addition_increase: isIncrease,
      });
    }
  }

  if (deltaItems.length > 0) {
    return {
      ticketType: 'addon',
      hasAdditions: true,
      deltaItems,
      totalCurrentItemsCount: totalCurrentCount,
      addedItemsCount: addedCount,
    };
  }

  return {
    ticketType: 'none',
    hasAdditions: false,
    deltaItems: [],
    totalCurrentItemsCount: totalCurrentCount,
    addedItemsCount: 0,
  };
}

/**
 * Creates a clean full reprint ticket representation for an order.
 * All current items are included and labeled with regular quantity displays.
 */
export function createFullReprintTicket(order: KitchenTicketOrder): KitchenTicketOrder {
  const aggregated = aggregateItemsBySignature(order.order_items || []);
  const items: KitchenTicketOrderItem[] = [];

  for (const entry of aggregated.values()) {
    items.push({
      ...entry.item,
      quantity: entry.totalQuantity,
      quantity_display: `${entry.totalQuantity}×`,
      is_addition_increase: false,
    });
  }

  return {
    ...order,
    ticket_type: 'reprint',
    order_items: items,
  };
}
