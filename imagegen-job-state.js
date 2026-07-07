/**
 * Image generation job persistence and pending/failed queue state.
 */
(function (global) {
  'use strict';

  const LS_SESSION_GEN_JOBS = 'promptrepo_session_gen_jobs';
  const LS_PENDING_GEN_JOBS = 'promptrepo_pending_gen_jobs';
  const LS_FAILED_GEN_JOBS = 'promptrepo_failed_gen_jobs';
  const LS_GEN_JOBS_STATE = 'promptrepo_gen_jobs_state_v1';

  const RECENT_GEN_RECOVER_MS = 2 * 3600 * 1000;
  const SERVER_RECOVER_AFTER_MS = 8 * 60 * 1000;
  const FAILED_JOB_RECOVER_MAX_MS = 12 * 60 * 1000;
  const GEN_JOBS_LIST_MIN_MS = 8000;

  function create(getDeps) {
    function d() { return getDeps?.() || {}; }
    function GE() { return global.ImageGenGenErrors || {}; }
    function pendingList() { return d().getPendingJobs?.() || []; }
    function setPending(v) { d().setPendingJobs?.(v); }
    function failedList() { return d().getFailedJobs?.() || []; }
    function setFailed(v) { d().setFailedJobs?.(v); }

    function ge(name, ...args) {
      const fn = GE()[name];
      return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function getGenJobStateUid() {
      return global.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || 'guest';
    }

    function loadGenJobStateFromLocal() {
      try {
        const raw = localStorage.getItem(LS_GEN_JOBS_STATE);
        if (!raw) return null;
        const data = JSON.parse(raw);
        const uid = getGenJobStateUid();
        if (data?.uid && data.uid !== uid && uid !== 'guest') return null;
        return data;
      } catch (e) {
        return null;
      }
    }

    function mergePendingGenJobLists(...lists) {
      const byKey = new Map();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const p of list) {
          if (!p?.id) continue;
          const key = p.jobId ? String(p.jobId) : String(p.id);
          const prev = byKey.get(key);
          if (!prev || (p.startedAt || 0) >= (prev.startedAt || 0)) byKey.set(key, p);
        }
      }
      return [...byKey.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }

    function persistGenJobStateToLocal() {
      try {
        localStorage.setItem(LS_GEN_JOBS_STATE, JSON.stringify({
          uid: getGenJobStateUid(),
          updatedAt: Date.now(),
          pending: pendingList().slice(0, 32),
          session: getSessionGenJobIdsRaw()
        }));
      } catch (e) { /* ignore */ }
    }

    function filterPendingGenJobsByAge(list) {
      const now = Date.now();
      return (list || []).filter((p) => {
        const age = now - (p.startedAt || 0);
        if (p.recovering) {
          return p.jobId ? age < RECENT_GEN_RECOVER_MS : age < 30 * 60 * 1000;
        }
        if (p.jobId) return age < RECENT_GEN_RECOVER_MS;
        return age < 15 * 60 * 1000;
      });
    }

    function getSessionGenJobIdsRaw() {
      try {
        const raw = sessionStorage.getItem(LS_SESSION_GEN_JOBS);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.map(String) : [];
      } catch (e) {
        return [];
      }
    }

    function writeSessionGenJobIds(list) {
      const ids = [...new Set((list || []).map(String).filter(Boolean))];
      while (ids.length > 40) ids.shift();
      try {
        sessionStorage.setItem(LS_SESSION_GEN_JOBS, JSON.stringify(ids));
      } catch (e) { /* ignore */ }
      persistGenJobStateToLocal();
    }

    function afterGenJobsResume(changed) {
      if (!changed) return;
      if (document.getElementById('pageImageGen')?.classList.contains('active')) {
        d().renderImageGenFeed?.({ preserveScroll: true, force: true });
        d().renderImageGenMobileResult?.();
      } else {
        global.refreshWarehouseUI?.();
      }
    }

    function scheduleImageGenPendingUiRefresh() {
      if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
      if (!pendingList().length && !failedList().length) return;
      clearTimeout(scheduleImageGenPendingUiRefresh._t);
      scheduleImageGenPendingUiRefresh._t = setTimeout(() => {
        if (global.ImageGenFeed?.patchImageGenFeedPendingOnly?.()) return;
        d().renderImageGenFeed?.({ preserveScroll: true, force: true });
      }, 480);
    }

    function persistPendingGenJobs() {
      try {
        sessionStorage.setItem(LS_PENDING_GEN_JOBS, JSON.stringify(pendingList().slice(0, 32)));
      } catch (e) { /* ignore */ }
      persistGenJobStateToLocal();
    }

    function purgeExpiredGenPendingJobs() {
      const now = Date.now();
      const before = pendingList().length;
      setPending(pendingList().filter((p) => {
        const age = now - (p.startedAt || 0);
        if (!p.jobId) return age < 15 * 60 * 1000;
        return age < RECENT_GEN_RECOVER_MS;
      }));
      if (pendingList().length !== before) persistPendingGenJobs();
    }

    function loadPendingGenJobs() {
      try {
        const raw = sessionStorage.getItem(LS_PENDING_GEN_JOBS);
        const sessionList = raw ? JSON.parse(raw) : [];
        const localPending = loadGenJobStateFromLocal()?.pending;
        setPending(mergePendingGenJobLists(
          Array.isArray(sessionList) ? sessionList : [],
          Array.isArray(localPending) ? localPending : [],
          pendingList()
        ));
        const before = pendingList().length;
        setPending(filterPendingGenJobsByAge(pendingList()));
        if (pendingList().length !== before) persistPendingGenJobs();
        purgeExpiredGenPendingJobs();
        d().prunePendingJobsWithWarehouseCards?.();
        const localSession = loadGenJobStateFromLocal()?.session;
        if (Array.isArray(localSession) && localSession.length) {
          const merged = [...new Set([...getSessionGenJobIdsRaw(), ...localSession.map(String)])];
          writeSessionGenJobIds(merged);
        }
      } catch (e) {
        setPending([]);
      }
    }

    function persistFailedGenJobs() {
      try {
        sessionStorage.setItem(LS_FAILED_GEN_JOBS, JSON.stringify(failedList().slice(0, 24)));
      } catch (e) { /* ignore */ }
    }

    function loadFailedGenJobs() {
      try {
        const raw = sessionStorage.getItem(LS_FAILED_GEN_JOBS);
        const list = raw ? JSON.parse(raw) : [];
        setFailed(Array.isArray(list) ? list : []);
        let stale = false;
        setFailed(failedList().map((f) => {
          if (ge('isStaleConfigError', f?.errorMessage)) {
            stale = true;
            return {
              ...f,
              needsRecovery: true,
              errorMessage: ge('friendlyGenErrorMessage', f.errorMessage)
            };
          }
          return f;
        }));
        if (stale) persistFailedGenJobs();
      } catch (e) {
        setFailed([]);
      }
    }

    return {
      LS_SESSION_GEN_JOBS,
      LS_PENDING_GEN_JOBS,
      LS_FAILED_GEN_JOBS,
      LS_GEN_JOBS_STATE,
      RECENT_GEN_RECOVER_MS,
      SERVER_RECOVER_AFTER_MS,
      FAILED_JOB_RECOVER_MAX_MS,
      GEN_JOBS_LIST_MIN_MS,
      afterGenJobsResume,
      failedList,
      filterPendingGenJobsByAge,
      getGenJobStateUid,
      getSessionGenJobIdsRaw,
      loadFailedGenJobs,
      loadGenJobStateFromLocal,
      loadPendingGenJobs,
      mergePendingGenJobLists,
      pendingList,
      persistFailedGenJobs,
      persistGenJobStateToLocal,
      persistPendingGenJobs,
      purgeExpiredGenPendingJobs,
      scheduleImageGenPendingUiRefresh,
      setFailed,
      setPending,
      writeSessionGenJobIds
    };
  }

  global.ImageGenJobState = { create };
})(typeof window !== 'undefined' ? window : globalThis);
