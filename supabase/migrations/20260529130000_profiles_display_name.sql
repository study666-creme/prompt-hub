-- 社区昵称（不暴露邮箱）；API 为唯一写入口
alter table public.profiles
  add column if not exists display_name text;

comment on column public.profiles.display_name is '社区显示名；发布帖时快照到 author_name';

create unique index if not exists profiles_display_name_lower_uidx
  on public.profiles (lower(display_name))
  where display_name is not null and btrim(display_name) <> '';

-- 遗留账号：自动生成昵称（不用邮箱前缀，避免隐私泄露）
update public.profiles
set display_name = '用户_' || substr(replace(user_id::text, '-', ''), 1, 8)
where display_name is null or btrim(display_name) = '';
