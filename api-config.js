/**
 * 后端 API 根地址
 * 优先：api-domain.config.js 里的 CUSTOM_API_HOST（国内可访问）
 * 其次：Pages 默认域名 → workers.dev
 * 本地：api-config.local.js 覆盖
 */
(function () {
  if (window.API_BASE_URL) return;

  var custom = String(window.CUSTOM_API_HOST || '').trim();
  if (custom) {
    window.API_BASE_URL =
      'https://' + custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return;
  }

  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var prodByHost = {
    'prompt-hub-hub.pages.dev': 'https://prompt-hub-api.2705367723.workers.dev',
    'prompt-hub-web.pages.dev': 'https://prompt-hub-api.2705367723.workers.dev'
  };

  if (prodByHost[host]) {
    window.API_BASE_URL = prodByHost[host];
    return;
  }

  window.API_BASE_URL = '';
})();
