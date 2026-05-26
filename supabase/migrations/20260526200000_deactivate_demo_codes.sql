-- 停用内置演示激活码（正式运营请只用 scripts/generate-codes 生成的码）

update public.activation_codes
set active = false,
    note = coalesce(note, '') || ' [deactivated demo]'
where code in (
  'PROMPT-HUB-100',
  'PROMPT-HUB-500',
  'WELCOME-2026',
  'TEST-10',
  'MEMBER-BASIC',
  'MEMBER-STD',
  'MEMBER-PRO',
  'MEMBER-VIP',
  'MEMBER-30D'
);
