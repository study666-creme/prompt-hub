-- 新批次会员卡密（每档 2 个 · 兑换时在页面选「每日/一次性」，同一码通用）
-- 请先执行 20260529150000_membership_lite_tier.sql（含停用旧码）

insert into public.activation_codes (code, credits, membership_tier, membership_days, max_uses, active, note)
values
  ('MBLT-K7N3R9W2X5H8', 0, 'lite', 30, 1, true, 'shop-lite30-6 batch-20260529a'),
  ('MBLT-P4M6T8Y2V9Q3', 0, 'lite', 30, 1, true, 'shop-lite30-6 batch-20260529b'),
  ('MBBD-H3K8N2W7R5X9', 0, 'basic', 30, 1, true, 'shop-basic30-12.9 batch-20260529a'),
  ('MBBD-J6M4P8T2Y9V5', 0, 'basic', 30, 1, true, 'shop-basic30-12.9 batch-20260529b'),
  ('MBSD-Q8W3N7K2R6X4', 0, 'standard', 30, 1, true, 'shop-std30-31.9 batch-20260529a'),
  ('MBSD-T5Y9M2H8P4V6', 0, 'standard', 30, 1, true, 'shop-std30-31.9 batch-20260529b'),
  ('MBPD-X7R2K9N4W8H3', 0, 'pro', 30, 1, true, 'shop-pro30-63.9 batch-20260529a'),
  ('MBPD-V6P3T8Y2M9Q5', 0, 'pro', 30, 1, true, 'shop-pro30-63.9 batch-20260529b')
on conflict (code) do nothing;
