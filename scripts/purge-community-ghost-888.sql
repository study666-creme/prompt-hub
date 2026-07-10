-- 清理社区「888」等遗留帖（Supabase → SQL Editor 一次粘贴执行）
-- 说明：author_id 列是 uuid 类型，库里不会出现字面量 "888"，错名在 author_name

-- 第 0 步：先看当前在线帖（可选，单独运行）
-- SELECT id, author_id, author_name, left(prompt, 40) AS prompt, left(image, 60) AS image, created_at
-- FROM public.community_posts
-- WHERE published = true
-- ORDER BY created_at DESC
-- LIMIT 50;

-- 第 1 步：下架作者显示名为 888 的帖
UPDATE public.community_posts
SET published = false, updated_at = now()
WHERE published = true
  AND trim(author_name) = '888';

-- 第 2 步：图片路径里的账号 UUID 与 author_id 不一致的帖（旧版换号串号）
-- 例：image 含 card-images/<owner-uuid>/ 但 author_id 是错误账号的 uuid
UPDATE public.community_posts
SET published = false, updated_at = now()
WHERE published = true
  AND image IS NOT NULL
  AND image ~ 'card-images/[0-9a-f]{8}-'
  AND (
    substring(image from 'card-images/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})')
  )::uuid IS DISTINCT FROM author_id;

-- 第 3 步：执行后核对还剩哪些在线帖
SELECT id, author_id, author_name, left(prompt, 40) AS prompt, left(image, 60) AS image, created_at
FROM public.community_posts
WHERE published = true
ORDER BY created_at DESC
LIMIT 50;
