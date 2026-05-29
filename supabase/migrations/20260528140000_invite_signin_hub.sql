-- 邀请码、签到与任务中心扩展

alter table public.profiles
  add column if not exists invite_code text;

alter table public.profiles
  add column if not exists referred_by uuid references auth.users (id) on delete set null;

create unique index if not exists profiles_invite_code_uidx
  on public.profiles (invite_code)
  where invite_code is not null and invite_code <> '';

create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid not null references auth.users (id) on delete cascade,
  invite_code text not null,
  created_at timestamptz not null default now(),
  unique (invitee_id)
);

create index if not exists invite_redemptions_inviter_idx
  on public.invite_redemptions (inviter_id, created_at desc);

alter table public.invite_redemptions enable row level security;

drop policy if exists "invite_redemptions_select_own" on public.invite_redemptions;
create policy "invite_redemptions_select_own"
  on public.invite_redemptions for select to authenticated
  using (auth.uid() = inviter_id or auth.uid() = invitee_id);

grant select, insert on public.invite_redemptions to service_role;

comment on column public.profiles.invite_code is '用户专属邀请码';
comment on column public.profiles.referred_by is '填写邀请码注册/兑换时的邀请人';
