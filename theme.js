(function () {
  const STORAGE_KEY = 'promptrepo_theme';
  const SETTINGS_KEY = 'promptrepo_settings';
  const DAY_START_HOUR = 8;
  const NIGHT_START_HOUR = 20;
  let autoCheckTimer = null;

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeSettingsPatch(patch) {
    const s = Object.assign(readSettings(), patch);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return s;
  }

  function isAutoDayNightEnabled() {
    const s = readSettings();
    return s.autoDayNight === true;
  }

  function isThemeManualOverride() {
    return readSettings().themeManualOverride === true;
  }

  function setThemeManualOverride(val) {
    writeSettingsPatch({ themeManualOverride: !!val });
  }

  function getScheduledTheme() {
    const h = new Date().getHours();
    return h >= DAY_START_HOUR && h < NIGHT_START_HOUR ? 'light' : 'dark';
  }

  function getPreferred() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  }

  function persistThemeInSettings(theme) {
    writeSettingsPatch({ theme });
  }

  function updateToggleLabel(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const light = theme === 'light';
    btn.title = light ? '切换夜间模式' : '切换日光模式';
    btn.setAttribute('aria-label', btn.title);
  }

  function applyTheme(theme, opts) {
    const fromAuto = opts && opts.fromAuto === true;
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(STORAGE_KEY, t);
    persistThemeInSettings(t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f2f2f7' : '#121212');
    updateToggleLabel(t);
    if (!fromAuto) setThemeManualOverride(true);
  }

  function applyAutoThemeIfNeeded() {
    if (!isAutoDayNightEnabled() || isThemeManualOverride()) return;
    applyTheme(getScheduledTheme(), { fromAuto: true });
  }

  function scheduleAutoCheck() {
    if (autoCheckTimer) clearInterval(autoCheckTimer);
    autoCheckTimer = setInterval(applyAutoThemeIfNeeded, 60 * 1000);
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    if (isAutoDayNightEnabled()) {
      setThemeManualOverride(true);
      if (typeof showToast === 'function') {
        showToast(next === 'light' ? '已切换日光模式（已暂停自动昼夜，可在设置中重新开启）' : '已切换夜间模式');
      }
    } else if (typeof showToast === 'function') {
      showToast(next === 'light' ? '已切换日光模式' : '已切换夜间模式');
    }
  }

  function clearThemeManualOverride() {
    setThemeManualOverride(false);
    applyAutoThemeIfNeeded();
  }

  function onAutoDayNightSettingChanged(enabled) {
    writeSettingsPatch({ autoDayNight: enabled !== false });
    if (enabled !== false) {
      clearThemeManualOverride();
      if (typeof showToast === 'function') showToast('已开启自动昼夜（早 8 点日光 / 晚 8 点夜间）');
    } else if (typeof showToast === 'function') {
      showToast('已关闭自动昼夜');
    }
  }

  function initTheme() {
    if (isAutoDayNightEnabled()) {
      setThemeManualOverride(false);
      applyTheme(getScheduledTheme(), { fromAuto: true });
      return;
    }
    applyTheme(getPreferred(), { fromAuto: false });
  }
  initTheme();
  scheduleAutoCheck();

  window.getAppTheme = () => document.documentElement.getAttribute('data-theme') || 'dark';
  window.applyAppTheme = (theme) => applyTheme(theme);
  window.toggleAppTheme = toggleTheme;
  window.ThemeSchedule = {
    applyAutoThemeIfNeeded,
    clearThemeManualOverride,
    onAutoDayNightSettingChanged,
    getScheduledTheme,
    isAutoDayNightEnabled,
    isThemeManualOverride
  };

  function bind() {
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
