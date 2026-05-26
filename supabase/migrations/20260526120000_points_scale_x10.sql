-- 积分体系 ×10：1 元 = 100 积分（生图 1K/2K/4K = 10/20/40）
-- 已跑过 20260526000000 的环境请执行本文件

update public.activation_codes set credits = credits * 10 where credits > 0;

update public.activation_codes set credits = 1000 where code = 'PROMPT-HUB-100';
update public.activation_codes set credits = 5000 where code = 'PROMPT-HUB-500';
update public.activation_codes set credits = 500 where code = 'WELCOME-2026';
update public.activation_codes set credits = 100 where code = 'TEST-10';
update public.activation_codes set credits = 100 where code = 'MEMBER-BASIC';
update public.activation_codes set credits = 310 where code = 'MEMBER-STD';
update public.activation_codes set credits = 1000 where code in ('MEMBER-PRO', 'MEMBER-VIP');

update public.profiles set credits = credits * 10 where credits > 0;

update public.credit_ledger set delta = delta * 10, balance_after = balance_after * 10 where created_at < now();

update public.generation_requests set credits_charged = credits_charged * 10 where credits_charged > 0;
