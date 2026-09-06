/* 生图/视频任务：模型映射（图+视频）+ 最近任务 + 按模型统计 + 错误日志 */

import { $, esc, monitorNumber, monitorTime, showMsg } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['生图任务', '画布与卡片库共用的生成任务、视频模型、统计与错误日志'];

const STATS_DAYS = 7;

function canvasStageBadge(stage) {
  const map = {
    created: ['已创建', 'info'],
    waiting_service: ['等待服务', 'info'],
    service_processing: ['生成中', 'warn'],
    waiting_result: ['等待结果', 'warn'],
    saving_result: ['保存结果', 'warn'],
    completed: ['已完成', 'ok'],
    failed: ['失败', 'off']
  };
  const item = map[stage] || [stage || '未知', 'info'];
  return `<span class="admin-badge admin-badge--${item[1]}">${esc(item[0])}</span>`;
}

function mediaBadge(type) {
  return type === 'video'
    ? '<span class="admin-badge admin-badge--info" title="视频任务">视频</span>'
    : '<span class="admin-badge" title="生图任务">图</span>';
}

function canvasPricingText(pricing) {
  if (!pricing) return '—';
  const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
  if (tiers.length) {
    return tiers.map((tier) => {
      const condition = Object.entries(tier.when || {}).map(([key, value]) => `${key}=${value}`).join(' · ');
      return `${condition || '默认'}：${Number(tier.credits || 0).toLocaleString('zh-CN')} 积分`;
    }).join('<br>');
  }
  const credits = Number(pricing.credits);
  return Number.isFinite(credits) ? `${credits.toLocaleString('zh-CN')} 积分/${pricing.unit === 'image' ? '张' : pricing.unit === 'second' ? '秒' : '次'}` : '—';
}

function canvasParameterText(parameters) {
  const items = Array.isArray(parameters) ? parameters : [];
  return items
    .filter((item) => !['model', 'prompt'].includes(item.name))
    .map((item) => {
      if (item.name === 'images') return `参考图 ≤ ${item.max_items || '—'}`;
      if (item.name === 'image') return '单参考图';
      const values = Array.isArray(item.options) && item.options.length
        ? item.options.join(' / ')
        : Object.prototype.hasOwnProperty.call(item, 'fixed')
          ? `固定 ${item.fixed}`
          : Object.prototype.hasOwnProperty.call(item, 'default')
            ? `默认 ${item.default}`
            : item.max != null ? `${item.min || 0}–${item.max}` : '';
      return `${item.label || item.name}${values ? `：${values}` : ''}`;
    })
    .join('<br>') || '—';
}

function renderModelStatsRows(rows) {
  if (!rows.length) return '<tr><td colspan="9" class="admin-hint">近 7 天暂无任务</td></tr>';
  return rows.map((s) => `<tr>
    <td>${mediaBadge(s.mediaType)}</td>
    <td><strong>${esc(s.label)}</strong><br><code>${esc(s.model)}</code></td>
    <td>${monitorNumber(s.total)}</td>
    <td>${monitorNumber(s.completed)}</td>
    <td>${s.failed ? `<strong style="color:var(--admin-danger, #dc2626)">${monitorNumber(s.failed)}</strong>` : '0'}</td>
    <td>${s.successRate == null ? '—' : `<span class="admin-badge admin-badge--${s.successRate >= 90 ? 'ok' : s.successRate >= 70 ? 'warn' : 'off'}">${s.successRate}%</span>`}</td>
    <td>${monitorNumber(s.userCount)}</td>
    <td>${monitorNumber(Math.round((s.creditsCharged - s.creditsRefunded) * 10) / 10)}</td>
    <td>${monitorNumber(s.processing)}</td>
  </tr>`).join('');
}

function renderErrorLogRows(logs) {
  if (!logs.length) return '<tr><td colspan="7" class="admin-hint">近 7 天没有失败任务 🎉</td></tr>';
  return logs.map((log) => `<tr>
    <td>${monitorTime(log.createdAt)}<br>${mediaBadge(log.mediaType)}</td>
    <td>${esc(log.userName || '—')}<br><code>${esc(String(log.userId || '').slice(0, 8))}…</code></td>
    <td>${esc(log.model)}</td>
    <td>${esc(log.entry)}</td>
    <td class="admin-monitor-detail" title="${esc(log.error)}">${esc(log.error.slice(0, 80))}${log.error.length > 80 ? '…' : ''}</td>
    <td>${monitorNumber(log.creditsCharged)}</td>
    <td>${log.refunded ? '<span class="admin-badge admin-badge--ok">已退款</span>' : '<span class="admin-badge admin-badge--warn">未退款</span>'}</td>
  </tr>`).join('');
}

export function init() {}

