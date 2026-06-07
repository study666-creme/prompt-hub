// 迁移到 MemFire 后：复制本文件内容到 supabase-config.js（勿提交 service_role）
// 文档：docs/MEMFIRE-MIGRATION.md

window.SUPABASE_URL = 'https://你的项目.baseaf.memfiredb.com';
window.SUPABASE_ANON_KEY = 'MemFire控制台复制的anon_public_key';

// 手机号：阿里云短信认证接通后再 true（见 docs/SUPABASE-AUTH.md）
window.AUTH_PHONE_ENABLED = false;

window.WECHAT_OAUTH_ENABLED = false;
window.WECHAT_OAUTH_URL = '';
