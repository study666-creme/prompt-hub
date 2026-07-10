/**
 * 禁止通过 file:// 直接打开 index.html（浏览器会拦截 API，且与线上数据隔离）
 */
(function () {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return;

  window.__PH_FILE_ORIGIN__ = true;
  window.API_BASE_URL = 'disabled';

  function bannerHtml() {
    return (
      '<div id="ph-file-origin-banner" role="alert" style="position:fixed;inset:0;z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'background:rgba(0,0,0,.72);font-family:system-ui,-apple-system,sans-serif;">' +
      '<div style="max-width:520px;background:#1e1e24;color:#f2f2f7;border-radius:14px;' +
      'padding:24px 22px;box-shadow:0 12px 40px rgba(0,0,0,.45);line-height:1.65;">' +
      '<h2 style="margin:0 0 12px;font-size:18px;">请勿用「本地文件」方式打开</h2>' +
      '<p style="margin:0 0 10px;font-size:14px;color:#c8c8d0;">' +
      '当前地址是 <code style="background:#2a2a32;padding:2px 6px;border-radius:4px;">file://</code>，' +
      '浏览器会拦截对 <strong>api.prompt-hubs.com</strong> 的请求，社区/同步/积分都会异常，' +
      '且这里的本地数据与线上站点<strong>不是同一份</strong>（所以卡片数可能显示为 0）。</p>' +
      '<p style="margin:0 0 14px;font-size:14px;color:#c8c8d0;"><strong>推荐：</strong>用浏览器打开 ' +
      '<a href="https://prompt-hubs.com" style="color:#7eb8ff;">https://prompt-hubs.com</a></p>' +
      '<p style="margin:0 0 14px;font-size:13px;color:#9a9aa8;">若要在本机改代码后预览，在项目文件夹打开 PowerShell，执行：</p>' +
      '<pre style="margin:0 0 14px;padding:12px;background:#121218;border-radius:8px;font-size:12px;' +
      'overflow:auto;white-space:pre-wrap;"># 在 index.html 所在文件夹打开 PowerShell\n' +
      '.\\serve-local.ps1</pre>' +
      '<p style="margin:0;font-size:13px;color:#9a9aa8;">然后访问 ' +
      '<code style="background:#2a2a32;padding:2px 6px;border-radius:4px;">http://127.0.0.1:5500</code></p>' +
      '</div></div>'
    );
  }

  function mountBanner() {
    if (document.getElementById('ph-file-origin-banner')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = bannerHtml();
    document.body.appendChild(wrap.firstElementChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBanner);
  } else {
    mountBanner();
  }
})();
