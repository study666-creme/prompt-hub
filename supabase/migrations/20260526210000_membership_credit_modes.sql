-- 会员积分模式：每日积分（当日清零） vs 一次性到账（永久有效）
-- 免费试用 3 天（每日 10 积分）；¥1.9 续杯 14 天（starter_14d 激活码）

alter table public.profiles
  add column if not exists credit_grant_mode text not null default 'bundle'
    check (credit_grant_mode in ('daily', 'bundle')),
  add column if not exists daily_credits integer not null default 0 check (daily_credits >= 0),
  add column if not exists daily_credits_date date,
  add column if not exists bundle_granted_until timestamptz,
  add column if not exists trial_free_used boolean not null default false;

comment on column public.profiles.credit_grant_mode is 'daily=每日10积分当日有效; bundle=一次性档位积分永久有效';
comment on column public.profiles.bundle_granted_until is '与 membership_until 对齐，防止同周期重复发放一次性积分';

alter table public.activation_codes
  add column if not exists offer_kind text check (offer_kind is null or offer_kind in ('starter_14d'));

comment on column public.activation_codes.offer_kind is 'starter_14d=¥1.9续杯14天基础会员（需配合 membership_days=14）';

-- 淘宝 ¥1.9 续杯码示例（生产请轮换 code 并限制 max_uses）
insert into public.activation_codes (
  code, credits, membership_tier, membership_days, max_uses, active, note, offer_kind
)
values (
  'STARTER-19-14D', 0, 'basic', 14, 5000, true,
  '¥1.9 续杯 14 天基础会员', 'starter_14d'
)
on conflict (code) do update set
  membership_days = excluded.membership_days,
  offer_kind = excluded.offer_kind,
  note = excluded.note;
