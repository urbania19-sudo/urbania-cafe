import 'server-only';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';

export const getMenuCatalog = unstable_cache(
  async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return { categories: [], items: [] };

    const db = createClient(url, key, { auth: { persistSession: false } });
    const [{ data: categories }, { data: items }] = await Promise.all([
      db.from('menu_categories').select('id,name').eq('is_active', true).order('sort_order'),
      db.from('menu_items').select('id,name,description,price_paise,is_veg,is_available,category_id,image_url').order('sort_order'),
    ]);
    return { categories: categories ?? [], items: items ?? [] };
  },
  ['urbania-menu-catalog-v1'],
  { revalidate: 30 },
);
