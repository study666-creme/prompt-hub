/** 复制为 supabase-config.local.js（仅本机，勿提交、勿 deploy Pages） */
(function () {
  var h = (typeof location !== 'undefined' && location.hostname) || '';
  if (h !== 'localhost' && h !== '127.0.0.1') return;
  // 本机直连阿里云（不经 Cloudflare 反代，避免备案/混合内容）
  window.SUPABASE_URL = 'http://8.148.193.247:80';
  // anon key 沿用 supabase-config.js；若要换项目只改下面一行：
  // window.SUPABASE_ANON_KEY = 'eyJ...';
})();
