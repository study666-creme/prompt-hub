-- 补全 site_settings 权限（Worker 使用 service_role 读写）
grant all on table public.site_settings to service_role;
grant all on table public.site_settings to postgres;

-- 若表已存在可单独执行本文件
