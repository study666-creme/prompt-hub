          communityBucketPollStarted = 0;
        }
        void loadCommunity(true);
      });
    });
    document.querySelectorAll('[data-bucket-risk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setBucketRiskFilter(btn.getAttribute('data-bucket-risk') || 'all');
        communityOffset = 0;
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      });
    });
    $('communityBucketRescanBtn')?.addEventListener('click', () => {
      communityBucketScanMeta = null;
      communityBucketForceRefresh = true;
      communityBucketPollStarted = Date.now();
      void loadBucketOrphansPage({ reset: true, forceRefresh: true });
    });
    document.querySelectorAll('[data-code-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCodeCategoryFilter(btn.getAttribute('data-code-category') || 'all');
        void loadCodes(true);
      });
    });
    if (session?.secret) {
      const sub = $('adminPageSubtitle');
      if (sub) sub.textContent = `API：${apiBase(session)} · 正在验证登录…`;
      setPageTitle('overview');
      void validateStoredSession().then(() => {
        if (session?.secret) {
          document.querySelector('.admin-tab[data-tab="overview"]')?.click();
        }
      });
    }
    } catch (e) {
      console.error('[admin] init failed', e);
      showApp(false);
      showMsg($('loginMsg'), '控制台脚本加载异常，请强刷页面（Ctrl+Shift+R）', false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
