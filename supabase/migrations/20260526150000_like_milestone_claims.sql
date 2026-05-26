-- 点赞里程碑领奖记录（服务端唯一写入口）

create table if not exists public.like_milestone_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id text not null,
  threshold integer not null check (threshold in (100, 1000)),
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now(),
  unique (user_id, post_id, threshold)
);

create index if not exists like_milestone_claims_user_threshold_idx
  on public.like_milestone_claims (user_id, threshold);

alter table public.like_milestone_claims enable row level security;

drop policy if exists "like_milestone_claims_select_own" on public.like_milestone_claims;
create policy "like_milestone_claims_select_own"
  on public.like_milestone_claims for select to authenticated
  using (auth.uid() = user_id);

comment on table public.like_milestone_claims is '作者作品点赞达标奖励；每帖每档一次；100赞档每人最多5次、1000赞档每人最多2次（API 校验）';
