alter table public.generation_requests
  drop constraint if exists generation_requests_quality_check;

alter table public.generation_requests
  add constraint generation_requests_quality_check
  check (quality in ('low', 'medium', 'standard', 'high', 'ultra'));
