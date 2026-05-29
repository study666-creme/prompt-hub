-- 社区消息通知（点赞/收藏/关注 → 作者收件箱）
create table if not exists public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  actor_id uuid,
  actor_name text,
  post_id text,
  post_title text,
  message text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists community_notifications_user_created_idx
  on public.community_notifications (user_id, created_at desc);

alter table public.community_notifications enable row level security;

drop policy if exists "community_notifications_select_own" on public.community_notifications;
create policy "community_notifications_select_own"
  on public.community_notifications for select to authenticated
  using (auth.uid() = user_id);

grant select on public.community_notifications to authenticated;
grant all on public.community_notifications to service_role;
