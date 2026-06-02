const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'features-draft.js');
let s = fs.readFileSync(file, 'utf8');

// Pass 1: known broken UI strings (from 20260615i)
const literal = [
  ['提示词社?/ 我的创作 / 图片生成 ?功能草案', '提示词社区 / 我的创作 / 图片生成 — 功能草案'],
  ["return !t || t === '未命?' || t === '未命名提示词'", "return !t || t === '未命名' || t === '未命名提示词'"],
  ["if (!prompt) return '暂无提示?;", "if (!prompt) return '暂无提示词';"],
  ["return prompt.slice(0, 80) + '?;", "return prompt.slice(0, 80) + '…';"],
  ["return title.length > 10 ? title.slice(0, 10) + '? : title;", "return title.length > 10 ? title.slice(0, 10) + '…' : title;"],
  ["if (!prompt) return '提示词详?;", "if (!prompt) return '提示词详情';"],
  ["return prompt.length > 10 ? prompt.slice(0, 10) + '? : prompt;", "return prompt.length > 10 ? prompt.slice(0, 10) + '…' : prompt;"],
  ["ctx.fillText('接入 API 后替?, 256, 268);", "ctx.fillText('接入 API 后替换', 256, 268);"],
  ["|| t === '我的作品' || t === '生成?;", "|| t === '我的作品' || t === '生成中';"],
  ['const label = `?${post.likes', 'const label = `♥ ${post.likes'],
  ['likeBtn.textContent = `?${liked', 'likeBtn.textContent = `♥ ${liked'],
  ['btn.textContent = on ? \'已关? : \'关注\'', "btn.textContent = on ? '已关注' : '关注'"],
  ['const timeLabel = `?${post.likes', 'const timeLabel = `♥ ${post.likes'],
  ['if (subEl) subEl.textContent = `已发?${posts.length}', 'if (subEl) subEl.textContent = `已发布 ${posts.length}'],
  ['btn.textContent = `?${post.likes', 'btn.textContent = `♥ ${post.likes'],
  ['<span>?${post.likes', '<span>♥ ${post.likes'],
  ['data-action="like">?${liked', 'data-action="like">♥ ${liked'],
  ['${faved ? \'已收? : \'收藏\'}', "${faved ? '已收藏' : '收藏'}"],
  ['${faved ? \'已收? : \'未收?}', "${faved ? '已收藏' : '未收藏'}"],
  ['timeEl.textContent = `?${post.likes', 'timeEl.textContent = `♥ ${post.likes'],
  ["return n.message || '新消?;", "return n.message || '新消息';"],
  ['赞了你的作品?{title', '赞了你的作品「${title'],
  ['const badge = c.visibility === \'published\' ? \'已发? : \'私密\'', "const badge = c.visibility === 'published' ? '已发布' : '私密'"],
  ["parts.push('固定?);", "parts.push('固定价');"],
  ["btn.textContent = '提交中?;", "btn.textContent = '提交中…';"],
  ['积分已全额退?', '积分已全额退回'],
  ["return s.slice(0, 120) + '?;", "return s.slice(0, 120) + '…';"],
  ['return s || \'生图失败，您的积分已全额退?;', "return s || '生图失败，您的积分已全额退回';"],
  ['?两列浏览 · 生成完成后自动入?· 真丢图可点「恢复丢失的生图?', "'两列浏览 · 生成完成后自动入库 · 真丢图可点「恢复丢失的生图」"],
  ['（已删除的不会恢复?;', '（已删除的不会恢复）'],
  ['社区作品 · 点图放大 · 按钮复制或填入生?', '社区作品 · 点图放大 · 按钮复制或填入生图'],
  ["job.modelLabel || '生图?,", "job.modelLabel || '生图',"],
  ['<span class="imagegen-gen-pending-label">生成?/span>', '<span class="imagegen-gen-pending-label">生成中</span>'],
  ['预计 1? 分钟 · 可继续提?', '预计 1～3 分钟 · 可继续提交'],
  ['title="点赞">?', 'title="点赞">♥'],
  ['<span class="imagegen-preview-fill-label">填入生图?/span>', '<span class="imagegen-preview-fill-label">填入生图框</span>'],
  ['data-preview-like>?${liked', 'data-preview-like>♥ ${liked'],
  ["const groupLabel = c.group || '未分?;", "const groupLabel = c.group || '未分类';"],
  ['meta: `?${p.likes', 'meta: `♥ ${p.likes'],
  ["if (left <= 0) return '已过?;", "if (left <= 0) return '已过期';"],
  ['return `?${h} 小时后清理`', 'return `约 ${h} 小时后清理`'],
  ['return `?${Math.ceil(h / 24)} 天后清理`', 'return `约 ${Math.ceil(h / 24)} 天后清理`'],
  ['likeBtn.textContent = `?${liked ? \'已点? : \'点赞\'}`', "likeBtn.textContent = `♥ ${liked ? '已点赞' : '点赞'}`"],
  ['`卡片?${beforeCount} ??${afterCount} 张（从社区新?${added} 张）`', '`卡片库 ${beforeCount} 张 → ${afterCount} 张（从社区新建 ${added} 张）`'],
  ['`卡片?${list.length} 张，其中 ${eligible} 张可发布社区（提示词?{MIN_COMMUNITY_PROMPT_LEN}字且配图）', '`卡片库 ${list.length} 张，其中 ${eligible} 张可发布社区（提示词≥${MIN_COMMUNITY_PROMPT_LEN}字且配图）'],
  ['或点「从云端恢复卡片库?,', '或点「从云端恢复卡片库」,'],
  ["toast('已同?${total} 条作品到社区'", "toast(`已同步 ${total} 条作品到社区`"],
  ['.join(\'?\');', ".join('、');"],
  ['?${orphans.length} 张`', '等 ${orphans.length} 张`'],
  ['服务器上?${orphans.length} 张本地缺失的生图?{sample}', '服务器上有 ${orphans.length} 张本地缺失的生图（${sample}'],
  ['会员${detail.label} ?${detail.saved}', '会员${detail.label} · ${detail.saved}'],
];

