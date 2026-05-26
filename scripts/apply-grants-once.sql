-- 在 Supabase SQL Editor 执行一次（修复兑换「服务器内部错误」）
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.credit_ledger to service_role;
grant select, insert, update on public.activation_codes to service_role;
grant select, insert on public.code_redemptions to service_role;
grant select, insert, update on public.generation_requests to service_role;

grant execute on function public.apply_credit_delta(uuid, integer, text, text, jsonb) to service_role;

-- 若仍报错，确认已跑过：supabase/migrations/20260526000000_backend_core.sql
-- 数据安全加固（收回 anon、禁止客户端改积分）：supabase/migrations/20260526180000_data_security_hardening.sql
-- 卡片图私有桶：supabase/migrations/20260526190000_private_card_images.sql
