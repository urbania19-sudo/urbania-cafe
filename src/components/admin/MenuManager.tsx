'use client';

import { useState, useRef } from 'react';
import { browserDb } from '@/lib/supabase/browser';

type Category = { id: string; name: string };
type Item = {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  category_id: string;
  description: string | null;
  is_veg: boolean;
  image_url: string | null;
};

const field = {
  padding: 10,
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: '#ffffff10',
  color: 'var(--ink)',
};

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported image format (${file.type || 'unknown'}). Please upload a JPEG, PNG, or WebP image.`,
    };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds 5MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please choose a smaller image.`,
    };
  }
  return { valid: true };
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    alert(data?.error ?? 'Could not save.');
  }
  return r.ok;
}

export default function MenuManager({
  categories,
  items,
}: {
  categories: Category[];
  items: Item[];
}) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string>();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [draft, setDraft] = useState<{
    name: string;
    price: string;
    category_id: string;
    is_veg: boolean;
    image_url: string | null;
  }>({
    name: '',
    price: '',
    category_id: categories[0]?.id ?? '',
    is_veg: true,
    image_url: null,
  });

  const draftFileRef = useRef<HTMLInputElement>(null);

  const edit = (id: string, patch: Partial<Item>) =>
    setRows((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function uploadToStorage(file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `items/${crypto.randomUUID()}.${ext}`;
    const db = browserDb();
    const { error } = await db.storage
      .from('menu-images')
      .upload(path, file, { contentType: file.type, upsert: true });

    if (error) throw error;
    const { data } = db.storage.from('menu-images').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleItemPhotoUpload(item: Item, file: File) {
    const val = validateImageFile(file);
    if (!val.valid) {
      alert(val.error);
      return;
    }

    try {
      setUploadingId(item.id);
      const publicUrl = await uploadToStorage(file);

      // Verify server persistence before updating local UI state
      const res = await fetch('/api/admin/menu', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...item, image_url: publicUrl }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'Database rejected updated image URL');
      }

      // Confirmed saved on server: update local state
      edit(item.id, { image_url: publicUrl });
    } catch (err) {
      console.error('Photo upload error:', err);
      const msg = err instanceof Error ? err.message : 'Photo upload failed';
      alert(`Could not save dish photo: ${msg}\n\nNote: If this is the first upload, verify the 'menu-images' public bucket exists in Supabase Storage.`);
    } finally {
      setUploadingId(null);
    }
  }

  async function handleDraftPhotoUpload(file: File) {
    const val = validateImageFile(file);
    if (!val.valid) {
      alert(val.error);
      return;
    }

    try {
      setUploadingId('draft');
      const publicUrl = await uploadToStorage(file);
      setDraft((d) => ({ ...d, image_url: publicUrl }));
    } catch (err) {
      console.error('Draft photo upload error:', err);
      const msg = err instanceof Error ? err.message : 'Photo upload failed';
      alert(`Could not upload draft photo: ${msg}\n\nNote: Verify the 'menu-images' public bucket exists in Supabase Storage.`);
    } finally {
      setUploadingId(null);
    }
  }

  async function save(i: Item) {
    setBusy(i.id);
    const r = await fetch('/api/admin/menu', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(i),
    });
    if (!r.ok) alert('Could not save this item.');
    setBusy(undefined);
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (await post('/api/admin/categories', { name: catName })) location.reload();
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(draft.price);
    if (!draft.category_id || !(price >= 0)) return alert('Choose a category and a valid price.');
    if (
      await post('/api/admin/menu', {
        category_id: draft.category_id,
        name: draft.name,
        description: null,
        price_paise: Math.round(price * 100),
        is_veg: draft.is_veg,
        is_available: true,
        image_url: draft.image_url,
      })
    ) {
      location.reload();
    }
  }

  return (
    <section>
      {/* Category Creation */}
      <form
        onSubmit={addCategory}
        className="card menu-category-form"
        style={{ padding: 14, margin: '10px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <input
          required
          minLength={2}
          placeholder="New category name"
          value={catName}
          onChange={(e) => setCatName(e.target.value)}
          style={{ ...field, flex: 1 }}
        />
        <button className="btn">Add category</button>
      </form>

      {/* Item Creation Form */}
      <form
        onSubmit={addItem}
        className="card menu-create-form"
        style={{ padding: 16, margin: '14px 0', display: 'grid', gap: 12 }}
      >
        <b style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem' }}>Add new menu dish</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <input
            required
            minLength={2}
            placeholder="Dish name (e.g. Cinnamon French Toast)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={field}
          />
          <input
            required
            type="number"
            min={0}
            step="1"
            placeholder="Price (₹)"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            style={field}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
          <select
            value={draft.category_id}
            onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
            style={field}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={draft.is_veg}
              onChange={(e) => setDraft({ ...draft, is_veg: e.target.checked })}
            />{' '}
            Vegetarian
          </label>
        </div>

        {/* Dish photo upload for draft */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          {draft.image_url ? (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--line)',
                flexShrink: 0,
              }}
            >
              <img
                src={draft.image_url}
                alt="Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                background: '#ffffff0a',
                border: '1px dashed var(--line)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              📷
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            ref={draftFileRef}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDraftPhotoUpload(file);
            }}
          />
          <button
            type="button"
            className="chip"
            disabled={uploadingId === 'draft'}
            onClick={() => draftFileRef.current?.click()}
            style={{ fontSize: 12 }}
          >
            {uploadingId === 'draft'
              ? 'Uploading photo…'
              : draft.image_url
              ? 'Change dish photo'
              : 'Add dish photo (optional)'}
          </button>
          {draft.image_url && (
            <button
              type="button"
              className="chip"
              onClick={() => setDraft((d) => ({ ...d, image_url: null }))}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              Remove
            </button>
          )}
        </div>

        <button className="btn" style={{ marginTop: 4 }}>
          Create dish
        </button>
      </form>

      {/* Category Quick Navigation Scroller */}
      {categories.length > 0 && (
        <nav
          className="admin-nav"
          aria-label="Category quick navigation"
          style={{ margin: '14px 0 20px', padding: '10px 0' }}
        >
          {categories.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className="chip"
              style={{ fontSize: 13, textDecoration: 'none' }}
            >
              {c.name}
            </a>
          ))}
        </nav>
      )}

      {/* Menu Categories & Items List */}
      {categories.map((c) => {
        const list = rows.filter((i) => i.category_id === c.id);
        return (
          <div key={c.id} id={`cat-${c.id}`}>
            <h2
              style={{
                fontFamily: 'Georgia, serif',
                margin: '28px 0 8px',
                fontSize: '1.4rem',
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: 8,
                wordBreak: 'normal',
                overflowWrap: 'break-word',
              }}
            >
              <span>{c.name}</span>
              <small
                className="muted"
                style={{
                  whiteSpace: 'nowrap',
                  fontSize: '0.9rem',
                  fontWeight: 'normal',
                }}
              >
                ({list.length} {list.length === 1 ? 'dish' : 'dishes'})
              </small>
            </h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {list.map((i) => (
                <article
                  className="card menu-edit-card"
                  style={{
                    padding: 16,
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    minWidth: 0,
                    alignItems: 'start',
                  }}
                  key={i.id}
                >
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {i.image_url ? (
                        <div
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 8,
                            overflow: 'hidden',
                            flexShrink: 0,
                            border: '1px solid var(--line)',
                          }}
                        >
                          <img
                            src={i.image_url}
                            alt={i.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 8,
                            background: '#ffffff0a',
                            border: '1px dashed var(--line)',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 24,
                            flexShrink: 0,
                          }}
                        >
                          🍽️
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                          Dish Name
                        </label>
                        <input
                          value={i.name}
                          onChange={(e) => edit(i.id, { name: e.target.value })}
                          style={{ ...field, width: '100%', marginTop: 3 }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, alignItems: 'center' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                          Price (₹)
                        </label>
                        <input
                          type="number"
                          value={i.price_paise / 100}
                          onChange={(e) =>
                            edit(i.id, { price_paise: Math.round(Number(e.target.value) * 100) })
                          }
                          style={{ ...field, width: '100%', marginTop: 3 }}
                        />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 16 }}>
                        <input
                          type="checkbox"
                          checked={i.is_veg}
                          onChange={(e) => edit(i.id, { is_veg: e.target.checked })}
                        />{' '}
                        Vegetarian
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 16 }}>
                        <input
                          type="checkbox"
                          checked={i.is_available}
                          onChange={(e) => edit(i.id, { is_available: e.target.checked })}
                        />{' '}
                        Available to order
                      </label>
                    </div>

                    {/* Photo Upload for existing dish */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <label
                        className="chip"
                        style={{
                          fontSize: 11,
                          cursor: uploadingId === i.id ? 'not-allowed' : 'pointer',
                          padding: '4px 10px',
                        }}
                      >
                        {uploadingId === i.id ? 'Uploading…' : i.image_url ? '📷 Change photo' : '📷 Add photo'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingId === i.id}
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleItemPhotoUpload(i, file);
                          }}
                        />
                      </label>
                      {i.image_url && (
                        <button
                          type="button"
                          className="chip"
                          onClick={() => {
                            edit(i.id, { image_url: null });
                            save({ ...i, image_url: null });
                          }}
                          style={{ fontSize: 10, padding: '3px 8px' }}
                        >
                          Remove photo
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 8, alignSelf: 'center' }}>
                    <button
                      className="btn"
                      onClick={() => save(i)}
                      disabled={busy === i.id}
                      style={{ padding: '10px 16px', fontSize: 12 }}
                    >
                      {busy === i.id ? 'Saving…' : 'Save dish'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
