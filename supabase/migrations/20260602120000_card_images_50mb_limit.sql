-- 卡片原图上传：将 card-images 单文件上限从 5MB 提到 50MB
update storage.buckets
set file_size_limit = 52428800
where id = 'card-images';
