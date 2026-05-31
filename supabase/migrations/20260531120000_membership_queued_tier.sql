-- 会员升级排队：高档到期后自动恢复低档剩余时长（不叠加为同档）

alter table public.profiles
  add column if not exists membership_queued_tier text
    check (membership_queued_tier is null or membership_queued_tier in ('lite', 'basic', 'standard', 'pro')),
  add column if not exists membership_queued_until timestamptz;

comment on column public.profiles.membership_queued_tier is '当前档到期后接续的会员档位';
comment on column public.profiles.membership_queued_until is '排队档位到期时间（从高档结束时刻起算剩余天数）';
