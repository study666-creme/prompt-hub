-- 卡片资产包：市场上架、免费领取/购买记录、作者可选商用授权

create table if not exists public.asset_packages (
  id text primary key,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null,
  description text not null default '',
  tag text not null default '免费',
  price_cents integer not null default 0 check (price_cents >= 0),
  sale_type text not null default 'bulk' check (sale_type in ('bulk', 'buyout')),
  commercial_use_allowed boolean not null default true,
  count_label text not null default '',
  license_text text not null default '',
  preview_tree jsonb not null default '[]'::jsonb,
  preview_thumbs jsonb not null default '[]'::jsonb,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_packages_feed_idx
  on public.asset_packages (status, created_at desc);

create index if not exists asset_packages_author_idx
  on public.asset_packages (author_id, updated_at desc);

create table if not exists public.asset_package_entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  package_id text not null references public.asset_packages (id) on delete cascade,
  source text not null default 'claim' check (source in ('claim', 'purchase', 'author')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, package_id)
);

create index if not exists asset_package_entitlements_user_idx
  on public.asset_package_entitlements (user_id, acquired_at desc);

alter table public.asset_packages enable row level security;
alter table public.asset_package_entitlements enable row level security;

drop policy if exists "asset_packages_deny_all" on public.asset_packages;
create policy "asset_packages_deny_all"
  on public.asset_packages for all
  using (false);

drop policy if exists "asset_package_entitlements_deny_all" on public.asset_package_entitlements;
create policy "asset_package_entitlements_deny_all"
  on public.asset_package_entitlements for all
  using (false);

grant select, insert, update, delete on public.asset_packages to service_role;
grant select, insert, update, delete on public.asset_package_entitlements to service_role;
