// Supabase 客户端配置（浏览器走 Worker /supabase 反代，勿直连裸 IP）
// 境外主库（prompt-hubs.com）：与 extension/config.js 对齐
// 旧站（prompt-hub.cn）：仍走 api.prompt-hub.cn + 阿里云 RDS anon

window.AUTH_PHONE_ENABLED = false;
window.WECHAT_OAUTH_ENABLED = false;
window.WECHAT_OAUTH_URL = '';

(function () {
  var h = (typeof location !== 'undefined' && location.hostname) || '';

  if (h === 'localhost' || h === '127.0.0.1') {
    // 登录走 Worker 反代（与 API 同域）；anon 需与 server/.dev.vars 里 Supabase 项目一致
    window.SUPABASE_URL = 'http://127.0.0.1:8787/supabase';
    window.SUPABASE_ANON_KEY =
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzgwNzkxMzM5LCJleHAiOjEzMjkxNDMxMzM5fQ.lAaU4MF46Cse5hFcX9QeW9Dp-cG1DRia2t42CYgwHlw';
    try {
      var s = document.createElement('script');
      s.src = 'supabase-config.local.js';
      s.async = false;
      document.head.appendChild(s);
    } catch (e) { /* optional override */ }
    return;
  }

  var customApi = String(window.CUSTOM_API_HOST || '').trim();
  var isOverseasSite =
    /prompt-hubs\.com/i.test(customApi) ||
    /^(www\.)?prompt-hubs\.com$/i.test(h) ||
    /\.prompt-hub-hub\.pages\.dev$/i.test(h) ||
    /\.prompt-hub-web\.pages\.dev$/i.test(h);

  if (isOverseasSite) {
    var apiHost = customApi || 'api.prompt-hubs.com';
    window.SUPABASE_URL =
      'https://' + apiHost.replace(/^https?:\/\//i, '').replace(/\/$/, '') + '/supabase';
    window.SUPABASE_ANON_KEY = 'sb_publishable_PGhXkT83iWKzx5244I9t4w_HSBITvgF';
    return;
  }

  window.SUPABASE_URL = 'https://api.prompt-hub.cn/supabase';
  window.SUPABASE_ANON_KEY =
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzgwNzkxMzM5LCJleHAiOjEzMjkxNDMxMzM5fQ.lAaU4MF46Cse5hFcX9QeW9Dp-cG1DRia2t42CYgwHlw';
})();
