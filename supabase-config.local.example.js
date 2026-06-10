/** 复制为 supabase-config.local.js（仅本机，勿提交、勿 deploy Pages） */
(function () {
  var h = (typeof location !== 'undefined' && location.hostname) || '';
  if (h !== 'localhost' && h !== '127.0.0.1') return;
  // 默认与 supabase-config.js 一致：走本地 Worker 反代
  window.SUPABASE_URL = 'http://127.0.0.1:8787/supabase';
  // 若 server/.dev.vars 用的是境外 Supabase，改下面一行：
  // window.SUPABASE_ANON_KEY = 'sb_publishable_PGhXkT83iWKzx5244I9t4w_HSBITvgF';
})();
