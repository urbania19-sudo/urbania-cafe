# Premium QR Café Ordering

Mobile-first QR ordering for a five-table café. Customers open `/menu/[tableToken]`, build a cart, and place a no-payment dine-in order. Owners use Supabase Auth and the protected `/admin` area.

## Included

- Next.js App Router, strict TypeScript, Tailwind, Zod and Supabase integration.
- Version-controlled PostgreSQL schema, RLS, public-menu policies, owner-only data policies and a privileged, narrow order RPC.
- Integer-paise pricing and order-time item/option snapshots.
- UUID table tokens created by PostgreSQL; the seed creates exactly five tables.
- Customer menu, cart and server order endpoint; no payment workflow.
- Separate staff portal (`/staff`) for the order queue and owner portal (`/admin`) for management. Create separate Supabase Auth accounts/passwords; assign each account a `staff` or `owner`/`admin` role in `admin_profiles`.

## Setup

1. Create a Supabase project, then run `supabase/migrations/202610160001_initial.sql` followed by `supabase/seed.sql` in the SQL editor (or Supabase CLI).
2. Copy `.env.example` to `.env.local` and fill it with that project’s URL, anon key, server-only service role key, and your final site URL.
3. In Supabase Auth, create the first owner manually. In SQL editor, insert their Auth UUID into `admin_profiles` with role `owner`. There is intentionally no public registration page.
4. Run `npm run dev`. Test each `/menu/<qr_token>` before printing. `NEXT_PUBLIC_SITE_URL` controls QR destinations; do not hardcode a production domain.

### Getting the five QR codes

After the database migration/seed and owner setup, sign in as the owner and open `/admin/tables`. Each active table has **Download SVG**, a print-quality QR image. Do this only after `NEXT_PUBLIC_SITE_URL` is your final HTTPS domain; open every QR destination on a phone before printing cards. Staff accounts cannot download or rotate table codes.

## Security model

Public RLS reads only active menu records and active tables. Orders cannot be read, created, updated, or cancelled by public users. The API uses a server-only service role solely to invoke `place_public_order`; that transaction revalidates table token, items, options, availability, quantities and computes all totals from database pricing. It returns only confirmation metadata. The UUID idempotency key prevents accidental duplicate submissions. Never place the service key in a `NEXT_PUBLIC_` value.

Review RLS in Supabase’s policy tester: anonymous read of `orders` must fail; anonymous menu read must work; non-admin menu/table/order changes must fail; an admin can manage records. Configure Storage policies separately before enabling image uploads—only `admin_profiles` users should upload/delete objects.

## Commands

`npm run lint` · `npm run typecheck` · `npm test` · `npm run build`

## Deploy and operate

Deploy to Vercel, add the environment variables, set the production domain in `NEXT_PUBLIC_SITE_URL`, and then reseed/retain the generated table tokens. Enable Supabase Realtime for `orders` before adding live dashboard subscriptions. The current dashboard’s browser refresh is its fallback; a production enhancement should add the requested Realtime subscription and status-management UI.

Supabase and Vercel free tiers, quotas, commercial terms, idle-project suspension, and bandwidth limits can change. Check current terms before use, keep periodic database exports, and retain printed QR cards securely. HTTPS, RLS, owner setup, all five QR links, a complete order, and an unauthenticated `/admin` redirect are the required production checklist.

## Current limitation

No Supabase credentials were supplied, so a live database, Auth, Storage, Realtime, end-to-end browser flows and migrations have not been run against an external project. The schema and integration code are included, but these must be verified in the configured Supabase project before serving customers.
