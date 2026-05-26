-- 卡片图片桶改为私有：仅文件所有者可读（前端通过 createSignedUrl 访问）

update storage.buckets
set public = false
where id = 'card-images';

drop policy if exists "card_images_public_read" on storage.objects;

drop policy if exists "card_images_select_own" on storage.objects;
create policy "card_images_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'card-images'
    and (name like (auth.uid()::text || '/%'))
  );

drop policy if exists "card_images_owner_all" on storage.objects;
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
