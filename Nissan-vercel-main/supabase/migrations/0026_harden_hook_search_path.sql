-- 0026_harden_hook_search_path.sql
-- Pin the custom_access_token_hook search_path (Supabase advisor 0011,
-- function_search_path_mutable). Defense-in-depth even though tenant isolation
-- resolves via public.tenant_id()/auth.uid() (0013) and does not require the hook.
alter function public.custom_access_token_hook(jsonb) set search_path = public;
