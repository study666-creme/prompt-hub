-- 社区点赞：每用户每帖一次，全站 likes 计数

create table if not exists public.community_post_likes (
  post_id text not null references public.community_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_post_likes_user_idx
  on public.community_post_likes (user_id, created_at desc);

alter table public.community_post_likes enable row level security;

drop policy if exists "community_post_likes_deny_all" on public.community_post_likes;
create policy "community_post_likes_deny_all"
  on public.community_post_likes for all
  using (false);

grant select, insert, update, delete on public.community_post_likes to service_role;
