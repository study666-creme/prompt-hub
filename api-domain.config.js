/**
 * 自定义 API 域名（解决国内访问不了 *.workers.dev）
 *
 * 1. 在 Cloudflare 购买/接入域名
 * 2. Worker 绑定子域名，例如 api.你的域名.com
 * 3. 把下面 CUSTOM_API_HOST 改成该子域名（不要写 https://）
 * 4. 运行 server\setup-custom-domain.ps1 或按 docs/CUSTOM-DOMAIN.md 部署
 */
window.CUSTOM_API_HOST = '';

/** 若静态站也用自有域名，填完整来源，例如 https://prompt.example.com */
window.CUSTOM_PAGES_ORIGINS = [];
