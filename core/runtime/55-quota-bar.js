/**
 * Part 55: Always-Visible, Style-Customizable Antigravity Quota/Usage Bar & Detail Popover
 * Reads live quota summary via Antigravity's in-page React Context RPC (retrieveUserQuotaSummary + userStatus).
 */
  function escapeQuotaHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cleanupQuotaBarDom() {
    try {
      for (const id of ['ag-quota-bar', 'ag-quota-tooltip']) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
      document.querySelectorAll('[data-ag-has-quota]').forEach((el) => {
        el.removeAttribute('data-ag-has-quota');
      });
    } catch {}
  }

  function mountQuotaBar() {
    cleanupQuotaBarDom();
    if (IS_SWARM_PLUGIN_FRAME || !ENABLED || !MODULES.quotaBar) {
      return;
    }
    if (typeof document === 'undefined' || !document.body) return;

    const QUOTA_CFG = Object.assign(
      {
        style: 'bar',
        placement: 'inline',
        scope: 'current',
        windows: 'both',
        theme: 'auto',
        size: 'md',
        align: 'center',
        showReset: true,
        showCredits: false,
        customColor: '',
        customBg: ''
      },
      boot.quotaBar || (boot.userConfig && boot.userConfig.quotaBar) || {}
    );

    const isZh = Boolean(MODULES.i18n);
    let disposed = false;
    let inFlightFetch = null;
    let lastGenIdx = null;
    let lastModelKey = '';
    let genDebounceTimer = null;
    let showTimer = null;
    let hideTimer = null;
    let pinned = false;
    let syncTimer = null;
    let pollTimer = null;

    function findAntigravityContexts() {
      const roots = [];
      const boxes = document.querySelectorAll('[id="' + SELECTORS.inputBoxId + '"]');
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!b.closest || (!b.closest('[data-testid="side-question-tab-content"]') && !b.closest('[data-testid="side-question-tab-composer"]'))) {
          roots.push(b);
          break;
        }
      }
      const settingsBtn = document.querySelector('[data-testid="settings-button"]');
      if (settingsBtn) roots.push(settingsBtn);
      const appRoot = document.getElementById('root');
      if (appRoot && appRoot.firstElementChild) roots.push(appRoot.firstElementChild);

      let rpcClient = null;
      let userStatus = null;
      let selectedModel = null;

      for (let r = 0; r < roots.length; r++) {
        const el = roots[r];
        if (!el) continue;
        const fk = Object.keys(el).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
        );
        let f = fk ? el[fk] : null;
        for (let i = 0; i < 250 && f; i++, f = f.return) {
          const val = f.memoizedProps && f.memoizedProps.value;
          if (!val || typeof val !== 'object') continue;
          if (!rpcClient && typeof val.retrieveUserQuotaSummary === 'function') {
            rpcClient = val;
          }
          if (!userStatus && val.userStatus && typeof val.userStatus === 'object') {
            userStatus = val.userStatus;
          }
          if (!selectedModel && val.cascadeContext && val.cascadeContext.state && val.cascadeContext.state.selectedModel) {
            selectedModel = val.cascadeContext.state.selectedModel;
          }
          if (rpcClient && userStatus && selectedModel) break;
        }
        if (rpcClient && userStatus) break;
      }

      return { rpcClient, userStatus, selectedModel };
    }

    function extractTimestampMs(ts) {
      if (!ts) return 0;
      const sec = Number(ts.seconds || 0);
      const nanos = Number(ts.nanos || 0);
      if (!Number.isFinite(sec) || sec <= 0) return 0;
      return sec * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
    }

    function normalizeWindowKey(winStr, bucketId, displayName) {
      const w = String(winStr || bucketId || displayName || '').toLowerCase();
      if (w.includes('5h') || w.includes('five hour') || w.includes('5-hour')) return '5h';
      if (w.includes('week')) return 'weekly';
      return w || 'other';
    }

    function extractCredits(userStatus) {
      try {
        const list = userStatus && userStatus.userTier && userStatus.userTier.availableCredits;
        if (Array.isArray(list) && list.length > 0) {
          let sum = 0;
          for (let i = 0; i < list.length; i++) {
            const amt = Number(list[i] && list[i].creditAmount);
            if (Number.isFinite(amt)) sum += amt;
          }
          return sum;
        }
        const plan = userStatus && userStatus.planStatus;
        if (plan && typeof plan.availablePromptCredits === 'number') {
          return plan.availablePromptCredits;
        }
      } catch {}
      return null;
    }

    function parseQuotaFromSummaryResponse(res, userStatus) {
      const resp = res && res.response ? res.response : res;
      const rawGroups = resp && Array.isArray(resp.groups) ? resp.groups : [];
      const groups = [];

      for (let i = 0; i < rawGroups.length; i++) {
        const g = rawGroups[i];
        if (!g) continue;
        const rawBuckets = Array.isArray(g.buckets) ? g.buckets : [];
        const buckets = [];
        for (let j = 0; j < rawBuckets.length; j++) {
          const b = rawBuckets[j];
          if (!b) continue;
          let frac = null;
          if (b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number') {
            frac = b.remaining.value;
          } else if (typeof b.remainingFraction === 'number') {
            frac = b.remainingFraction;
          }
          if (frac === null || !Number.isFinite(frac)) continue;
          const clampedFrac = Math.max(0, Math.min(1, frac));
          const winKey = normalizeWindowKey(b.window, b.bucketId, b.displayName);
          buckets.push({
            bucketId: String(b.bucketId || winKey),
            window: winKey,
            displayName: String(b.displayName || winKey),
            description: String(b.description || ''),
            fraction: clampedFrac,
            pct: Math.round(clampedFrac * 100),
            disabled: Boolean(b.disabled),
            resetTimeMs: extractTimestampMs(b.resetTime)
          });
        }
        if (buckets.length > 0) {
          groups.push({
            displayName: String(g.displayName || 'Quota'),
            description: String(g.description || ''),
            buckets
          });
        }
      }

      if (groups.length === 0 && userStatus && userStatus.cascadeModelConfigData && Array.isArray(userStatus.cascadeModelConfigData.clientModelConfigs)) {
        const configs = userStatus.cascadeModelConfigData.clientModelConfigs;
        const geminiModels = [];
        const thirdPartyModels = [];
        for (let i = 0; i < configs.length; i++) {
          const m = configs[i];
          if (!m || !m.quotaInfo || typeof m.quotaInfo.remainingFraction !== 'number') continue;
          if (/claude|gpt|opus|sonnet/i.test(m.label || '')) {
            thirdPartyModels.push(m);
          } else {
            geminiModels.push(m);
          }
        }
        const pushFallbackGroup = (name, arr) => {
          if (arr.length === 0) return;
          const m0 = arr[0];
          const frac = Math.max(0, Math.min(1, m0.quotaInfo.remainingFraction));
          groups.push({
            displayName: name,
            description: arr.map((x) => x.label).slice(0, 6).join(', '),
            buckets: [
              {
                bucketId: 'fallback-5h',
                window: '5h',
                displayName: 'Five Hour Limit Remaining',
                description: '',
                fraction: frac,
                pct: Math.round(frac * 100),
                disabled: false,
                resetTimeMs: extractTimestampMs(m0.quotaInfo.resetTime)
              }
            ]
          });
        };
        pushFallbackGroup('Gemini Models', geminiModels);
        pushFallbackGroup('Claude and GPT models', thirdPartyModels);
      }

      const planName = String(
        (userStatus && userStatus.userTier && userStatus.userTier.description) ||
          (userStatus && userStatus.planStatus && userStatus.planStatus.planInfo && userStatus.planStatus.planInfo.planName) ||
          ''
      ).trim();

      return {
        groups,
        note: String((resp && resp.description) || ''),
        planName,
        credits: extractCredits(userStatus),
        fetchedAt: Date.now()
      };
    }

    async function fetchQuotaData({ force = false } = {}) {
      if (disposed) return window.__ag_quota_cache || null;
      const cache = window.__ag_quota_cache;
      if (!force && cache && cache.groups && cache.groups.length > 0 && Date.now() - cache.fetchedAt < 15000) {
        return cache;
      }
      if (inFlightFetch) return inFlightFetch;

      inFlightFetch = (async () => {
        try {
          const { rpcClient, userStatus } = findAntigravityContexts();
          let summaryRes = null;
          if (rpcClient && typeof rpcClient.retrieveUserQuotaSummary === 'function') {
            try {
              summaryRes = await rpcClient.retrieveUserQuotaSummary({});
            } catch {}
          }
          let freshUserStatus = userStatus;
          if (!freshUserStatus && rpcClient && typeof rpcClient.getUserStatus === 'function') {
            try {
              const usRes = await rpcClient.getUserStatus({});
              if (usRes && usRes.userStatus) freshUserStatus = usRes.userStatus;
            } catch {}
          }
          const parsed = parseQuotaFromSummaryResponse(summaryRes, freshUserStatus);
          if (parsed.groups.length > 0 || !window.__ag_quota_cache) {
            window.__ag_quota_cache = parsed;
          }
          if (!disposed) {
            renderQuotaBar();
            if (isTooltipVisible()) {
              renderQuotaTooltip();
            }
          }
          return window.__ag_quota_cache;
        } finally {
          inFlightFetch = null;
        }
      })();

      return inFlightFetch;
    }

    function getMainInputBox() {
      const boxes = document.querySelectorAll('[id="' + SELECTORS.inputBoxId + '"]');
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!b.closest || (!b.closest('[data-testid="side-question-tab-content"]') && !b.closest('[data-testid="side-question-tab-composer"]'))) {
          return b;
        }
      }
      return null;
    }

    function findMainComposerRow(inputBox) {
      if (!inputBox) return null;
      const modelTrigger = inputBox.querySelector('[data-testid="model-selector-trigger"]');
      if (!modelTrigger) return null;
      if (modelTrigger.closest) {
        const explicitRow = modelTrigger.closest('.agy-composer-footer, [data-agent-composer-root]');
        if (explicitRow && inputBox.contains(explicitRow)) return explicitRow;
      }
      const boxWidth = inputBox.getBoundingClientRect ? Math.round(inputBox.getBoundingClientRect().width || 0) : 0;
      let best = null;
      let cur = modelTrigger.parentElement;
      for (let i = 0; i < 12 && cur && cur !== inputBox; i++, cur = cur.parentElement) {
        if (!cur.children || cur.children.length < 2) continue;
        if (boxWidth > 0 && cur.getBoundingClientRect) {
          const rw = Math.round(cur.getBoundingClientRect().width || 0);
          if (rw > 0 && rw < boxWidth * 0.7) continue;
        }
        best = cur;
      }
      return best;
    }

    function getCurrentModelName() {
      const { selectedModel } = findAntigravityContexts();
      if (selectedModel && selectedModel.label) return String(selectedModel.label);
      const box = getMainInputBox();
      if (typeof getSelectedModelLabel === 'function' && box) {
        return getSelectedModelLabel(box);
      }
      return '';
    }

    function resolveActiveGroupIndex(groups, modelLabel) {
      if (!groups || groups.length === 0) return -1;
      const cleaned = String(modelLabel || '')
        .replace(/^Orchestrator\s+/i, '')
        .replace(/\s*\((?:Low|Medium|High|XHigh|Extra High)\)\s*$/i, '')
        .trim()
        .toLowerCase();
      if (cleaned) {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const hay = (g.displayName + ' ' + g.description).toLowerCase();
          if (hay.includes(cleaned)) return i;
        }
        if (/claude|gpt|opus|sonnet/i.test(cleaned)) {
          const idx = groups.findIndex((g) => /claude|gpt/i.test(g.displayName + ' ' + g.description));
          if (idx >= 0) return idx;
        }
        if (/gemini|neon|carbon|argon|hydrogen|flash|orchestrator/i.test(cleaned)) {
          const idx = groups.findIndex((g) => /gemini/i.test(g.displayName));
          if (idx >= 0) return idx;
        }
      }
      return 0;
    }

    function shortGroupLabel(displayName) {
      const s = String(displayName || '');
      if (/gemini/i.test(s)) return 'Gemini';
      if (/claude|gpt/i.test(s)) return 'Claude/GPT';
      return s.slice(0, 14);
    }

    function shortWindowLabel(win) {
      if (win === '5h') return '5h';
      if (win === 'weekly') return isZh ? '周' : 'Wk';
      return String(win || '').slice(0, 6);
    }

    function formatResetShort(resetMs, nowMs) {
      if (!resetMs || resetMs <= 0) return '';
      const diffMs = resetMs - nowMs;
      if (diffMs <= 0) return isZh ? '已重置' : 'now';
      const totalMin = Math.floor(diffMs / 60000);
      if (totalMin < 60) return Math.max(1, totalMin) + 'm';
      const totalHr = Math.floor(totalMin / 60);
      const remMin = totalMin % 60;
      if (totalHr < 24) return remMin > 0 ? totalHr + 'h' + remMin + 'm' : totalHr + 'h';
      const days = Math.floor(totalHr / 24);
      const remHr = totalHr % 24;
      return remHr > 0 ? days + 'd' + remHr + 'h' : days + 'd';
    }

    function formatResetFull(resetMs, nowMs) {
      if (!resetMs || resetMs <= 0) return isZh ? '满额未消耗' : 'Full';
      const diffMs = resetMs - nowMs;
      if (diffMs <= 0) return isZh ? '即将重置' : 'Resetting soon';
      const totalMin = Math.floor(diffMs / 60000);
      if (totalMin < 60) {
        const m = Math.max(1, totalMin);
        return isZh ? m + ' 分钟后重置' : 'Resets in ' + m + 'm';
      }
      const totalHr = Math.floor(totalMin / 60);
      const remMin = totalMin % 60;
      if (totalHr < 24) {
        return isZh
          ? totalHr + ' 小时' + (remMin > 0 ? ' ' + remMin + ' 分钟' : '') + '后重置'
          : 'Resets in ' + totalHr + 'h' + (remMin > 0 ? ' ' + remMin + 'm' : '');
      }
      const days = Math.floor(totalHr / 24);
      const remHr = totalHr % 24;
      return isZh
        ? days + ' 天' + (remHr > 0 ? ' ' + remHr + ' 小时' : '') + '后重置'
        : 'Resets in ' + days + 'd' + (remHr > 0 ? ' ' + remHr + 'h' : '');
    }

    function getLevelClass(pct) {
      if (pct <= 20) return 'crit';
      if (pct <= 50) return 'warn';
      return 'ok';
    }

    function selectBuckets(group) {
      const buckets = group && Array.isArray(group.buckets) ? group.buckets : [];
      const order = { '5h': 0, weekly: 1 };
      const sorted = buckets.slice().sort((a, b) => (order[a.window] ?? 9) - (order[b.window] ?? 9));
      if (QUOTA_CFG.windows === '5h') {
        const f = sorted.filter((b) => b.window === '5h');
        return f.length > 0 ? f : sorted.slice(0, 1);
      }
      if (QUOTA_CFG.windows === 'weekly') {
        const f = sorted.filter((b) => b.window === 'weekly');
        return f.length > 0 ? f : sorted.slice(0, 1);
      }
      return sorted;
    }

    function buildBarHtml(data) {
      if (!data || !Array.isArray(data.groups) || data.groups.length === 0) {
        return '<span class="ag-q-loading">' + (isZh ? '配额读取中…' : 'Quota…') + '</span>';
      }
      const now = Date.now();
      const activeIdx = resolveActiveGroupIndex(data.groups, getCurrentModelName());
      const groupsToShow =
        QUOTA_CFG.scope === 'all' ? data.groups : [data.groups[activeIdx >= 0 ? activeIdx : 0]];

      const groupHtmls = [];
      for (let gi = 0; gi < groupsToShow.length; gi++) {
        const g = groupsToShow[gi];
        if (!g) continue;
        const buckets = selectBuckets(g);
        if (buckets.length === 0) continue;

        const showGrpTag = QUOTA_CFG.scope === 'all' || groupsToShow.length > 1;
        const grpTagHtml = showGrpTag
          ? '<span class="ag-q-grp">' + escapeQuotaHtml(shortGroupLabel(g.displayName)) + '</span>'
          : '<span class="ag-q-prefix">' + (isZh ? '配额' : 'Quota') + '</span>';

        const itemsHtml = [];
        for (let bi = 0; bi < buckets.length; bi++) {
          const b = buckets[bi];
          const lvl = getLevelClass(b.pct);
          const winLbl = shortWindowLabel(b.window);
          const resetShort = QUOTA_CFG.showReset && b.resetTimeMs > 0 ? formatResetShort(b.resetTimeMs, now) : '';
          const resetHtml = resetShort ? '<span class="ag-q-rst">(' + escapeQuotaHtml(resetShort) + ')</span>' : '';

          if (QUOTA_CFG.style === 'pill') {
            itemsHtml.push(
              '<span class="ag-q-item ag-q-pill-chip" data-lvl="' +
                lvl +
                '">' +
                '<span class="ag-q-dot"></span>' +
                '<span class="ag-q-lbl">' +
                escapeQuotaHtml(winLbl) +
                '</span>' +
                '<span class="ag-q-pct">' +
                b.pct +
                '%</span>' +
                resetHtml +
                '</span>'
            );
          } else if (QUOTA_CFG.style === 'text') {
            itemsHtml.push(
              '<span class="ag-q-item" data-lvl="' +
                lvl +
                '">' +
                '<span class="ag-q-lbl">' +
                escapeQuotaHtml(winLbl) +
                '</span>' +
                '<span class="ag-q-pct">' +
                b.pct +
                '%</span>' +
                resetHtml +
                '</span>'
            );
          } else {
            itemsHtml.push(
              '<span class="ag-q-item" data-lvl="' +
                lvl +
                '">' +
                '<span class="ag-q-lbl">' +
                escapeQuotaHtml(winLbl) +
                '</span>' +
                '<span class="ag-q-track"><span class="ag-q-fill" style="width:' +
                b.pct +
                '%"></span></span>' +
                '<span class="ag-q-pct">' +
                b.pct +
                '%</span>' +
                resetHtml +
                '</span>'
            );
          }
        }

        groupHtmls.push(
          '<span class="ag-q-group">' + grpTagHtml + itemsHtml.join('') + '</span>'
        );
      }

      let creditsHtml = '';
      if (QUOTA_CFG.showCredits && data.credits !== null && data.credits !== undefined) {
        creditsHtml =
          '<span class="ag-q-credits">' +
          (isZh ? '点数 ' : 'Cr ') +
          escapeQuotaHtml(String(data.credits)) +
          '</span>';
      }

      return groupHtmls.join('<span class="ag-q-grp-sep">·</span>') + creditsHtml;
    }

    function ensureQuotaBarElement() {
      const inputBox = getMainInputBox();
      if (!inputBox) return null;
      const row = findMainComposerRow(inputBox);
      if (!row || !row.parentElement) return null;

      let bar = document.getElementById('ag-quota-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'ag-quota-bar';
        bar.setAttribute('role', 'button');
        bar.setAttribute('tabindex', '0');
        bar.setAttribute('aria-label', isZh ? 'Antigravity 模型配额' : 'Antigravity Quota');

        bar.addEventListener('mouseenter', () => {
          if (window.__ag_tt_show_timer) {
            clearTimeout(window.__ag_tt_show_timer);
            window.__ag_tt_show_timer = null;
          }
          const metricsTt = document.getElementById('ag-live-metrics-tooltip');
          if (metricsTt && !window.__ag_tt_pinned) {
            metricsTt.removeAttribute('data-visible');
          }
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          if (showTimer) clearTimeout(showTimer);
          showTimer = setTimeout(() => {
            showTimer = null;
            showQuotaTooltip();
          }, 80);
        });

        bar.addEventListener('mouseleave', () => {
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
          if (pinned) return;
          scheduleHideQuotaTooltip();
        });

        bar.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          const tt = ensureQuotaTooltipEl();
          const vis = tt && tt.getAttribute('data-visible') === '1';
          if (!vis || !pinned) {
            pinned = true;
            showQuotaTooltip();
          } else {
            pinned = false;
            hideQuotaTooltip(true);
          }
        });

        bar.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            bar.click();
          }
        });
      }

      bar.setAttribute('data-ag-q-style', QUOTA_CFG.style);
      bar.setAttribute('data-ag-q-theme', QUOTA_CFG.theme);
      bar.setAttribute('data-ag-q-size', QUOTA_CFG.size);
      bar.setAttribute('data-ag-q-align', QUOTA_CFG.align);

      if (QUOTA_CFG.customColor) {
        bar.style.setProperty('--ag-q-custom-color', QUOTA_CFG.customColor);
      } else {
        bar.style.removeProperty('--ag-q-custom-color');
      }
      if (QUOTA_CFG.customBg) {
        bar.style.setProperty('--ag-q-custom-bg', QUOTA_CFG.customBg);
      } else {
        bar.style.removeProperty('--ag-q-custom-bg');
      }

      const pill = document.getElementById('ag-live-metrics-pill');
      const pillInBottom = Boolean(
        pill &&
          pill.isConnected &&
          inputBox.contains(pill) &&
          pill.getAttribute('data-ag-row-mode') === 'bottom' &&
          pill.style.display !== 'none'
      );

      if (QUOTA_CFG.placement === 'inline' && pillInBottom) {
        bar.setAttribute('data-ag-quota-mode', 'inline');
        pill.setAttribute('data-ag-has-quota', '1');
        if (bar.parentElement !== pill) {
          pill.appendChild(bar);
        }
      } else {
        if (pill) pill.removeAttribute('data-ag-has-quota');
        bar.setAttribute('data-ag-quota-mode', 'separate');
        const anchor = pill && pill.parentElement === row.parentElement ? pill : row;
        if (bar.parentElement !== row.parentElement || anchor.nextElementSibling !== bar) {
          row.parentElement.insertBefore(bar, anchor.nextSibling);
        }
      }

      return bar;
    }

    function renderQuotaBar() {
      if (disposed) return;
      const bar = ensureQuotaBarElement();
      if (!bar) return;
      const html = buildBarHtml(window.__ag_quota_cache);
      if (bar.getAttribute('data-ag-q-html') !== html) {
        bar.setAttribute('data-ag-q-html', html);
        bar.innerHTML = html;
      }
    }

    function ensureQuotaTooltipEl() {
      let tt = document.getElementById('ag-quota-tooltip');
      if (!tt && document.body) {
        tt = document.createElement('div');
        tt.id = 'ag-quota-tooltip';
        document.body.appendChild(tt);

        tt.addEventListener('mouseenter', () => {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
        });
        tt.addEventListener('mouseleave', () => {
          if (!pinned) scheduleHideQuotaTooltip();
        });
        tt.addEventListener('click', (e) => {
          const refBtn = e.target && e.target.closest ? e.target.closest('.ag-qt-refresh') : null;
          if (refBtn) {
            e.preventDefault();
            e.stopPropagation();
            refBtn.classList.add('is-spinning');
            fetchQuotaData({ force: true }).finally(() => {
              setTimeout(() => {
                if (refBtn.isConnected) refBtn.classList.remove('is-spinning');
              }, 350);
            });
          }
        });
      }
      return tt;
    }

    function isTooltipVisible() {
      const tt = document.getElementById('ag-quota-tooltip');
      return Boolean(tt && tt.getAttribute('data-visible') === '1');
    }

    function positionQuotaTooltip(bar, tt) {
      if (!bar || !tt) return;
      try {
        const rect = bar.getBoundingClientRect();
        const anchorRect = rect.width > 0 && rect.height > 0 ? rect : (getMainInputBox()?.getBoundingClientRect() || rect);
        const ttW = tt.offsetWidth || tt.getBoundingClientRect().width || 332;
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 800;
        const centerX = anchorRect.left + anchorRect.width / 2;
        const left = Math.max(12, Math.min(Math.round(centerX - ttW / 2), vw - ttW - 12));
        const bottomPx = Math.max(12, Math.round(vh - anchorRect.top + 10));
        tt.style.top = 'auto';
        tt.style.bottom = bottomPx + 'px';
        tt.style.left = left + 'px';
        tt.style.maxHeight = Math.max(180, Math.round(anchorRect.top - 24)) + 'px';
      } catch {}
    }

    function renderQuotaTooltip() {
      const tt = ensureQuotaTooltipEl();
      if (!tt) return;
      const data = window.__ag_quota_cache;
      const now = Date.now();
      const activeIdx = data && data.groups ? resolveActiveGroupIndex(data.groups, getCurrentModelName()) : -1;

      const planBadge =
        data && data.planName
          ? '<span class="ag-qt-plan">' + escapeQuotaHtml(data.planName) + '</span>'
          : '';

      let bodyHtml = '';
      if (!data || !Array.isArray(data.groups) || data.groups.length === 0) {
        bodyHtml =
          '<div class="ag-qt-empty">' +
          (isZh ? '暂无可用配额数据，点击右上角刷新重试。' : 'No quota data yet. Click refresh to retry.') +
          '</div>';
      } else {
        bodyHtml = data.groups
          .map((g, idx) => {
            const isActive = idx === activeIdx;
            const buckets = (g.buckets || []).slice().sort((a, b) => {
              const ord = { '5h': 0, weekly: 1 };
              return (ord[a.window] ?? 9) - (ord[b.window] ?? 9);
            });
            const bucketsHtml = buckets
              .map((b) => {
                const lvl = getLevelClass(b.pct);
                const winTitle =
                  b.window === '5h'
                    ? isZh
                      ? '5 小时剩余配额'
                      : '5-Hour Limit'
                    : b.window === 'weekly'
                    ? isZh
                      ? '每周剩余配额'
                      : 'Weekly Limit'
                    : b.displayName;
                const rstText = formatResetFull(b.resetTimeMs, now);
                return (
                  '<div class="ag-qt-bucket" data-lvl="' +
                  lvl +
                  '">' +
                  '<div class="ag-qt-bucket-top">' +
                  '<span class="ag-qt-bucket-name">' +
                  escapeQuotaHtml(winTitle) +
                  '</span>' +
                  '<span class="ag-qt-bucket-pct">' +
                  b.pct +
                  '%</span>' +
                  '</div>' +
                  '<div class="ag-qt-track"><div class="ag-qt-fill" style="width:' +
                  b.pct +
                  '%"></div></div>' +
                  '<div class="ag-qt-bucket-sub">' +
                  escapeQuotaHtml(rstText) +
                  '</div>' +
                  '</div>'
                );
              })
              .join('');

            return (
              '<div class="ag-qt-group' +
              (isActive ? ' is-active' : '') +
              '">' +
              '<div class="ag-qt-grp-hdr">' +
              '<span class="ag-qt-grp-title">' +
              escapeQuotaHtml(g.displayName) +
              '</span>' +
              (isActive ? '<span class="ag-qt-active-badge">' + (isZh ? '当前' : 'Active') + '</span>' : '') +
              '</div>' +
              '<div class="ag-qt-buckets">' +
              bucketsHtml +
              '</div>' +
              '</div>'
            );
          })
          .join('');
      }

      const updTime =
        data && data.fetchedAt
          ? new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '--:--:--';
      const creditsText =
        data && data.credits !== null && data.credits !== undefined
          ? (isZh ? 'AI 点数: ' : 'AI Credits: ') + data.credits
          : isZh
          ? 'Antigravity 实时配额'
          : 'Live Quota';

      tt.innerHTML =
        '<div class="ag-qt-hdr">' +
        '<div class="ag-qt-hdr-left">' +
        '<span class="ag-qt-title">' +
        (isZh ? 'Antigravity 模型配额' : 'Antigravity Quota') +
        '</span>' +
        planBadge +
        '</div>' +
        '<button type="button" class="ag-qt-refresh" aria-label="' +
        (isZh ? '刷新配额' : 'Refresh quota') +
        '" title="' +
        (isZh ? '刷新配额' : 'Refresh quota') +
        '">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
        '</button>' +
        '</div>' +
        '<div class="ag-qt-body">' +
        bodyHtml +
        '</div>' +
        '<div class="ag-qt-footer">' +
        '<span>' +
        escapeQuotaHtml(creditsText) +
        '</span>' +
        '<span>' +
        (isZh ? '更新于 ' : 'Updated ') +
        escapeQuotaHtml(updTime) +
        '</span>' +
        '</div>';
    }

    function showQuotaTooltip() {
      const bar = document.getElementById('ag-quota-bar');
      if (!bar || !bar.isConnected) return;
      renderQuotaTooltip();
      const tt = document.getElementById('ag-quota-tooltip');
      if (!tt) return;
      positionQuotaTooltip(bar, tt);
      tt.setAttribute('data-visible', '1');
    }

    function hideQuotaTooltip(immediate = false) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (immediate) {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        const tt = document.getElementById('ag-quota-tooltip');
        if (tt) tt.removeAttribute('data-visible');
        return;
      }
      scheduleHideQuotaTooltip();
    }

    function scheduleHideQuotaTooltip() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!pinned) {
          const tt = document.getElementById('ag-quota-tooltip');
          if (tt) tt.removeAttribute('data-visible');
        }
      }, 180);
    }

    const onDocClick = (e) => {
      const t = e && e.target;
      if (!t || !t.closest) return;
      if (t.closest('#ag-quota-bar') || t.closest('#ag-quota-tooltip')) return;
      if (pinned || isTooltipVisible()) {
        pinned = false;
        hideQuotaTooltip(true);
      }
    };

    const onKeyDown = (e) => {
      if (e && e.key === 'Escape' && (pinned || isTooltipVisible())) {
        pinned = false;
        hideQuotaTooltip(true);
      }
    };

    document.addEventListener('click', onDocClick, true);
    window.addEventListener('keydown', onKeyDown, true);

    renderQuotaBar();
    fetchQuotaData({ force: !window.__ag_quota_cache });

    syncTimer = setInterval(() => {
      if (disposed || document.hidden) return;
      renderQuotaBar();
      const curModel = getCurrentModelName();
      if (curModel && curModel !== lastModelKey) {
        lastModelKey = curModel;
        renderQuotaBar();
        if (isTooltipVisible()) renderQuotaTooltip();
      }
      const curGen =
        window.__ag_last_metrics &&
        window.__ag_last_metrics.stats &&
        typeof window.__ag_last_metrics.stats.genIdx === 'number'
          ? window.__ag_last_metrics.stats.genIdx
          : null;
      if (curGen !== null && lastGenIdx !== null && curGen !== lastGenIdx) {
        lastGenIdx = curGen;
        if (genDebounceTimer) clearTimeout(genDebounceTimer);
        genDebounceTimer = setTimeout(() => {
          genDebounceTimer = null;
          fetchQuotaData({ force: true });
        }, 3000);
      } else if (curGen !== null && lastGenIdx === null) {
        lastGenIdx = curGen;
      }
    }, 2000);

    pollTimer = setInterval(() => {
      if (!disposed && !document.hidden) {
        fetchQuotaData({ force: true });
      }
    }, 60000);

    if (Array.isArray(window.__ag_cleanup_fns)) {
      window.__ag_cleanup_fns.push(() => {
        disposed = true;
        if (syncTimer) clearInterval(syncTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (genDebounceTimer) clearTimeout(genDebounceTimer);
        if (showTimer) clearTimeout(showTimer);
        if (hideTimer) clearTimeout(hideTimer);
        document.removeEventListener('click', onDocClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        cleanupQuotaBarDom();
      });
    }
  }
