-- 在 Supabase SQL Editor 运行（在 schema.sql 之后）
-- 若已运行过仍报权限错误，请改运行 fix-policies.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "card_images_public_read" on storage.objects;
drop policy if exists "card_images_insert_own" on storage.objects;
drop policy if exists "card_images_update_own" on storage.objects;
drop policy if exists "card_images_delete_own" on storage.objects;
drop policy if exists "card_images_owner_all" on storage.objects;

create policy "card_images_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'card-images'
    and (name like (auth.uid()::text || '/%'))
  );

create policy "card_images_owner_all"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'card-images'
    and (name like (auth.uid()::text || '/%'))
  )
  with check (
    bucket_id = 'card-images'
    and (name like (auth.uid()::text || '/%'))
  );
