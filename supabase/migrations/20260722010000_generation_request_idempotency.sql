alter table public.generation_requests
  add column if not exists client_request_id text;

do $$
begin
  if exists (
    select 1
    from public.generation_requests
    where client_request_id is not null
    group by user_id, client_request_id
    having count(*) > 1
  ) then
    raise exception 'duplicate generation request idempotency keys exist';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'generation_requests_client_request_id_length'
      and conrelid = 'public.generation_requests'::regclass
  ) then
    alter table public.generation_requests
      add constraint generation_requests_client_request_id_length
      check (
        client_request_id is null
        or (
          char_length(client_request_id) between 8 and 128
          and client_request_id ~ '^[A-Za-z0-9._:-]+$'
        )
      );
  end if;
end
$$;

create unique index if not exists generation_requests_user_client_request_uidx
  on public.generation_requests (user_id, client_request_id)
  where client_request_id is not null;

comment on column public.generation_requests.client_request_id is
  'Caller-provided idempotency key. Unique per user across image and video submissions.';

-- MemFire exposes the table through PostgREST; refresh its schema cache after DDL.
notify pgrst, 'reload schema';
