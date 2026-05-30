-- 轻量会员档 lite + 停用旧会员卡密

alter table public.profiles
  drop constraint if exists profiles_membership_tier_check;

alter table public.profiles
  add constraint profiles_membership_tier_check
  check (membership_tier is null or membership_tier in ('lite', 'basic', 'standard', 'pro'));

alter table public.activation_codes
  drop constraint if exists activation_codes_membership_tier_check;

alter table public.activation_codes
  add constraint activation_codes_membership_tier_check
  check (membership_tier is null or membership_tier in ('lite', 'basic', 'standard', 'pro'));

-- 停用所有旧会员卡密（积分卡密不受影响）
update public.activation_codes
set active = false
where active = true
  and membership_tier is not null;