for (const [from, to] of literal) {
  const f = from.replace(/\?/g, '\uFFFD');
  if (s.includes(f)) s = s.split(f).join(to);
  else if (s.includes(from)) s = s.split(from).join(to);
}

// Pass 2: regex patterns
const regex = [
  [/`\?\$\{/g, '`♥ ${'],
  [/>\?\$\{/g, '>♥ ${'],
  [/span>\?\$\{/g, 'span>♥ ${'],
  [/已点\?/g, '已点赞'],
  [/已收\?/g, '已收藏'],
  [/未收\?/g, '未收藏'],
  [/已关\?/g, '已关注'],
  [/未命\?/g, '未命名'],
  [/生成\?/g, '生成中'],
  [/已发\?/g, '已发布'],
  [/提交中\?/g, '提交中…'],
  [/新消\?/g, '新消息'],
  [/未分\?/g, '未分类'],
  [/已过\?/g, '已过期'],
  [/退\?/g, '退回'],
  [/提\?/g, '提交'],
  [/入\?/g, '入库'],
  [/生图\?/g, '生图'],
  [/详\?/g, '详情'],
  [/词\?/g, '词'],
  [/列\?/g, '列表'],
  [/条\?/g, '条目'],
  [/闪\?/g, '闪烁'],
  [/云\?/g, '云端'],
  [/库\?/g, '库'],
  [/够\?/g, '够长'],
  [/历\?/g, '历史'],
  [/不\?/g, '不再'],
  [/本\?/g, '本地'],
  [/清\?/g, '清掉'],
  [/兼\?/g, '兼容'],
  [/对\?/g, '对齐'],
  [/仅\?/g, '仅当'],
  [/补\?/g, '补进'],
  [/切\?/g, '切换'],
  [/全\?/g, '全站'],
  [/退\?\/ 换号/g, '退出 / 换号'],
  [/串号\?/g, '串号后'],
  [/登录\?/g, '登录后'],
  [/标\?/g, '标记'],
  [/避\?/g, '避免'],
  [/拉回\?/g, '拉回'],
  [/链\?/g, '链接'],
  [/替\?/g, '替换'],
  [/失\?/g, '失败'],
  [/流程\?/g, '流程在'],
  [/价\?/g, '价格'],
];

for (const [re, rep] of regex) {
  s = s.replace(re, rep);
}

fs.writeFileSync(file, s, 'utf8');
const fffd = (s.match(/\uFFFD/g) || []).length;
const broken = (s.match(/\?\/p>/g) || []).length;
console.log('pass2 done. FFFD:', fffd, 'broken ?/p>:', broken);
