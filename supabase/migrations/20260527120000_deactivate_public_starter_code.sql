-- 停用公开展示的演示续杯码（生产请为每单生成独立码，max_uses=1）
update public.activation_codes
set
  active = false,
  max_uses = 1,
  note = coalesce(note, '') || ' [deactivated-public-demo]'
where code = 'STARTER-19-14D';
