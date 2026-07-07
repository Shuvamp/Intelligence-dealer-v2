-- 0000_pgtap.sql — enable pgTAP for database tests
create extension if not exists pgtap with schema extensions;
