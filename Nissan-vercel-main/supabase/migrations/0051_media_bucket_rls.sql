-- 0051_media_bucket_rls.sql
-- 0050 created the `media` bucket but no storage.objects policies, so every
-- authenticated upload/delete from apps/web (which uses the user's JWT, not
-- the service-role key — see apps/web/src/lib/marketing.ts uploadAsset/deleteAsset)
-- was rejected by Storage's default-deny RLS. Object keys are `{tenant_id}/{uuid}.ext`
-- (see uploadAsset), so scope access to the caller's own tenant folder, consistent
-- with this project's tenant-isolation-via-RLS rule.

create policy "media: tenant manages own objects"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'media'
  and (storage.foldername(name))[1] = public.tenant_id()::text
)
with check (
  bucket_id = 'media'
  and (storage.foldername(name))[1] = public.tenant_id()::text
);
