import { createServerClient } from '@supabase/ssr'; import { cookies } from 'next/headers';
export async function authDb(){const jar=await cookies();const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)throw new Error('Supabase is not configured');return createServerClient(url,key,{cookies:{getAll:()=>jar.getAll(),setAll:()=>{}}});}
