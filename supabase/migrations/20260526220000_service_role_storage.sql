-- Worker (service_role) 归档生图结果到 card-images 桶
grant select, insert, update, delete on storage.objects to service_role;
grant select, update on storage.buckets to service_role;
