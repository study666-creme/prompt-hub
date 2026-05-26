-- 后端核心表：积分、会员、激活码、生图记录
-- 在 Supabase SQL Editor 运行（需已启用 auth.users）

-- ---------------------------------------------------------------------------
-- 用户资料与积分（服务端为唯一写入口，客户端只读自己的行）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  membership_tier text check (membership_tier is null or membership_tier in ('basic', 'standard', 'pro')),
  membership_until timestamptz,
  first_sub_offer_used boolean not null default false,
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

-- 禁止客户端直接改积分/会员（仅 service_role / API）
drop policy if exists "profiles_update_own" on public.profiles;

create or replace function public.set_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profiles_updated_at();

-- 新用户注册时自动建 profile
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, credits)
  values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- ---------------------------------------------------------------------------
-- 积分流水（审计）
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  ref_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "credit_ledger_select_own" on public.credit_ledger;
create policy "credit_ledger_select_own"
  on public.credit_ledger for select to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 激活码（仅服务端核销）
-- ---------------------------------------------------------------------------
create table if not exists public.activation_codes (
  code text primary key,
  credits integer not null default 0 check (credits >= 0),
  membership_tier text check (membership_tier is null or membership_tier in ('basic', 'standard', 'pro')),
  membership_days integer check (membership_days is null or membership_days > 0),
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.activation_codes (code) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);

alter table public.activation_codes enable row level security;
alter table public.code_redemptions enable row level security;

-- 客户端不可读激活码表
drop policy if exists "activation_codes_deny_all" on public.activation_codes;
create policy "activation_codes_deny_all" on public.activation_codes for all using (false);

drop policy if exists "code_redemptions_select_own" on public.code_redemptions;
create policy "code_redemptions_select_own"
  on public.code_redemptions for select to authenticated
  using (auth.uid() = user_id);

-- 演示码（生产请轮换密钥并限制 max_uses）
insert into public.activation_codes (code, credits, membership_tier, membership_days, max_uses, note)
values
  ('PROMPT-HUB-100', 1000, null, null, 10000, 'demo credits'),
  ('PROMPT-HUB-500', 5000, null, null, 10000, 'demo credits'),
  ('WELCOME-2026', 500, null, null, 10000, 'demo credits'),
  ('TEST-10', 100, null, null, 10000, 'demo credits'),
  ('MEMBER-BASIC', 100, 'basic', null, 10000, 'demo tier basic'),
  ('MEMBER-STD', 310, 'standard', null, 10000, 'demo tier standard'),
  ('MEMBER-PRO', 1000, 'pro', null, 10000, 'demo tier pro'),
  ('MEMBER-VIP', 1000, 'pro', null, 10000, 'alias pro'),
  ('MEMBER-30D', 0, 'basic', 30, 10000, 'demo 30d basic')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 生图请求（API 记录）
-- ---------------------------------------------------------------------------
create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  resolution text not null default '1k',
  credits_charged integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  result_image_url text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists generation_requests_user_created_idx
  on public.generation_requests (user_id, created_at desc);

alter table public.generation_requests enable row level security;

drop policy if exists "generation_requests_select_own" on public.generation_requests;
create policy "generation_requests_select_own"
  on public.generation_requests for select to authenticated
  using (auth.uid() = user_id);

-- 服务端扣费函数（需在 API 用 service_role 调用 RPC 或事务逻辑）
create or replace function public.apply_credit_delta(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_ref_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_new_balance integer;
begin
  if p_delta = 0 then
    raise exception 'delta cannot be zero';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile from public.profiles where user_id = p_user_id for update;

  v_new_balance := v_profile.credits + p_delta;
  if v_new_balance < 0 then
    raise exception 'insufficient_credits';
  end if;

  update public.profiles
  set credits = v_new_balance
  where user_id = p_user_id
  returning * into v_profile;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_id, meta)
  values (p_user_id, p_delta, v_new_balance, p_reason, p_ref_id, p_meta);

  return v_profile;
end;
$$;

revoke all on function public.apply_credit_delta from public;
grant execute on function public.apply_credit_delta to service_role;
