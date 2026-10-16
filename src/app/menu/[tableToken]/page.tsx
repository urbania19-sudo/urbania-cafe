import MenuClient from '@/components/menu/MenuClient';
import { demoCategories,demoItems,demoTable } from '@/lib/demo-menu';
import { adminDb } from '@/lib/supabase/server';
import { getMenuCatalog } from '@/lib/menu-catalog';
export const dynamic='force-dynamic';
export default async function MenuPage({params}:{params:Promise<{tableToken:string}>}){const {tableToken}=await params;if(tableToken==='demo-table-1')return <MenuClient demo table={demoTable} categories={demoCategories} items={demoItems}/>;if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return <main className="shell"><h1>Menu unavailable</h1><p>Please ask a staff member for assistance.</p></main>;const {data:table}=await adminDb().from('cafe_tables').select('label,qr_token').eq('qr_token',tableToken).eq('is_active',true).maybeSingle();if(!table)return <main className="shell"><h1>This QR code is not active</h1><p>Please ask a staff member for the current table code.</p></main>;const {categories,items}=await getMenuCatalog();return <MenuClient table={table} categories={categories} items={items}/>}
