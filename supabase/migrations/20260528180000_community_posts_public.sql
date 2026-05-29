-- 全站公开社区 Feed（游客可读，仅 API service_role 写入）

create table if not exists public.community_posts (
  id text primary key,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null default '',
  prompt text not null default '',
  image text,
  likes integer not null default 0 check (likes >= 0),
  source_card_id text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_posts_feed_idx
  on public.community_posts (published, created_at desc);

create index if not exists community_posts_author_idx
  on public.community_posts (author_id, updated_at desc);

alter table public.community_posts enable row level security;

drop policy if exists "community_posts_deny_all" on public.community_posts;
create policy "community_posts_deny_all"
  on public.community_posts for all
  using (false);

grant select, insert, update, delete on public.community_posts to service_role;
