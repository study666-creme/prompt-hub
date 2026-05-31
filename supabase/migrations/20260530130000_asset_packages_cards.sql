-- 资产包：关联卡片库、预览图、完整卡片 payload（领取后导入）

alter table public.asset_packages
  add column if not exists source_warehouse_id text,
  add column if not exists source_warehouse_name text,
  add column if not exists preview_card_ids jsonb not null default '[]'::jsonb,
  add column if not exists cards_payload jsonb not null default '[]'::jsonb;

comment on column public.asset_packages.cards_payload is '包内卡片 JSON（title/prompt/image/group/tags），仅 entitlement 用户可导出/导入';
comment on column public.asset_packages.preview_card_ids is '公开预览的卡片 id 列表（对应 cards_payload 内 id）';