export function load() {
  const modelBody = $('canvasModelMapBody');
  const videoBody = $('canvasVideoModelBody');
  const jobsBody = $('canvasJobsBody');
  if (modelBody) modelBody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
  if (videoBody) videoBody.innerHTML = '<tr><td colspan="5">加载中…</td></tr>';
  if (jobsBody) jobsBody.innerHTML = '<tr><td colspan="9">加载中…</td></tr>';
  void (async () => {
    try {
      const data = await adminFetch(`/api/admin/canvas?limit=100&statsDays=${STATS_DAYS}`, { timeoutMs: 20000 });
      const catalog = data.catalog || {};
      const models = Array.isArray(catalog.models) ? catalog.models : [];
      const videoModels = Array.isArray(data.videoModels) ? data.videoModels : [];
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const stats = data.modelStats || { days: STATS_DAYS, rows: [] };
      const errorLogs = Array.isArray(data.errorLogs) ? data.errorLogs : [];

      const catalogMeta = $('canvasCatalogMeta');
      if (catalogMeta) {
        catalogMeta.textContent = `目录 ${catalog.version || '—'} · 价格 ${catalog.pricingVersion || '—'}${catalog.stale ? ' · 缓存数据' : ' · 实时'} · 视频 ${videoModels.length} 个`;
      }
      if (modelBody) {
        modelBody.innerHTML = models.length ? models.map((model) => `<tr>
          <td><strong>${esc(model.label || model.id)}</strong></td>
          <td><code>${esc(model.id)}</code></td>
          <td><code>${esc(model.actualModel || '—')}</code></td>
          <td><code>${esc(model.endpoint || '—')}</code></td>
          <td>${canvasPricingText(model.pricing)}</td>
          <td>${canvasParameterText(model.parameters)}</td>
        </tr>`).join('') : '<tr><td colspan="6">暂无可用图片模型</td></tr>';
      }

      if (videoBody) {
        videoBody.innerHTML = videoModels.length ? videoModels.map((model) => `<tr>
          <td><strong>${esc(model.label || model.id)}</strong></td>
          <td><code>${esc(model.id)}</code></td>
          <td><code>${esc(model.actualModel || '—')}</code></td>
          <td>${canvasPricingText(model.pricing)}</td>
          <td class="admin-monitor-detail">${esc((model.parameters || []).join(' · ') || '—')}</td>
        </tr>`).join('') : '<tr><td colspan="5">卡藏目录暂无视频模型</td></tr>';
      }

      if (jobsBody) {
        jobsBody.innerHTML = jobs.length ? jobs.map((job) => `<tr>
          <td>${monitorTime(job.createdAt)}</td>
          <td>${mediaBadge(job.mediaType)}</td>
          <td>${esc(job.userName || '未命名')}<br><code>${esc(String(job.userId || '').slice(0, 8))}</code></td>
          <td><strong>${esc(job.publicModelLabel || job.publicModel || '—')}</strong><br><span class="admin-hint">${esc(job.prompt || '')}</span></td>
          <td>${esc([job.size, job.resolution, job.quality, job.duration ? `${job.duration}s` : '', job.referenceCount ? `${job.referenceCount} 参考图` : ''].filter(Boolean).join(' · ') || '—')}</td>
          <td>${canvasStageBadge(job.stage)}</td>
          <td>${esc(job.credits ?? '—')}</td>
          <td>${job.serviceRequestId ? `<code>${esc(job.serviceRequestId)}</code>` : job.serviceTaskId ? `<code>${esc(job.serviceTaskId)}</code>` : '—'}</td>
          <td>${job.error ? `<span class="admin-badge admin-badge--off" title="${esc(job.error)}">${esc(String(job.error).slice(0, 40))}</span>` : '—'}</td>
        </tr>`).join('') : '<tr><td colspan="9">暂无生图任务</td></tr>';
      }

      const statsBody = $('canvasModelStatsBody');
      if (statsBody) statsBody.innerHTML = renderModelStatsRows(stats.rows || []);
      const statsMeta = $('canvasModelStatsMeta');
      if (statsMeta) statsMeta.textContent = `近 ${stats.days} 天 · 按模型聚合（图片+视频）`;

      const errBody = $('canvasErrorLogsBody');
      if (errBody) errBody.innerHTML = renderErrorLogRows(errorLogs);
      const errMeta = $('canvasErrorLogsMeta');
      if (errMeta) {
        const failed = errorLogs.length;
        errMeta.textContent = failed
          ? `近 ${stats.days} 天 ${failed} 条失败任务（表格显示前 100 条）`
          : `近 ${stats.days} 天无失败任务`;
      }

      const summary = data.jobsSummary || {};
      const videoStats = (stats.rows || []).filter(r => r.mediaType === 'video');
      const videoTotal = videoStats.reduce((sum, r) => sum + r.total, 0);
      const videoFailed = videoStats.reduce((sum, r) => sum + r.failed, 0);
      const stats2 = $('canvasOpsStats');
      if (stats2) stats2.innerHTML = `
        <div class="admin-stat admin-stat--blue"><span>图片模型</span><strong>${models.length}</strong></div>
        <div class="admin-stat admin-stat--violet"><span>视频模型</span><strong>${videoModels.length}</strong></div>
        <div class="admin-stat admin-stat--amber"><span>处理中</span><strong>${monitorNumber(summary.processing || 0)}</strong></div>
        <div class="admin-stat admin-stat--green"><span>已完成</span><strong>${monitorNumber(summary.completed || 0)}</strong></div>
        <div class="admin-stat admin-stat--rose"><span>失败</span><strong>${monitorNumber(summary.failed || 0)}</strong></div>
        <div class="admin-stat ${videoFailed ? 'admin-stat--amber' : 'admin-stat--slate'}"><span>近${stats.days}天视频任务</span><strong>${monitorNumber(videoTotal)}</strong></div>
      `;
      showMsg($('canvasOpsMsg'), '', true);
    } catch (e) {
      if (modelBody) modelBody.innerHTML = '';
      if (videoBody) videoBody.innerHTML = '';
      if (jobsBody) jobsBody.innerHTML = '';
      showMsg($('canvasOpsMsg'), friendlyFetchError(e), false);
    }
  })();
}
