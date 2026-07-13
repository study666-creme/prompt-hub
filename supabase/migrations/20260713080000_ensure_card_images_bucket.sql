-- Ensure the private image bucket exists on fresh Supabase-compatible databases.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

grant select, update on storage.buckets to service_role;
grant select, insert, update, delete on storage.objects to service_role;
