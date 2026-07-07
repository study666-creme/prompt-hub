          communityBucketPollStarted = 0;
        }
        void loadCommunity(true);
      });
    });
    document.querySelectorAll('[data-bucket-risk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setBucketRiskFilter(btn.getAttribute('data-bucket-risk') || 'all');
        communityOffset = 0;
        communityBucketSelected.clear();
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      });
    });
    $('communityBucketRescanBtn')?.addEventListener('click', () => {
      communityBucketScanMeta = null;
      communityBucketForceRefresh = true;
      communityBucketPollStarted = Date.now();
      communityBucketSelected.clear();
      void loadBucketOrphansPage({ reset: true, forceRefresh: true });
    });
    document.querySelectorAll('[data-code-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCodeCategoryFilter(btn.getAttribute('data-code-category') || 'all');
        void loadCodes(true);
      });
    });
    $('communityBucketDeleteSelectedBtn')?.addEventListener('click', async () => {
      toast('批量删除已暂停：此前扫描有误删风险。请逐条核对后再删，或联系维护人员。', false);
      return;
      if (!session || !communityBucketSelected.size) return;
      const groups = communityBucketItems.filter((g) => communityBucketSelected.has(g.id));
      const risky = groups.filter((g) => g.risk && g.risk !== 'safe');
      if (risky.length) {
        toast(`已选 ${risky.length} 组非「高置信」条目，建议先点恢复再删`, false);
        return;
      }
      const paths = groups.flatMap((g) => g.paths || [g.path]);
      if (paths.length > 50) {
        toast('单次最多删除 50 个物理文件，请减少勾选数量', false);
        return;
      }
      const btn = $('communityBucketDeleteSelectedBtn');
      try {
        await runCommunityAdminTask({
          btn,
          confirmTitle: '删除选中的孤儿文件',
          confirmText: `删除已勾选的 ${groups.length} 组（共 ${paths.length} 个物理文件）？\n\n请确认预览图不是仍在使用的卡片。\n\n不可恢复。`,
          confirmDanger: true,
          progressText: `正在删除 ${paths.length} 个文件…`,
          msgEl: $('communityMsg'),
          request: () => adminFetch(session, '/api/admin/community/bucket-orphans/delete', {
            method: 'POST',
            body: { paths },
            timeoutMs: 120000
          }),
          onSuccess: (r) => {
            removeBucketOrphanGroups(paths);
            groups.forEach((g) => communityBucketSelected.delete(g.id));
            updateBucketOrphanBatchUi();
            return `已删 ${r.removed || 0} 个（R2 ${r.r2Removed || 0}）`;
          }
        });
      } catch (e) { /* toast handled */ }
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
