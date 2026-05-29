/** 复制为 api-config.local.js（仅本机预览，勿提交、勿上传 Pages） */
(function () {
  var h = (typeof location !== 'undefined' && location.hostname) || '';
  if (h !== 'localhost' && h !== '127.0.0.1') return;
  window.API_BASE_URL = 'http://127.0.0.1:8787';
})();
