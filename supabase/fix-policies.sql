-- 同步仍报「权限 / policy」时：在 Supabase SQL Editor 新建查询，整段粘贴运行一次即可
-- 可重复运行，不会破坏已有数据

-- ========== 1. 云数据表 user_data（文字、分组、设置）==========
alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;
drop policy if exists "user_data_owner_all" on public.user_data;

create policy "user_data_owner_all"
  on public.user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_data to authenticated;

-- 若曾开启过「公开可读」，务必关掉（否则所有登录用户可能看到别人的数据）
drop policy if exists "Enable read access for all users" on public.user_data;
drop policy if exists "Public read access" on public.user_data;

-- ========== 2. 图片桶 card-images ==========
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

-- 私有桶：仅本人可读（展示时用 createSignedUrl）
create policy "card_images_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'card-images'
    and (name like (auth.uid()::text || '/%'))
  );

-- 登录用户只能操作自己 UUID 文件夹下的文件（路径：你的用户id/xxx.jpg）
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
