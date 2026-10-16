import { z } from 'zod';
export const orderSchema=z.object({tableToken:z.string().uuid(),idempotencyKey:z.string().uuid(),customerName:z.string().trim().max(60).optional(),customerNote:z.string().trim().max(300).optional(),items:z.array(z.object({menuItemId:z.string().uuid(),quantity:z.number().int().min(1).max(20),optionIds:z.array(z.string().uuid()).max(10).default([]),note:z.string().trim().max(180).optional()})).min(1).max(25)});
export type OrderRequest=z.infer<typeof orderSchema>;
