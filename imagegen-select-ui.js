/* ImageGen custom select UI.
 *
 * 把生图页里原生 <select>（画质/比例/入库文件夹/数量/速度/附加开关等）替换成
 * 与「生图模型」下拉同风格的应用绘制选择器：触发器 + 浮层菜单 + 键盘导航。
 * 原生 select 保留在 DOM 中仅作为状态载体（与模型选择器同一模式），选项增删、
 * 程序化赋值、change 事件都由它转发，外部代码无需改动。
 */
(function () {
  'use strict';

  if (window.__IMAGE_GEN_SELECT_UI_BOUND__) return;
  window.__IMAGE_GEN_SELECT_UI_BOUND__ = true;

  const ROOT_SELECTOR = '#pageImageGen';
  const MENU_MAX_HEIGHT = 280;
  const PLACEHOLDER = '请选择';

  let widgets = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function parseScale(trigger) {
    const chrome = trigger.closest('.app-chrome');
    const chromeRect = chrome ? chrome.getBoundingClientRect() : null;
    const rawScaleX = chrome && chrome.offsetWidth > 0 ? chromeRect.width / chrome.offsetWidth : 1;
    const rawScaleY = chrome && chrome.offsetHeight > 0 ? chromeRect.height / chrome.offsetHeight : 1;
    return {
      scaleX: Number.isFinite(rawScaleX) && rawScaleX > 0 ? rawScaleX : 1,
      scaleY: Number.isFinite(rawScaleY) && rawScaleY > 0 ? rawScaleY : 1,
      originLeft: chromeRect ? chromeRect.left : 0,
      originTop: chromeRect ? chromeRect.top : 0,
      originBottom: chromeRect ? chromeRect.bottom : (window.visualViewport ? window.visualViewport.height : window.innerHeight)
    };
  }

  function positionMenu(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const { scaleX, scaleY, originLeft, originTop, originBottom } = parseScale(trigger);
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const below = viewportHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const openAbove = below < 160 && above > below;
    const available = Math.max(120, openAbove ? above : below);
    const width = Math.max(170, Math.min(rect.width, viewportWidth - 16));
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    menu.style.position = 'fixed';
    menu.style.left = `${(left - originLeft) / scaleX}px`;
    menu.style.width = `${width / scaleX}px`;
    menu.style.maxHeight = `${Math.min(MENU_MAX_HEIGHT, available / scaleY)}px`;
    menu.style.top = openAbove ? 'auto' : `${(rect.bottom + 6 - originTop) / scaleY}px`;
    menu.style.bottom = openAbove ? `${(originBottom - rect.top + 6) / scaleY}px` : 'auto';
  }

  function optionLabel(option) {
    const text = (option && option.textContent || '').replace(/\s+/g, ' ').trim();
    return text || String(option && option.value || '').trim() || PLACEHOLDER;
  }

  function syncLabel(widget) {
    const select = widget.select;
    const selected = select.selectedOptions && select.selectedOptions[0];
    const busy = select.getAttribute('aria-busy') === 'true';
    widget.valueEl.textContent = busy ? '加载中…' : optionLabel(selected);
    widget.trigger.disabled = select.disabled;
    widget.trigger.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function renderOptions(widget) {
    const { select, menu } = widget;
    const current = select.value;
    menu.innerHTML = [...select.options].map((option, index) => {
      const value = option.value;
      const disabled = option.disabled;
      const selected = value === current;
      return `<button type="button" role="option" class="ph-cselect-option${selected ? ' is-selected' : ''}"${disabled ? ' aria-disabled="true"' : ''} data-index="${index}" aria-selected="${selected ? 'true' : 'false'}"><span>${escapeHtml(optionLabel(option))}</span><span class="ph-cselect-option-check" aria-hidden="true"></span></button>`;
    }).join('')
      || '<p class="ph-cselect-empty">暂无可选项</p>';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function optionButtons(widget) {
    return [...widget.menu.querySelectorAll('.ph-cselect-option:not([aria-disabled="true"])')];
  }

  function setActiveIndex(widget, index, scrollIntoView) {
    const buttons = optionButtons(widget);
    if (!buttons.length) return -1;
    const next = Math.max(0, Math.min(buttons.length - 1, Number(index) || 0));
    widget.activeIndex = next;
    buttons.forEach((button, buttonIndex) => button.classList.toggle('is-active', buttonIndex === next));
    if (scrollIntoView) buttons[next].scrollIntoView({ block: 'nearest' });
    return next;
  }

  function openMenu(widget) {
    const { trigger, menu } = widget;
    if (trigger.disabled) return;
    closeAll(widget);
    renderOptions(widget);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionMenu(trigger, menu);
    const buttons = optionButtons(widget);
    const selectedIndex = buttons.findIndex((button) => button.classList.contains('is-selected'));
    setActiveIndex(widget, selectedIndex >= 0 ? selectedIndex : 0, false);
  }

  function closeMenu(widget) {
    const { trigger, menu } = widget;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    widget.activeIndex = -1;
  }

  function closeAll(except) {
    widgets.forEach((widget) => {
      if (widget !== except) closeMenu(widget);
    });
  }

  function selectValue(widget, value) {
    const { select, trigger } = widget;
    const option = [...(select.options || [])].find((entry) => entry.value === value && !entry.disabled);
    if (!option) return;
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncLabel(widget);
    closeMenu(widget);
    trigger.focus({ preventScroll: true });
  }

  function bindTrigger(widget) {
    const { trigger, menu, select } = widget;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      if (menu.hidden) openMenu(widget);
      else closeMenu(widget);
    });
    trigger.addEventListener('keydown', (event) => {
      const isOpen = !menu.hidden;
      if (event.key === 'Escape') {
        if (isOpen) {
          event.preventDefault();
          closeMenu(widget);
          trigger.focus({ preventScroll: true });
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) {
          openMenu(widget);
          return;
        }
        const buttons = optionButtons(widget);
        const current = widget.activeIndex;
        const next = event.key === 'ArrowDown'
          ? (current < 0 ? 0 : Math.min(buttons.length - 1, current + 1))
          : (current < 0 ? buttons.length - 1 : Math.max(0, current - 1));
        setActiveIndex(widget, next, true);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        if (!isOpen) return;
        event.preventDefault();
        const buttons = optionButtons(widget);
        setActiveIndex(widget, event.key === 'Home' ? 0 : buttons.length - 1, true);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!isOpen) {
          openMenu(widget);
          return;
        }
        const active = widget.menu.querySelector('.ph-cselect-option.is-active');
        if (active && active.getAttribute('aria-disabled') !== 'true') {
          selectValue(widget, widget.select.options[Number(active.dataset.index)]?.value);
        }
      }
    });
    menu.addEventListener('click', (event) => {
      const option = event.target.closest('.ph-cselect-option');
      if (!option || option.getAttribute('aria-disabled') === 'true') return;
      const index = Number(option.dataset.index);
      const entry = select.options[index];
      if (entry) selectValue(widget, entry.value);
    });
    menu.addEventListener('scroll', () => positionMenu(trigger, menu), { passive: true });
  }

  function enhance(select) {
    if (!select || select.dataset.phCselect === '1') return null;
    if (select.id === 'imageGenModel') return null; // 已有专有模型选择器
    select.dataset.phCselect = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ph-cselect';
    if (select.classList.contains('desktop-only')) wrap.classList.add('desktop-only');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ph-cselect-trigger ' + select.className.replace(/\bdesktop-only\b/g, '').replace(/\s+/g, ' ').trim();
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('role', 'combobox');
    if (select.getAttribute('aria-label')) trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
    else {
      const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
      if (label) trigger.setAttribute('aria-label', label.textContent.replace(/\s+/g, ' ').trim());
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'ph-cselect-value';
    trigger.appendChild(valueEl);
    trigger.insertAdjacentHTML('beforeend',
      '<svg class="ph-cselect-chevron" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.2 6.2a.7.7 0 0 1 1-.9L8 8l2.8-2.7a.7.7 0 1 1 1 .9L8 9.9z"/></svg>');

    const menu = document.createElement('div');
    menu.className = 'ph-cselect-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    if (select.getAttribute('aria-label')) menu.setAttribute('aria-label', select.getAttribute('aria-label'));

    select.parentElement.insertBefore(wrap, select);
    wrap.appendChild(trigger);
    // 菜单挂到 body：表单内 transform 祖先会把 fixed 定位吸附到自己的坐标系并裁剪，
    // 菜单直接以 viewport 定位，避免被 imagegen-form / 折叠容器裁掉。
    document.body.appendChild(menu);

    // 状态载体保留在 DOM：仅隐藏渲染，通过原 select 读写值
    select.hidden = true;
    select.setAttribute('aria-hidden', 'true');
    select.setAttribute('tabindex', '-1');

    // 关联的 <label for> 指向触发器，保证点击标签也能打开
    document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach((label) => {
      label.setAttribute('for', trigger.id);
    });

    const widget = { select, trigger, menu, valueEl, wrap, activeIndex: -1 };
    widgets.push(widget);
    bindTrigger(widget);
    syncLabel(widget);

    // 外部代码会直接替换 options / 赋值 value：跟随刷新标签。
    select.addEventListener('change', () => syncLabel(widget));
    new MutationObserver(() => syncLabel(widget)).observe(select, { childList: true });

    return widget;
  }

  function enhanceAll() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    root.querySelectorAll('select').forEach(enhance);
  }

  document.addEventListener('pointerdown', (event) => {
    if (!widgets.length) return;
    const target = event.target;
    widgets.forEach((widget) => {
      if (widget.menu.hidden) return;
      if (widget.wrap.contains(target) || widget.menu.contains(target)) return;
      closeMenu(widget);
    });
  }, true);

  window.ImageGenSelectUI = { enhanceAll, enhance, widgets };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAll);
  } else {
    enhanceAll();
  }
})();
