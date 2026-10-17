import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/supabase/server';
// The order's idempotency UUID acts as an unguessable receipt; only the status is exposed.
export async function GET(_req:Request,ctx:{params:Promise<{key:string}>}){
  const {key}=await ctx.params;
  if(!z.string().uuid().safeParse(key).success)return NextResponse.json({error:'Not found'},{status:404});
  const {data}=await adminDb().from('orders').select('order_number,status').eq('idempotency_key',key).maybeSingle();
  return data?NextResponse.json(data,{headers:{'cache-control':'no-store'}}):NextResponse.json({error:'Not found'},{status:404});
}
