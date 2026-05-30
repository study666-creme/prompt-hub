-- Worker（service_role）通过扩展 API 写入 user_data 追加卡片
grant select, insert, update on public.user_data to service_role;
