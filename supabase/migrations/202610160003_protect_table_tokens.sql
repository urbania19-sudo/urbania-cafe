-- Table QR tokens must never be enumerable through the public REST API.
-- The Next.js server validates a supplied token with its server-only client instead.
drop policy if exists "public reads active tables by token" on public.cafe_tables;
