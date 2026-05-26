/**
 * 后端 API 根地址（Cloudflare Workers）
 * 本地开发：创建 api-config.local.js 覆盖，例如 window.API_BASE_URL = 'http://127.0.0.1:8787';
 */
(function () {
  if (window.API_BASE_URL) return;

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
