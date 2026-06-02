-- 全站配置（仅 service_role / Worker API 读写）
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

-- 不开放客户端策略；Worker 使用 service_role

create or replace function public.set_site_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_site_settings_updated_at();

grant all on table public.site_settings to service_role;
grant all on table public.site_settings to postgres;
