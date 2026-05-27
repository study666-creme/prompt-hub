-- 会员任务奖励：领取记录 + 积分消耗累计

create table if not exists public.membership_task_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_key text not null,
  reward_days integer not null default 0,
  reward_credits integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  unique (user_id, task_key)
);

create index if not exists membership_task_claims_user_idx
  on public.membership_task_claims (user_id, claimed_at desc);

alter table public.membership_task_claims enable row level security;

drop policy if exists "membership_task_claims_select_own" on public.membership_task_claims;
create policy "membership_task_claims_select_own"
  on public.membership_task_claims for select to authenticated
  using (auth.uid() = user_id);

alter table public.profiles
  add column if not exists lifetime_credits_spent integer not null default 0 check (lifetime_credits_spent >= 0);

alter table public.profiles
  add column if not exists membership_task_flags jsonb not null default '{}'::jsonb;

comment on column public.profiles.lifetime_credits_spent is '累计消耗积分（生图等），用于任务里程碑';
comment on column public.profiles.membership_task_flags is '任务进度标记：login_desktop, login_mobile, pwa_installed, community_qualified_count 等';

-- 旧迁移只允许 starter_14d；扩展为含 mini_3d（¥0.99/3 天）
alter table public.activation_codes
  drop constraint if exists activation_codes_offer_kind_check;

alter table public.activation_codes
  add constraint activation_codes_offer_kind_check
  check (offer_kind is null or offer_kind in ('starter_14d', 'mini_3d'));

-- ¥0.99 购 3 天基础会员（替代已停售的 ¥1.9/14 天公开码）
insert into public.activation_codes (
  code, credits, membership_tier, membership_days, max_uses, active, note, offer_kind
) values (
  'MINI-99-3D', 0, 'basic', 3, 5000, true,
  '¥0.99 体验 3 天基础会员', 'mini_3d'
) on conflict (code) do update set
  membership_days = excluded.membership_days,
  offer_kind = excluded.offer_kind,
  active = true,
  note = excluded.note;

update public.activation_codes
set active = false, note = coalesce(note, '') || ' [已停售]'
where offer_kind = 'starter_14d' and code = 'STARTER-19-14D';
