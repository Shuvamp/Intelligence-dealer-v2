-- 0017_lead_stage_board.sql — Lead Board UI (Phase 2).
-- Additive only: adds the two new stage values the Kanban board needs.
-- Does NOT drop qualified/quotation/won — Postgres can't drop enum values
-- without a destructive rename/recreate, and existing rows + lead_events
-- metadata already reference them. New writes use the 7-value board
-- vocabulary (new, contacted, test_drive, negotiation, booked, delivered,
-- lost); legacy values are mapped onto a board column client-side for
-- display (see apps/web/src/lib/types.ts BOARD_COLUMN_FOR_STAGE).

alter type lead_stage add value if not exists 'booked';
alter type lead_stage add value if not exists 'delivered';
