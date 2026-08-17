-- Canvas video submissions carry a stable client request identity. Keep it
-- unique per user so a browser retry cannot create a second debit/upstream task.
create unique index if not exists generation_requests_video_client_request_id_uidx
  on public.generation_requests (user_id, (meta->>'clientRequestId'))
  where (meta->>'mediaType') = 'video'
    and nullif(meta->>'clientRequestId', '') is not null;
