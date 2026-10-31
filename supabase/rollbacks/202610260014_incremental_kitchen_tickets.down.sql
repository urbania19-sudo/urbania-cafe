-- Rollback Migration 0014: Incremental Kitchen Tickets & Acknowledgments
drop function if exists public.acknowledge_kitchen_ticket(uuid, text, jsonb, jsonb, uuid);
drop table if exists public.order_kitchen_tickets cascade;
