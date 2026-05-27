-- 若 20260528120000 在插入激活码时报 offer_kind 错，只跑本文件即可（任务表已建好时也可用）

alter table public.activation_codes
  drop constraint if exists activation_codes_offer_kind_check;

alter table public.activation_codes
  add constraint activation_codes_offer_kind_check
  check (offer_kind is null or offer_kind in ('starter_14d', 'mini_3d'));

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
