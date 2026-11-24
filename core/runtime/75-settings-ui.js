/**
 * Part 75: Embedded Native Codex Settings Panel (inside Antigravity Settings Modal)
 * Mounts a native-style "Codex 主题" tab into [data-testid="settings-sidebar"],
 * persists changes to user/config.json via CDP bindings with ~200ms hot-reload,
 * and provides a 2-level popover cascading model picker populated from `agy models`.
 */
  const AG_SETTINGS_FALLBACK_FAMILIES = [
    {
      key: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      recommended: true,
      defaultEffort: 'Low',
      efforts: [
        { label: 'Low', id: 'gemini-3.8-flash-low' },
        { label: 'Medium', id: 'gemini-3.8-flash-medium' },
        { label: 'High', id: 'gemini-3.8-flash-high' }
      ]
    },
    {
      key: 'gemini-4-neon',
      name: 'Gemini 4 Neon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-neon-low' },
        { label: 'Medium', id: 'gemini-4-neon-medium' },
        { label: 'High', id: 'gemini-4-neon-high' },
        { label: 'Extra High', id: 'gemini-4-neon-xhigh' }
      ]
    },
    {
      key: 'gemini-4-carbon',
      name: 'Gemini 4 Carbon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-carbon-low' },
        { label: 'Medium', id: 'gemini-4-carbon-medium' },
        { label: 'High', id: 'gemini-4-carbon-high' }
      ]
    },
    {
      key: 'gemini-4-argon',
      name: 'Gemini 4 Argon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-argon-low' },
        { label: 'Medium', id: 'gemini-4-argon-medium' },
        { label: 'High', id: 'gemini-4-argon-high' }
      ]
    },
    {
      key: 'gemini-4-hydrogen',
      name: 'Gemini 4 Hydrogen',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-hydrogen-low' },
        { label: 'Medium', id: 'gemini-4-hydrogen-medium' },
        { label: 'High', id: 'gemini-4-hydrogen-high' },
        { label: 'Extra High', id: 'gemini-4-hydrogen-xhigh' }
      ]
    },
    {
      key: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'claude-opus-5-5-low' },
        { label: 'Medium', id: 'claude-opus-5-5-medium' },
        { label: 'High', id: 'claude-opus-5-5-high' }
      ]
    },
    {
      key: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'claude-sonnet-5-5-low' },
        { label: 'Medium', id: 'claude-sonnet-5-5-medium' },
        { label: 'High', id: 'claude-sonnet-5-5-high' }
      ]
    },
    {
      key: 'gpt-oss-120b',
      name: 'GPT-OSS 120B (Medium)',
      recommended: false,
      singleId: 'gpt-oss-120b-medium',
      efforts: []
    }
  ];

  function cleanupCodexSettingsDom() {
    try {
      for (const id of [
        'ag-settings-nav-divider',
        'ag-settings-nav-wrap',
        'ag-settings-stats-nav-wrap',
        'ag-settings-pane',
        'ag-stats-pane',
        'ag-settings-model-menu',
        'ag-settings-effort-menu'
      ]) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
      document.querySelectorAll('[data-ag-codex-settings-open]').forEach((el) => {
        el.removeAttribute('data-ag-codex-settings-open');
      });
      document.querySelectorAll('[data-ag-settings-right-pane]').forEach((el) => {
        el.removeAttribute('data-ag-settings-right-pane');
      });
    } catch {}
  }

  function mountCodexSettingsUi() {
    if (IS_SWARM_PLUGIN_FRAME || !ENABLED) {
      cleanupCodexSettingsDom();
      return;
    }
    if (typeof document === 'undefined' || !document.body) return;

    (function initCodexSettingsUi() {
      const VALID_HOST_RE = /^[a-zA-Z0-9_@][a-zA-Z0-9._:@-]{0,127}$/;
      const SUPPORTS_POPOVER =
        typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
      const SUPPORTS_FOCUSGROUP =
        typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
      const SUPPORTS_IMPLICIT_ANCHOR =
        SUPPORTS_POPOVER &&
        typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('position-area: block-end') &&
        typeof ToggleEvent !== 'undefined' &&
        'source' in ToggleEvent.prototype;

      let disposed = false;
      let reqSeq = 0;
      const pendingReqs = new Map();
      let scanTimer = null;
      let statusPollTimer = null;
      let saveBadgeTimer = null;
      let hoverSwitchTimer = null;
      let lastSubAnchorBtn = null;
      let hoveredFamilyKey = '';
      let addingHost = false;
      let invalidHost = false;
      let refreshingModels = false;
      let refreshingAll = false;
      let statsLoading = false;
      let statsRange = window.__ag_global_stats_range || 'all';
      let activeDlg = null;
      let activeSidebar = null;
      let boundSidebarClick = null;

      const DEFAULT_QUOTA_BAR_UI = {
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
      };

      const bootUserCfg = boot.userConfig && typeof boot.userConfig === 'object' ? boot.userConfig : {};
      const uiState = {
        config: {
          telemetryLayout: bootUserCfg.telemetryLayout || boot.telemetryLayout || 'compact',
          telemetryCacheMode: bootUserCfg.telemetryCacheMode || boot.telemetryCacheMode || 'session',
          telemetryDefaultExpanded: Boolean(
            bootUserCfg.telemetryDefaultExpanded ?? boot.telemetryDefaultExpanded
          ),
          promptSuggestionModel: bootUserCfg.promptSuggestionModel || 'gemini-3.8-flash-low',
          sshHosts: Array.isArray(bootUserCfg.sshHosts) ? bootUserCfg.sshHosts.slice() : [],
          modules: Object.assign({}, MODULES, bootUserCfg.modules || {}),
          quotaBar: Object.assign({}, DEFAULT_QUOTA_BAR_UI, bootUserCfg.quotaBar || boot.quotaBar || {})
        },
        agyStatus: (window.__ag_settings_agy_cache && Object.assign({}, window.__ag_settings_agy_cache)) || {
          available: true,
          running: false,
          starting: false,
          ready: false,
          warmed: false,
          activeModel: ''
        },
        families:
          Array.isArray(window.__ag_settings_models_cache) && window.__ag_settings_models_cache.length > 0
            ? window.__ag_settings_models_cache
            : AG_SETTINGS_FALLBACK_FAMILIES,
        update: (window.__ag_settings_update_cache && Object.assign({}, window.__ag_settings_update_cache)) || {
          phase: 'idle',
          status: 'idle',
          currentVersion: '',
          latestVersion: '',
          updateAvailable: false,
          canSyncMain: false,
          changedCount: 0,
          targetRef: 'main',
          error: ''
        }
      };

      function getShortVersionTag() {
        const m = String(PATCH_VERSION || '').match(/^(\d+\.\d+(?:\.\d+)?)/);
        return m ? 'v' + m[1] : 'v1.2';
      }

      function isZhUi() {
        return Boolean(uiState.config.modules.i18n);
      }

      function getStrings() {
        if (isZhUi()) {
          return {
            navTitle: 'Codex 主题',
            pageTitle: 'Codex 主题',
            manualRefreshLabel: '手动刷新主题与配置',
            savedBadge: '已同步',
            refreshedBadge: '已刷新',
            githubLabel: 'GitHub',
            feedbackLabel: '反馈',
            subtitlePrefix: '管理主题配色、中文界面、会话统计与可选增强模块，修改实时同步至 ',
            subtitleSuffix: '。',
            secCore: '核心模块',
            modTheme: 'Codex 昼夜主题',
            modThemeDesc: '浅色纯白与中性炭灰深色配色，随 IDE 外观自动切换',
            modI18n: '中文界面汉化',
            modI18nDesc: '内置 1,900+ 界面词条，原地更新不影响交互，关闭即恢复英文',
            modMetrics: '实时会话状态与用量统计',
            modMetricsDesc: '底部四态状态指示、一/二级明细面板与每轮对话尾部统计',
            modQuotaBar: 'Antigravity 配额用量栏',
            modQuotaBarDesc: '在底部状态栏常驻显示 5 小时 / 每周配额进度，悬停或点击查看全部分组明细',
            secQuota: 'Antigravity 用量栏样式',
            secQuotaHint: '实时热重载',
            qPreviewLbl: '实时样式预览',
            qStyleLbl: '显示样式',
            qStyleDesc: '选择纯文本、迷你进度条或胶囊标签展示配额',
            qStyleText: '纯文本',
            qStyleBar: '进度条',
            qStylePill: '胶囊',
            qPlaceLbl: '显示位置',
            qPlaceDesc: '嵌入底部状态栏同行，或在下方单独占一行',
            qPlaceInline: '状态栏同行',
            qPlaceSeparate: '底部独立行',
            qScopeLbl: '显示范围',
            qScopeDesc: '仅显示当前选中模型所属分组，或同时显示全部分组',
            qScopeCurrent: '当前模型组',
            qScopeAll: '全部分组',
            qWinLbl: '配额周期',
            qWinDesc: '选择显示 5 小时限额、每周限额或两者同时显示',
            qWinBoth: '5h + 每周',
            qWin5h: '仅 5h',
            qWinWeekly: '仅每周',
            qThemeLbl: '配色方案',
            qThemeDesc: '智能语义随余量变色，或使用极简单色、强调色与自定义颜色',
            qThemeAuto: '智能语义',
            qThemeMono: '极简单色',
            qThemeAccent: '强调色',
            qThemeCustom: '自定义',
            qCustomFg: '前景/进度色',
            qCustomBg: '胶囊背景',
            qCustomClear: '恢复默认',
            qSizeLbl: '字号大小',
            qSizeSm: '小',
            qSizeMd: '中',
            qSizeLg: '大',
            qAlignLbl: '对齐方式',
            qAlignLeft: '左对齐',
            qAlignCenter: '居中',
            qAlignRight: '右对齐',
            qAlignBetween: '两端分散',
            qShowResetLbl: '显示重置倒计时',
            qShowCreditsLbl: '底部栏显示 AI 点数',
            secOptional: '可选增强',
            secOptionalHint: '默认关闭，按需开启',
            modSuggest: '输入框下一句预测',
            modSuggestDescPre: '回复结束后预测下一句指令，按 ',
            modSuggestDescMid: ' 或 ',
            modSuggestDescPost: ' 补全（开启后后台常驻 ',
            modSuggestDescEnd: ' 进程）',
            agyIdle: '未启动',
            agyWarming: '预热中…',
            agyReady: 'agy 就绪',
            agyMissing: '未检测到 agy',
            suggestModelLbl: '预测模型',
            suggestModelDescPre: '由 ',
            suggestModelDescPost: ' 自动按模型与档位分组，推荐 Gemini 3.8 Flash Low',
            refreshModelsTitle: '重新拉取 agy models',
            menuModelsHdr: '模型',
            recommendedBadge: '推荐',
            modSsh: 'SSH Remote 远端只读统计',
            modSshDesc: '通过远端只读 Python 提取脱敏数值元数据，不在本地拷贝 .db 文件',
            sshHostsLbl: '允许探测的主机（sshHosts）',
            addHostBtn: '+ 添加主机',
            addHostPlaceholder: '如 node032',
            addHostOk: '添加',
            secTelemetry: '状态栏偏好',
            layoutLbl: '底部状态栏密度',
            layoutDesc: '紧凑模式居中嵌在工具栏内；详细模式展开为底部居中独立行，补充 TTFT 与本步输出',
            layoutCompact: '紧凑',
            layoutDetailed: '详细',
            cacheLbl: '缓存命中率口径',
            cacheDesc: '选择状态栏展示整个会话的累计命中率，或最近单步命中率',
            cacheSession: '会话累计',
            cacheStep: '单步',
            defaultExpandLbl: '明细面板默认展开',
            defaultExpandDesc: '悬停或点击底部统计栏时，默认直接展开全部明细（耗时、输出与会话累计）',
            defaultExpandOff: '默认收起',
            defaultExpandOn: '默认展开',
            secUpdate: '版本与更新',
            updTitle: '插件版本',
            updDescIdle: '从 GitHub 仓库检查新版本并直接更新，保留 user/ 个人配置',
            updDescChecking: '正在连接 GitHub 检查最新版本与文件清单…',
            updDescUpToDate: '当前已与远端最新版本保持一致',
            updDescAhead: '当前本地版本高于远端发布版本',
            updDescAvailable: '发现新版本，点击直接更新并热重载生效，无需重启 Antigravity',
            updDescMainDiff: '远端 main 分支有文件差异（含热修复或本地未推送改动），可一键同步最新 main',
            updDescUpdating: '正在下载并校验更新文件，同时备份旧版本，请稍候…',
            updDescApplied: '已更新完成，后台服务正在重启并热重载到当前窗口…',
            updPillChecking: '检查中…',
            updPillLatest: '已是最新',
            updPillAhead: '本地领先',
            updPillAvailablePrefix: '新版本 ',
            updPillMainDiff: 'main 有差异',
            updPillUpdating: '更新中…',
            updPillApplied: '更新完成',
            updPillErr: '检查失败',
            updBtnCheck: '检查更新',
            updBtnChecking: '检查中…',
            updBtnApply: '立即更新',
            updBtnSyncMain: '同步 main',
            updBtnUpdating: '更新中…'
          };
        }
        return {
          navTitle: 'Codex Theme',
          pageTitle: 'Codex Theme',
          manualRefreshLabel: 'Reload theme & config',
          savedBadge: 'Synced',
          refreshedBadge: 'Refreshed',
          githubLabel: 'GitHub',
          feedbackLabel: 'Feedback',
          subtitlePrefix: 'Manage theme colors, localization, live telemetry, and opt-in modules. Changes sync directly to ',
          subtitleSuffix: '.',
          secCore: 'Core Modules',
          modTheme: 'Codex Light & Dark Theme',
          modThemeDesc: 'Pure white light and charcoal dark palettes that follow IDE appearance automatically',
          modI18n: 'Chinese UI Localization',
          modI18nDesc: '1,900+ built-in UI entries applied in place; disable to restore English immediately',
          modMetrics: 'Live Session Status & Telemetry',
          modMetricsDesc: 'Bottom 4-state status indicator, expandable L1/L2 panels, and per-turn footer stats',
          modQuotaBar: 'Antigravity Quota Bar',
          modQuotaBarDesc: 'Always-visible 5-hour / weekly model quota bar in the bottom bar with hover/click details',
          secQuota: 'Quota Bar Appearance',
          secQuotaHint: 'Live hot-reload',
          qPreviewLbl: 'Live Preview',
          qStyleLbl: 'Display Style',
          qStyleDesc: 'Render quota as plain text, mini progress bar, or capsule pill',
          qStyleText: 'Text',
          qStyleBar: 'Bar',
          qStylePill: 'Pill',
          qPlaceLbl: 'Placement',
          qPlaceDesc: 'Sit inline with the bottom telemetry bar or on its own dedicated bottom row',
          qPlaceInline: 'Inline',
          qPlaceSeparate: 'Separate Row',
          qScopeLbl: 'Group Scope',
          qScopeDesc: 'Show only the active model group or all quota groups',
          qScopeCurrent: 'Active Group',
          qScopeAll: 'All Groups',
          qWinLbl: 'Quota Windows',
          qWinDesc: 'Display both 5h and weekly limits or a single window',
          qWinBoth: '5h + Weekly',
          qWin5h: '5h Only',
          qWinWeekly: 'Weekly Only',
          qThemeLbl: 'Color Theme',
          qThemeDesc: 'Semantic colors by remaining quota, monochrome, Codex accent, or custom colors',
          qThemeAuto: 'Semantic',
          qThemeMono: 'Mono',
          qThemeAccent: 'Accent',
          qThemeCustom: 'Custom',
          qCustomFg: 'Accent Color',
          qCustomBg: 'Pill Background',
          qCustomClear: 'Reset',
          qSizeLbl: 'Size',
          qSizeSm: 'Small',
          qSizeMd: 'Medium',
          qSizeLg: 'Large',
          qAlignLbl: 'Alignment',
          qAlignLeft: 'Left',
          qAlignCenter: 'Center',
          qAlignRight: 'Right',
          qAlignBetween: 'Space Between',
          qShowResetLbl: 'Show Reset Countdown',
          qShowCreditsLbl: 'Show AI Credits in Bar',
          secOptional: 'Optional Enhancements',
          secOptionalHint: 'Off by default, opt-in',
          modSuggest: 'Prompt Suggestions',
          modSuggestDescPre: 'Predicts the next prompt after each turn; press ',
          modSuggestDescMid: ' or ',
          modSuggestDescPost: ' to accept (runs a background ',
          modSuggestDescEnd: ' worker when enabled)',
          agyIdle: 'Stopped',
          agyWarming: 'Warming up…',
          agyReady: 'agy Ready',
          agyMissing: 'agy not found',
          suggestModelLbl: 'Suggestion Model',
          suggestModelDescPre: 'Grouped automatically from ',
          suggestModelDescPost: '; Gemini 3.8 Flash Low recommended',
          refreshModelsTitle: 'Refresh agy models',
          menuModelsHdr: 'Models',
          recommendedBadge: 'Rec',
          modSsh: 'SSH Remote Read-Only Telemetry',
          modSshDesc: 'Extracts sanitized numeric metadata via remote read-only Python with zero local .db copy',
          sshHostsLbl: 'Allowed SSH Hosts (sshHosts)',
          addHostBtn: '+ Add host',
          addHostPlaceholder: 'e.g. node032',
          addHostOk: 'Add',
          secTelemetry: 'Status Bar Preferences',
          layoutLbl: 'Status Bar Density',
          layoutDesc: 'Compact sits centered inline; Detailed expands to a centered bottom row with TTFT and step output',
          layoutCompact: 'Compact',
          layoutDetailed: 'Detailed',
          cacheLbl: 'Cache Hit Rate Scope',
          cacheDesc: 'Display cumulative session cache hit rate or last-step hit rate',
          cacheSession: 'Session',
          cacheStep: 'Step',
          defaultExpandLbl: 'Expand Details by Default',
          defaultExpandDesc: 'Automatically show the full L2 breakdown (latency, output & session totals) on hover or click',
          defaultExpandOff: 'Collapsed',
          defaultExpandOn: 'Expanded',
          secUpdate: 'Updates',
          updTitle: 'Plugin Version',
          updDescIdle: 'Check GitHub for updates and apply directly; user/ config is preserved',
          updDescChecking: 'Checking GitHub for the latest release and manifest…',
          updDescUpToDate: 'You are running the latest version',
          updDescAhead: 'Local build is ahead of remote release',
          updDescAvailable: 'A newer release is available; updates apply live without restarting Antigravity',
          updDescMainDiff: 'Remote main branch differs (hotfix or local changes); click Sync main to pull latest',
          updDescUpdating: 'Downloading and verifying update files while backing up previous version…',
          updDescApplied: 'Update applied; restarting background daemon to hot-reload this window…',
          updPillChecking: 'Checking…',
          updPillLatest: 'Up to date',
          updPillAhead: 'Local ahead',
          updPillAvailablePrefix: 'New ',
          updPillMainDiff: 'main differs',
          updPillUpdating: 'Updating…',
          updPillApplied: 'Updated',
          updPillErr: 'Failed',
          updBtnCheck: 'Check for Updates',
          updBtnChecking: 'Checking…',
          updBtnApply: 'Update Now',
          updBtnSyncMain: 'Sync main',
          updBtnUpdating: 'Updating…'
        };
      }

      function escHtml(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function findSelectedModelInfo(modelId) {
        const families = uiState.families || AG_SETTINGS_FALLBACK_FAMILIES;
        for (let i = 0; i < families.length; i++) {
          const fam = families[i];
          if (fam.singleId === modelId) {
            return { family: fam, effortLabel: '' };
          }
          if (Array.isArray(fam.efforts)) {
            for (let j = 0; j < fam.efforts.length; j++) {
              if (fam.efforts[j].id === modelId) {
                return { family: fam, effortLabel: fam.efforts[j].label };
              }
            }
          }
        }
        return {
          family: { key: '', name: modelId || 'Gemini 3.8 Flash', efforts: [] },
          effortLabel: ''
        };
      }

      function callDaemonBinding(bindingName, payloadObj, timeoutMs = 15000) {
        return new Promise((resolve) => {
          const fn = window[bindingName];
          if (typeof fn !== 'function') return resolve(null);
          reqSeq += 1;
          const reqId = `cfg-${Date.now()}-${reqSeq}`;
          const timer = setTimeout(() => {
            pendingReqs.delete(reqId);
            resolve(null);
          }, timeoutMs);
          pendingReqs.set(reqId, (res) => {
            clearTimeout(timer);
            resolve(res);
          });
          try {
            fn(JSON.stringify(Object.assign({ reqId }, payloadObj || {})));
          } catch {
            clearTimeout(timer);
            pendingReqs.delete(reqId);
            resolve(null);
          }
        });
      }

      window.__ag_on_settings_state = (reqId, payload) => {
        if (disposed) return;
        const cb = pendingReqs.get(reqId);
        if (cb) {
          pendingReqs.delete(reqId);
          cb(payload);
        }
      };

      function applyRemoteState(res, flashSaved) {
        if (!res || !res.ok) return;
        if (res.config) {
          uiState.config = {
            telemetryLayout: res.config.telemetryLayout || uiState.config.telemetryLayout,
            telemetryCacheMode: res.config.telemetryCacheMode || uiState.config.telemetryCacheMode,
            telemetryDefaultExpanded:
              typeof res.config.telemetryDefaultExpanded === 'boolean'
                ? res.config.telemetryDefaultExpanded
                : uiState.config.telemetryDefaultExpanded,
            promptSuggestionModel: res.config.promptSuggestionModel || uiState.config.promptSuggestionModel,
            sshHosts: Array.isArray(res.config.sshHosts) ? res.config.sshHosts.slice() : uiState.config.sshHosts,
            modules: Object.assign({}, uiState.config.modules, res.config.modules || {}),
            quotaBar: Object.assign({}, DEFAULT_QUOTA_BAR_UI, uiState.config.quotaBar || {}, res.config.quotaBar || {})
          };
        }
        if (res.agyStatus) {
          uiState.agyStatus = Object.assign({}, res.agyStatus);
          window.__ag_settings_agy_cache = Object.assign({}, res.agyStatus);
        }
        if (res.modelsInfo && Array.isArray(res.modelsInfo.families) && res.modelsInfo.families.length > 0) {
          uiState.families = res.modelsInfo.families;
          window.__ag_settings_models_cache = res.modelsInfo.families;
        }
        if (flashSaved) {
          window.__ag_settings_saved_label = flashSaved === 'refreshed' ? 'refreshed' : 'saved';
          window.__ag_settings_saved_until = Date.now() + 1800;
        }
        renderPane();
        syncStatusPoller();
      }

      async function fetchSettingsState({ includeModels = false, refreshModels = false, forceReload = false } = {}) {
        if (forceReload) {
          refreshingAll = true;
          window.__ag_settings_saved_label = 'refreshed';
          window.__ag_settings_saved_until = Date.now() + 2400;
          const paneEl = document.getElementById('ag-settings-pane');
          if (paneEl) window.__ag_settings_scroll_top = paneEl.scrollTop;
          updateRefreshSpin();
        }
        if (refreshModels) {
          refreshingModels = true;
          updateRefreshSpin();
        }
        const res = await callDaemonBinding('__agGetSettingsState', { includeModels, refreshModels, forceReload });
        if (forceReload) {
          refreshingAll = false;
          updateRefreshSpin();
        }
        if (refreshModels) {
          refreshingModels = false;
          updateRefreshSpin();
        }
        if (!disposed && res) {
          applyRemoteState(res, forceReload ? 'refreshed' : false);
        }
      }

      function fmtStatsTok(n) {
        if (!n || n <= 0) return '0';
        if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B';
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 10000) return Math.round(n / 1000) + 'k';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
      }

      function fmtStatsNum(n) {
        return Number(n || 0).toLocaleString('en-US');
      }

      async function fetchGlobalStats({ range = statsRange, force = false } = {}) {
        statsRange = range;
        window.__ag_global_stats_range = range;
        statsLoading = true;
        renderStatsPane();
        const res = await callDaemonBinding('__agGetGlobalStats', { range, force }, 20000);
        statsLoading = false;
        if (disposed) return;
        if (res && res.ok) {
          window.__ag_global_stats_cache = res;
        }
        renderStatsPane();
      }

      function renderStatsPane() {
        const navBtn = document.getElementById('ag-settings-stats-nav-btn');
        if (navBtn) {
          const lbl = navBtn.querySelector('.ag-s-nav-label');
          if (lbl) lbl.textContent = isZhUi() ? '用量统计' : 'Token Usage';
        }
        const pane = document.getElementById('ag-stats-pane');
        if (!pane) return;

        const zh = isZhUi();
        const data = window.__ag_global_stats_cache;
        const hasValidData = Boolean(data && data.ok && data.range === statsRange);
        const curRange = statsRange;

        const rangeBtns = [
          ['today', zh ? '今日' : 'Today'],
          ['7d', zh ? '近 7 天' : '7 Days'],
          ['30d', zh ? '近 30 天' : '30 Days'],
          ['all', zh ? '全部' : 'All']
        ]
          .map(
            ([val, label]) =>
              '<button type="button" class="ag-s-seg-btn" data-stats-range="' +
              val +
              '" aria-pressed="' +
              (curRange === val ? 'true' : 'false') +
              '">' +
              escHtml(label) +
              '</button>'
          )
          .join('');

        let bodyHtml = '';
        if (statsLoading && !hasValidData) {
          bodyHtml = '<div class="ag-st-card"><div class="ag-st-empty">' + (zh ? '正在汇总全部会话 SQLite 数据…' : 'Aggregating all conversation databases…') + '</div></div>';
        } else if (!data || !data.ok) {
          bodyHtml = '<div class="ag-st-card"><div class="ag-st-empty">' + escHtml((data && data.error) || (zh ? '暂无可用统计数据' : 'No usage data available')) + '</div></div>';
        } else if (data.totalGenerations === 0) {
          bodyHtml = '<div class="ag-st-card"><div class="ag-st-empty">' + (zh ? '当前时间范围内暂无 Token 消耗记录' : 'No token usage recorded in this time range') + '</div></div>';
        } else {
          const tot = Math.max(1, data.totalTokens);
          const segPct = (v) => (v > 0 ? Math.max(1.2, (v / tot) * 100).toFixed(1) : '0');
          const segs = [
            data.totalIn > 0 ? '<div class="ag-st-seg ag-st-c-in" style="width:' + segPct(data.totalIn) + '%"></div>' : '',
            data.totalCacheWrite > 0 ? '<div class="ag-st-seg ag-st-c-cw" style="width:' + segPct(data.totalCacheWrite) + '%"></div>' : '',
            data.totalCacheRead > 0 ? '<div class="ag-st-seg ag-st-c-cr" style="width:' + segPct(data.totalCacheRead) + '%"></div>' : '',
            data.totalThink > 0 ? '<div class="ag-st-seg ag-st-c-th" style="width:' + segPct(data.totalThink) + '%"></div>' : '',
            data.totalResp > 0 ? '<div class="ag-st-seg ag-st-c-re" style="width:' + segPct(data.totalResp) + '%"></div>' : ''
          ].join('');

          const maxDaily = Math.max(1, ...(data.daily || []).map((d) => d.totalTokens || 0));
          const dailyCols = (data.daily || [])
            .map((d) => {
              const hPct = d.totalTokens > 0 ? Math.max(6, Math.round((d.totalTokens / maxDaily) * 100)) : 4;
              const titleStr = d.iso + ': ' + fmtStatsTok(d.totalTokens) + ' (' + d.gens + (zh ? ' 次)' : ' calls)');
              return (
                '<div class="ag-st-day-col" title="' +
                escHtml(titleStr) +
                '">' +
                '<div class="ag-st-day-bar-wrap"><div class="ag-st-day-bar' +
                (d.totalTokens === 0 ? ' is-empty' : '') +
                '" style="height:' +
                hPct +
                '%"></div></div>' +
                '<span class="ag-st-day-lbl">' +
                escHtml(d.date) +
                '</span>' +
                '</div>'
              );
            })
            .join('');

          const modelsHtml = (data.models || [])
            .map((m) => {
              return (
                '<div class="ag-st-model-item">' +
                '<div class="ag-st-model-top">' +
                '<span class="ag-st-model-name">' +
                escHtml(m.name) +
                '</span>' +
                '<span class="ag-st-model-val">' +
                fmtStatsTok(m.totalTokens) +
                ' (' +
                m.sharePct +
                '%)</span>' +
                '</div>' +
                '<div class="ag-st-model-track"><div class="ag-st-model-fill" style="width:' +
                Math.max(2, Math.min(100, m.sharePct)) +
                '%"></div></div>' +
                '<div class="ag-st-model-sub">' +
                m.gens +
                (zh ? ' 次调用 · 新增 ' : ' calls · In ') +
                fmtStatsTok(m.inTok) +
                (zh ? ' · 缓存 ' : ' · Cache ') +
                fmtStatsTok(m.cacheRead) +
                (zh ? ' · 输出 ' : ' · Out ') +
                fmtStatsTok(m.outTok) +
                '</div>' +
                '</div>'
              );
            })
            .join('');

          const convsHtml = (data.topConversations || [])
            .map((c) => {
              const dtStr = c.lastTsMs
                ? new Date(c.lastTsMs).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                '<div class="ag-st-conv-row">' +
                '<div>' +
                '<div class="ag-st-conv-id">' +
                escHtml(c.shortId) +
                '…</div>' +
                '<div class="ag-st-conv-sub">' +
                escHtml(dtStr) +
                ' · ' +
                c.gens +
                (zh ? ' 次调用 · 缓存命中 ' : ' calls · Cache ') +
                c.cacheHitRate +
                '%</div>' +
                '</div>' +
                '<div class="ag-st-conv-right">' +
                fmtStatsTok(c.totalTokens) +
                '<div class="ag-st-conv-sub">' +
                (zh ? '输出 ' : 'Out ') +
                fmtStatsTok(c.outTok) +
                '</div></div>' +
                '</div>'
              );
            })
            .join('');

          bodyHtml =
            '<div class="ag-st-kpi-grid">' +
            '<div class="ag-st-kpi"><div class="ag-st-kpi-lbl">' +
            (zh ? '总 Token 消耗' : 'Total Tokens') +
            '</div><div class="ag-st-kpi-val">' +
            fmtStatsTok(data.totalTokens) +
            '</div><div class="ag-st-kpi-sub">' +
            data.activeConversations +
            (zh ? ' 个会话 · ' : ' chats · ') +
            fmtStatsNum(data.totalGenerations) +
            (zh ? ' 次' : ' calls') +
            '</div></div>' +
            '<div class="ag-st-kpi"><div class="ag-st-kpi-lbl">' +
            (zh ? '累计输入' : 'Total Input') +
            '</div><div class="ag-st-kpi-val">' +
            fmtStatsTok(data.totalPrompt) +
            '</div><div class="ag-st-kpi-sub">' +
            (zh ? '新增 ' : 'New ') +
            fmtStatsTok(data.totalIn) +
            (zh ? ' · 缓存 ' : ' · Cache ') +
            fmtStatsTok(data.totalCacheRead) +
            '</div></div>' +
            '<div class="ag-st-kpi"><div class="ag-st-kpi-lbl">' +
            (zh ? '累计输出' : 'Total Output') +
            '</div><div class="ag-st-kpi-val">' +
            fmtStatsTok(data.totalOut) +
            '</div><div class="ag-st-kpi-sub">' +
            (zh ? '思考 ' : 'Think ') +
            fmtStatsTok(data.totalThink) +
            (zh ? ' · 正文 ' : ' · Resp ') +
            fmtStatsTok(data.totalResp) +
            '</div></div>' +
            '<div class="ag-st-kpi"><div class="ag-st-kpi-lbl">' +
            (zh ? '平均缓存命中率' : 'Cache Hit Rate') +
            '</div><div class="ag-st-kpi-val is-ok">' +
            data.cacheHitRate +
            '%</div><div class="ag-st-kpi-sub">' +
            (zh ? '已命中 ' : 'Hit ') +
            fmtStatsTok(data.totalCacheRead) +
            '</div></div>' +
            '</div>' +
            '<div class="ag-st-card">' +
            '<div class="ag-st-card-hdr"><span class="ag-st-card-title">' +
            (zh ? 'Token 构成分布' : 'Token Composition') +
            '</span><span class="ag-st-card-meta">' +
            fmtStatsNum(data.totalTokens) +
            '</span></div>' +
            '<div class="ag-st-stack-bar">' +
            segs +
            '</div>' +
            '<div class="ag-st-legend">' +
            '<span class="ag-st-leg"><span class="ag-st-dot ag-st-c-in"></span>' +
            (zh ? '新增输入 ' : 'New Input ') +
            fmtStatsTok(data.totalIn) +
            '</span>' +
            (data.totalCacheWrite > 0
              ? '<span class="ag-st-leg"><span class="ag-st-dot ag-st-c-cw"></span>' + (zh ? '写缓存 ' : 'Cache Write ') + fmtStatsTok(data.totalCacheWrite) + '</span>'
              : '') +
            '<span class="ag-st-leg"><span class="ag-st-dot ag-st-c-cr"></span>' +
            (zh ? '缓存读取 ' : 'Cache Read ') +
            fmtStatsTok(data.totalCacheRead) +
            '</span>' +
            '<span class="ag-st-leg"><span class="ag-st-dot ag-st-c-th"></span>' +
            (zh ? '思考链 ' : 'Thinking ') +
            fmtStatsTok(data.totalThink) +
            '</span>' +
            '<span class="ag-st-leg"><span class="ag-st-dot ag-st-c-re"></span>' +
            (zh ? '正文/工具 ' : 'Response ') +
            fmtStatsTok(data.totalResp) +
            '</span>' +
            '</div>' +
            '</div>' +
            '<div class="ag-st-card">' +
            '<div class="ag-st-card-hdr"><span class="ag-st-card-title">' +
            (zh ? '近期每日消耗趋势' : 'Daily Token Trend') +
            '</span><span class="ag-st-card-meta">' +
            (data.daily ? data.daily.length : 0) +
            (zh ? ' 天' : 'd') +
            '</span></div>' +
            '<div class="ag-st-daily-chart">' +
            dailyCols +
            '</div>' +
            '</div>' +
            '<div class="ag-st-card">' +
            '<div class="ag-st-card-hdr"><span class="ag-st-card-title">' +
            (zh ? '按模型用量分布' : 'Usage by Model') +
            '</span><span class="ag-st-card-meta">' +
            (data.models ? data.models.length : 0) +
            (zh ? ' 个模型' : ' models') +
            '</span></div>' +
            '<div class="ag-st-model-list">' +
            modelsHtml +
            '</div>' +
            '</div>' +
            '<div class="ag-st-card">' +
            '<div class="ag-st-card-hdr"><span class="ag-st-card-title">' +
            (zh ? '高消耗会话 Top 5' : 'Top 5 Conversations') +
            '</span><span class="ag-st-card-meta">' +
            (zh ? '本地共 ' : 'Total ') +
            data.scannedFiles +
            (zh ? ' 个库' : ' DBs') +
            '</span></div>' +
            '<div class="ag-st-conv-list">' +
            convsHtml +
            '</div>' +
            '</div>';
        }

        pane.innerHTML =
          '<div class="ag-st-wrap">' +
          '<div class="ag-st-hdr">' +
          '<div>' +
          '<div class="ag-st-title-row">' +
          '<h2 class="ag-st-title">' +
          (zh ? '全部会话 Token 用量' : 'All-Session Token Usage') +
          '</h2>' +
          '<button type="button" id="ag-stats-refresh" class="ag-st-refresh' +
          (statsLoading ? ' is-spinning' : '') +
          '" aria-label="' +
          (zh ? '刷新统计' : 'Refresh stats') +
          '">' +
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
          '</button>' +
          '</div>' +
          '<p class="ag-st-subtitle">' +
          (zh ? '汇总本机全部历史与当前会话的 SQLite 用量记录（含缓存读取、思考与正文输出）' : 'Aggregated across all local conversation SQLite databases') +
          '</p>' +
          '</div>' +
          '<div class="ag-s-seg" role="group">' +
          rangeBtns +
          '</div>' +
          '</div>' +
          bodyHtml +
          '</div>';
      }

      async function checkPluginUpdate() {
        if (uiState.update.phase === 'checking' || uiState.update.phase === 'updating') return;
        uiState.update = Object.assign({}, uiState.update, { phase: 'checking', error: '' });
        window.__ag_settings_update_cache = Object.assign({}, uiState.update);
        renderPane();

        const res = await callDaemonBinding('__agCheckPluginUpdate', {}, 20000);
        if (disposed) return;
        if (!res || !res.ok) {
          uiState.update = Object.assign({}, uiState.update, {
            phase: 'done',
            status: 'error',
            updateAvailable: false,
            canSyncMain: false,
            error: (res && res.error) || 'Network error'
          });
        } else {
          uiState.update = {
            phase: 'done',
            status: res.status || 'up_to_date',
            currentVersion: res.currentVersion || '',
            latestVersion: res.latestVersion || '',
            updateAvailable: Boolean(res.updateAvailable),
            canSyncMain: Boolean(res.canSyncMain),
            changedCount: Number(res.changedCount || 0),
            targetRef: res.targetRef || 'main',
            error: ''
          };
        }
        window.__ag_settings_update_cache = Object.assign({}, uiState.update);
        renderPane();
      }

      async function applyPluginUpdateAction() {
        if (uiState.update.phase === 'updating' || uiState.update.phase === 'checking') return;
        const ref = uiState.update.targetRef || 'main';
        uiState.update = Object.assign({}, uiState.update, { phase: 'updating', error: '' });
        window.__ag_settings_update_cache = Object.assign({}, uiState.update);
        const paneEl = document.getElementById('ag-settings-pane');
        if (paneEl) window.__ag_settings_scroll_top = paneEl.scrollTop;
        renderPane();

        const res = await callDaemonBinding('__agApplyPluginUpdate', { ref }, 60000);
        if (disposed) return;
        if (!res || !res.ok) {
          uiState.update = Object.assign({}, uiState.update, {
            phase: 'done',
            status: 'error',
            error: (res && res.error) || 'Update failed'
          });
        } else {
          uiState.update = {
            phase: 'applied',
            status: 'applied',
            currentVersion: res.version || uiState.update.latestVersion,
            latestVersion: res.version || uiState.update.latestVersion,
            updateAvailable: false,
            canSyncMain: false,
            changedCount: 0,
            targetRef: 'main',
            error: ''
          };
          window.__ag_settings_saved_label = 'refreshed';
          window.__ag_settings_saved_until = Date.now() + 3000;
        }
        window.__ag_settings_update_cache = Object.assign({}, uiState.update);
        renderPane();
      }

      async function commitPatch(patch) {
        // Optimistic local state update for snappy UX
        if (patch.modules) {
          Object.assign(uiState.config.modules, patch.modules);
          if (patch.modules.promptSuggestions === false) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, { running: false, ready: false, warmed: false });
          } else if (patch.modules.promptSuggestions === true && uiState.agyStatus.available) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, { running: true, warmed: false });
          }
        }
        if (patch.telemetryLayout) uiState.config.telemetryLayout = patch.telemetryLayout;
        if (patch.telemetryCacheMode) uiState.config.telemetryCacheMode = patch.telemetryCacheMode;
        if (typeof patch.telemetryDefaultExpanded === 'boolean') {
          uiState.config.telemetryDefaultExpanded = patch.telemetryDefaultExpanded;
        }
        if (patch.promptSuggestionModel) {
          uiState.config.promptSuggestionModel = patch.promptSuggestionModel;
          if (uiState.config.modules.promptSuggestions && uiState.agyStatus.available) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, { warmed: false, running: true });
          }
        }
        if (Array.isArray(patch.sshHosts)) {
          uiState.config.sshHosts = patch.sshHosts.slice();
        }
        if (patch.quotaBar && typeof patch.quotaBar === 'object') {
          uiState.config.quotaBar = Object.assign({}, DEFAULT_QUOTA_BAR_UI, uiState.config.quotaBar || {}, patch.quotaBar);
        }
        window.__ag_settings_saved_label = 'saved';
        window.__ag_settings_saved_until = Date.now() + 1800;
        const paneEl = document.getElementById('ag-settings-pane');
        if (paneEl) window.__ag_settings_scroll_top = paneEl.scrollTop;
        renderPane();
        syncStatusPoller();

        const res = await callDaemonBinding('__agUpdateSettings', { patch });
        if (!disposed && res) {
          applyRemoteState(res, true);
        }
      }

      function syncStatusPoller() {
        if (statusPollTimer) {
          clearInterval(statusPollTimer);
          statusPollTimer = null;
        }
        const needPoll =
          Boolean(window.__ag_settings_tab_open) &&
          Boolean(activeDlg && activeDlg.isConnected) &&
          Boolean(uiState.config.modules.promptSuggestions) &&
          uiState.agyStatus.available !== false &&
          !uiState.agyStatus.warmed;
        if (!needPoll) return;
        statusPollTimer = setInterval(() => {
          if (disposed || !window.__ag_settings_tab_open || !activeDlg || !activeDlg.isConnected) {
            syncStatusPoller();
            return;
          }
          fetchSettingsState({ includeModels: false, refreshModels: false });
        }, 1500);
      }

      function updateRefreshSpin() {
        const icon = document.getElementById('ag-s-refresh-icon');
        if (icon) icon.classList.toggle('ag-s-spin', Boolean(refreshingModels));
        const hdrIcon = document.getElementById('ag-s-manual-refresh-icon');
        if (hdrIcon) hdrIcon.classList.toggle('ag-s-spin', Boolean(refreshingAll));
      }

      function hideModelMenus({ restoreFocus = false, fromPointer = false } = {}) {
        // Reset cached submenu anchor whenever menus hide
        lastSubAnchorBtn = null;
        if (hoverSwitchTimer) {
          clearTimeout(hoverSwitchTimer);
          hoverSwitchTimer = null;
        }
        const sub = document.getElementById('ag-settings-effort-menu');
        const root = document.getElementById('ag-settings-model-menu');
        const trigger = document.getElementById('ag-s-model-trigger');
        if (sub) {
          if (SUPPORTS_POPOVER) {
            try {
              if (sub.matches(':popover-open')) sub.hidePopover();
            } catch {}
          } else {
            sub.hidden = true;
          }
        }
        if (root) {
          if (SUPPORTS_POPOVER) {
            try {
              if (root.matches(':popover-open')) root.hidePopover();
            } catch {}
          } else {
            root.hidden = true;
          }
        }
        if (trigger) {
          trigger.setAttribute('aria-expanded', 'false');
          if (restoreFocus) {
            try {
              trigger.focus({ focusVisible: !fromPointer });
            } catch {
              try { trigger.focus(); } catch {}
            }
          }
        }
      }

      function isPopoverOpen(el) {
        if (!el) return false;
        if (SUPPORTS_POPOVER) {
          try {
            return el.matches(':popover-open');
          } catch {
            return false;
          }
        }
        return !el.hidden;
      }

      function positionFixedOverlay(overlayEl, anchorEl, placement) {
        if (!overlayEl || !anchorEl) return;
        overlayEl.setAttribute('data-js-pos', '1');
        const ar = anchorEl.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        const ow = overlayEl.offsetWidth || (placement === 'submenu' ? 172 : 272);
        const oh = overlayEl.offsetHeight || 220;
        let left;
        let top;
        if (placement === 'submenu') {
          const parentBox = (anchorEl.closest && anchorEl.closest('#ag-settings-model-menu')) || anchorEl;
          const pr = parentBox.getBoundingClientRect();
          left = pr.right + 6;
          if (left + ow > vw - 12) {
            left = pr.left - ow - 6;
          }
          if (left < 12) {
            left = Math.max(12, vw - ow - 12);
          }
          top = ar.top - 6;
          if (top + oh > vh - 12) top = vh - oh - 12;
          if (top < 12) top = 12;
        } else {
          left = ar.right - ow;
          if (left < 12) left = Math.max(12, ar.left);
          if (left + ow > vw - 12) left = Math.max(12, vw - ow - 12);
          top = ar.bottom + 6;
          if (top + oh > vh - 12 && ar.top - oh - 6 >= 12) {
            top = ar.top - oh - 6;
          } else if (top + oh > vh - 12) {
            top = Math.max(12, vh - oh - 12);
          }
        }
        overlayEl.style.left = Math.round(left) + 'px';
        overlayEl.style.top = Math.round(top) + 'px';
      }

      function openEffortSubmenu(fam, anchorBtn, { focusFirst = false } = {}) {
        const sub = document.getElementById('ag-settings-effort-menu');
        if (!sub) return;
        if (!fam || !Array.isArray(fam.efforts) || fam.efforts.length === 0) {
          lastSubAnchorBtn = null;
          if (isPopoverOpen(sub)) {
            if (SUPPORTS_POPOVER) {
              try { sub.hidePopover(); } catch {}
            } else {
              sub.hidden = true;
            }
          }
          return;
        }

        const listEl = sub.querySelector('.ag-s-menu-list');
        if (listEl) {
          const curId = uiState.config.promptSuggestionModel;
          listEl.innerHTML = fam.efforts
            .map((ef) => {
              const isSel = ef.id === curId;
              return (
                '<button type="button" class="ag-s-menu-row" role="menuitemradio" aria-checked="' +
                (isSel ? 'true' : 'false') +
                '" data-pick-effort="' +
                escHtml(ef.id) +
                '">' +
                '<span>' +
                escHtml(ef.label) +
                '</span>' +
                (isSel
                  ? '<svg class="ag-s-menu-row-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'
                  : '') +
                '</button>'
              );
            })
            .join('');
        }

        if (SUPPORTS_POPOVER) {
          try {
            if (SUPPORTS_IMPLICIT_ANCHOR) {
              const alreadyOpen = isPopoverOpen(sub);
              if (!alreadyOpen || lastSubAnchorBtn !== anchorBtn) {
                if (alreadyOpen) {
                  try { sub.hidePopover(); } catch {}
                }
                sub.removeAttribute('data-js-pos');
                sub.style.left = '';
                sub.style.top = '';
                sub.showPopover({ source: anchorBtn });
                lastSubAnchorBtn = anchorBtn;
              }
            } else {
              if (!isPopoverOpen(sub)) sub.showPopover();
              positionFixedOverlay(sub, anchorBtn, 'submenu');
              lastSubAnchorBtn = anchorBtn;
            }
          } catch {
            try {
              if (!isPopoverOpen(sub)) sub.showPopover();
              positionFixedOverlay(sub, anchorBtn, 'submenu');
              lastSubAnchorBtn = anchorBtn;
            } catch {}
          }
        } else {
          sub.hidden = false;
          positionFixedOverlay(sub, anchorBtn, 'submenu');
          lastSubAnchorBtn = anchorBtn;
        }

        if (focusFirst && listEl) {
          const firstBtn = listEl.querySelector('button[aria-checked="true"]') || listEl.querySelector('button');
          if (firstBtn) firstBtn.focus();
        }
      }

      function renderModelMenuItems() {
        const root = document.getElementById('ag-settings-model-menu');
        if (!root) return;
        const s = getStrings();
        const hdr = root.querySelector('.ag-s-menu-hdr');
        if (hdr) hdr.textContent = s.menuModelsHdr;

        const listEl = root.querySelector('.ag-s-menu-list');
        if (!listEl) return;
        const selInfo = findSelectedModelInfo(uiState.config.promptSuggestionModel);
        const families = uiState.families || AG_SETTINGS_FALLBACK_FAMILIES;

        listEl.innerHTML = families
          .map((fam) => {
            const isSelectedFam = selInfo.family.key === fam.key;
            const isHovered = hoveredFamilyKey === fam.key;
            const hasSub = Array.isArray(fam.efforts) && fam.efforts.length > 0;
            const displayEffort = isSelectedFam ? selInfo.effortLabel : fam.defaultEffort || '';
            const roleAttr = hasSub
              ? SUPPORTS_FOCUSGROUP
                ? ''
                : ' role="menuitem"'
              : ' role="menuitemradio" aria-checked="' + (isSelectedFam ? 'true' : 'false') + '"';

            return (
              '<button type="button" class="ag-s-menu-row"' +
              roleAttr +
              (hasSub ? ' aria-haspopup="menu" aria-expanded="' + (isHovered ? 'true' : 'false') + '"' : '') +
              ' data-fam-key="' +
              escHtml(fam.key) +
              '" data-selected="' +
              (isSelectedFam ? 'true' : 'false') +
              '" data-hovered="' +
              (isHovered ? 'true' : 'false') +
              '">' +
              '<span class="ag-s-menu-row-left">' +
              '<span class="ag-s-menu-row-name">' +
              escHtml(fam.name) +
              '</span>' +
              (displayEffort ? '<span class="ag-s-menu-row-effort">' + escHtml(displayEffort) + '</span>' : '') +
              (fam.recommended ? '<span class="ag-s-menu-badge">' + escHtml(s.recommendedBadge) + '</span>' : '') +
              '</span>' +
              '<span class="ag-s-menu-row-right" aria-hidden="true">' +
              (hasSub
                ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>'
                : isSelectedFam
                ? '<svg class="ag-s-menu-row-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'
                : '') +
              '</span>' +
              '</button>'
            );
          })
          .join('');
      }

      function ensureModelPopovers() {
        let root = document.getElementById('ag-settings-model-menu');
        if (root) return root;

        root = document.createElement('div');
        root.id = 'ag-settings-model-menu';
        if (SUPPORTS_POPOVER) {
          root.setAttribute('popover', 'auto');
        } else {
          root.hidden = true;
        }

        const fg = document.createElement('div');
        fg.setAttribute('focusgroup', 'menu nomemory');
        if (!SUPPORTS_FOCUSGROUP) fg.setAttribute('role', 'menu');
        fg.setAttribute('aria-labelledby', 'ag-s-model-trigger');

        const hdr = document.createElement('div');
        hdr.className = 'ag-s-menu-hdr';
        const list = document.createElement('div');
        list.className = 'ag-s-menu-list';

        const sub = document.createElement('div');
        sub.id = 'ag-settings-effort-menu';
        if (SUPPORTS_POPOVER) {
          sub.setAttribute('popover', 'auto');
        } else {
          sub.hidden = true;
        }
        const subFg = document.createElement('div');
        subFg.setAttribute('focusgroup', 'menu nomemory');
        if (!SUPPORTS_FOCUSGROUP) subFg.setAttribute('role', 'menu');
        subFg.setAttribute('aria-label', 'Thinking effort');
        subFg.innerHTML =
          '<div class="ag-s-menu-hdr">' +
          '<span>Thinking effort</span>' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
          '<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 4.8h.01" stroke-linecap="round"/>' +
          '</svg>' +
          '</div>' +
          '<div class="ag-s-menu-list"></div>';
        sub.appendChild(subFg);

        fg.appendChild(hdr);
        fg.appendChild(list);
        fg.appendChild(sub);
        root.appendChild(fg);
        document.body.appendChild(root);

        root.addEventListener('toggle', (ev) => {
          const trigger = document.getElementById('ag-s-model-trigger');
          const open = ev.newState === 'open';
          if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (!open && isPopoverOpen(sub)) {
            try { sub.hidePopover(); } catch {}
          }
        });

        // Hover Level 1 row -> preview Level 2 effort submenu (short grace delay when submenu is open to aid diagonal travel)
        sub.addEventListener('mouseenter', () => {
          if (hoverSwitchTimer) {
            clearTimeout(hoverSwitchTimer);
            hoverSwitchTimer = null;
          }
        });
        list.addEventListener('mouseover', (ev) => {
          const row = ev.target && ev.target.closest ? ev.target.closest('[data-fam-key]') : null;
          if (!row) return;
          const key = row.getAttribute('data-fam-key');
          if (!key) return;
          if (hoverSwitchTimer) {
            clearTimeout(hoverSwitchTimer);
            hoverSwitchTimer = null;
          }
          const applyHoverRow = () => {
            if (disposed || !isPopoverOpen(root)) return;
            if (key !== hoveredFamilyKey) {
              hoveredFamilyKey = key;
              list.querySelectorAll('[data-fam-key]').forEach((b) => {
                const isH = b.getAttribute('data-fam-key') === key;
                b.setAttribute('data-hovered', isH ? 'true' : 'false');
                if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', isH ? 'true' : 'false');
              });
            }
            if (document.activeElement && document.activeElement !== row && list.contains(document.activeElement)) {
              try {
                row.focus({ focusVisible: false });
              } catch {
                try { row.focus(); } catch {}
              }
            }
            const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
            openEffortSubmenu(fam, row, { focusFirst: false });
          };
          if (key !== hoveredFamilyKey && isPopoverOpen(sub) && ev.isTrusted) {
            hoverSwitchTimer = setTimeout(() => {
              hoverSwitchTimer = null;
              applyHoverRow();
            }, 60);
          } else {
            applyHoverRow();
          }
        });

        // Click Level 1 row
        list.addEventListener('click', (ev) => {
          const row = ev.target && ev.target.closest ? ev.target.closest('[data-fam-key]') : null;
          if (!row) return;
          const key = row.getAttribute('data-fam-key');
          const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
          if (!fam) return;
          if (fam.singleId) {
            hideModelMenus({ restoreFocus: true, fromPointer: ev.detail !== 0 });
            commitPatch({ promptSuggestionModel: fam.singleId });
          } else {
            hoveredFamilyKey = key;
            openEffortSubmenu(fam, row, { focusFirst: ev.detail === 0 });
          }
        });

        // Click Level 2 effort item
        sub.addEventListener('click', (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-pick-effort]') : null;
          if (!btn) return;
          const id = btn.getAttribute('data-pick-effort');
          if (!id) return;
          hideModelMenus({ restoreFocus: true, fromPointer: ev.detail !== 0 });
          commitPatch({ promptSuggestionModel: id });
        });

        // Keyboard navigation across Level 1 & Level 2
        const handleMenuKeydown = (menuEl, isSub) => (ev) => {
          const items = Array.from(menuEl.querySelectorAll('.ag-s-menu-list > button'));
          if (items.length === 0) return;
          const idx = items.indexOf(document.activeElement);
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
            ev.preventDefault();
            ev.stopPropagation();
            const nextIdx =
              ev.key === 'Home'
                ? 0
                : ev.key === 'End'
                ? items.length - 1
                : idx < 0
                ? 0
                : (idx + (ev.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            const nextBtn = items[nextIdx];
            nextBtn.focus();
            if (!isSub) {
              const key = nextBtn.getAttribute('data-fam-key');
              hoveredFamilyKey = key || '';
              const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
              openEffortSubmenu(fam, nextBtn, { focusFirst: false });
            }
          } else if (!isSub && ev.key === 'ArrowRight' && idx >= 0) {
            const key = items[idx].getAttribute('data-fam-key');
            const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
            if (fam && fam.efforts && fam.efforts.length > 0) {
              ev.preventDefault();
              ev.stopPropagation();
              openEffortSubmenu(fam, items[idx], { focusFirst: true });
            }
          } else if (isSub && (ev.key === 'ArrowLeft' || ev.key === 'Escape')) {
            ev.preventDefault();
            ev.stopPropagation();
            if (SUPPORTS_POPOVER) {
              try { sub.hidePopover(); } catch {}
            } else {
              sub.hidden = true;
            }
            const parentRow = list.querySelector('[data-fam-key="' + hoveredFamilyKey + '"]');
            if (parentRow) parentRow.focus();
          } else if (!isSub && ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            hideModelMenus({ restoreFocus: true, fromPointer: false });
          } else if (ev.key === 'Tab') {
            hideModelMenus({ restoreFocus: false });
          }
        };

        list.addEventListener('keydown', handleMenuKeydown(root, false));
        sub.addEventListener('keydown', handleMenuKeydown(sub, true));

        return root;
      }

      function toggleModelMenu(triggerBtn, fromKeyboard) {
        const root = ensureModelPopovers();
        if (isPopoverOpen(root)) {
          hideModelMenus({ restoreFocus: fromKeyboard, fromPointer: !fromKeyboard });
          return;
        }
        const selInfo = findSelectedModelInfo(uiState.config.promptSuggestionModel);
        hoveredFamilyKey = selInfo.family.key || (uiState.families[0] && uiState.families[0].key) || '';
        renderModelMenuItems();

        if (SUPPORTS_POPOVER) {
          try {
            if (SUPPORTS_IMPLICIT_ANCHOR) {
              root.removeAttribute('data-js-pos');
              root.style.left = '';
              root.style.top = '';
              root.showPopover({ source: triggerBtn });
            } else {
              root.showPopover();
              positionFixedOverlay(root, triggerBtn, 'root');
            }
          } catch {
            try {
              root.showPopover();
              positionFixedOverlay(root, triggerBtn, 'root');
            } catch {}
          }
        } else {
          root.hidden = false;
          positionFixedOverlay(root, triggerBtn, 'root');
        }
        triggerBtn.setAttribute('aria-expanded', 'true');

        // Preview submenu for currently selected family on open
        const selectedRow = root.querySelector('[data-fam-key="' + hoveredFamilyKey + '"]');
        const selectedFam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === hoveredFamilyKey);
        if (selectedRow && selectedFam && selectedFam.efforts && selectedFam.efforts.length > 0) {
          openEffortSubmenu(selectedFam, selectedRow, { focusFirst: false });
        }
        if (fromKeyboard) {
          const focusTarget = selectedRow || root.querySelector('.ag-s-menu-list > button');
          if (focusTarget) focusTarget.focus();
        }
      }

      function renderPane() {
        const navBtn = document.getElementById('ag-settings-nav-btn');
        const s = getStrings();
        if (navBtn) {
          const lbl = navBtn.querySelector('.ag-s-nav-label');
          if (lbl) lbl.textContent = s.navTitle;
          const ver = navBtn.querySelector('.ag-s-nav-ver');
          if (ver) ver.textContent = getShortVersionTag();
        }

        const pane = document.getElementById('ag-settings-pane');
        if (!pane) return;

        const cfg = uiState.config;
        const mods = cfg.modules || {};
        const psOn = Boolean(mods.promptSuggestions);
        const sshOn = Boolean(mods.sshRemote);
        const selInfo = findSelectedModelInfo(cfg.promptSuggestionModel);
        const savedActive = Boolean(window.__ag_settings_saved_until && Date.now() < window.__ag_settings_saved_until);

        let workerStatus = 'idle';
        let workerLabel = s.agyIdle;
        if (psOn) {
          if (uiState.agyStatus.available === false) {
            workerStatus = 'missing';
            workerLabel = s.agyMissing;
          } else if (uiState.agyStatus.warmed) {
            workerStatus = 'ready';
            workerLabel = s.agyReady;
          } else {
            workerStatus = 'warming';
            workerLabel = s.agyWarming;
          }
        }

        const prevScroll = pane.scrollTop || window.__ag_settings_scroll_top || 0;

        const chipsHtml =
          (cfg.sshHosts || [])
            .map(
              (h, idx) =>
                '<span class="ag-s-chip">' +
                '<span>' +
                escHtml(h) +
                '</span>' +
                '<button type="button" class="ag-s-chip-rm" data-rm-host="' +
                idx +
                '" aria-label="Remove ' +
                escHtml(h) +
                '">×</button>' +
                '</span>'
            )
            .join('') +
          (addingHost
            ? '<span class="ag-s-host-form">' +
              '<input type="text" id="ag-s-host-input" class="ag-s-host-input" placeholder="' +
              escHtml(s.addHostPlaceholder) +
              '" data-invalid="' +
              (invalidHost ? '1' : '0') +
              '" autocomplete="off" spellcheck="false" />' +
              '<button type="button" id="ag-s-host-ok" class="ag-s-host-ok">' +
              escHtml(s.addHostOk) +
              '</button>' +
              '</span>'
            : '<button type="button" id="ag-s-add-host" class="ag-s-add-chip-btn">' +
              escHtml(s.addHostBtn) +
              '</button>');

        const savedLabel = window.__ag_settings_saved_label === 'refreshed' ? s.refreshedBadge : s.savedBadge;

        pane.innerHTML =
          '<div class="ag-s-header">' +
          '<div class="ag-s-title-row">' +
          '<div class="ag-s-title-left">' +
          '<h2 class="ag-s-title">' +
          escHtml(s.pageTitle) +
          '</h2>' +
          '<button type="button" id="ag-s-manual-refresh" class="ag-s-hdr-refresh" aria-label="' +
          escHtml(s.manualRefreshLabel) +
          '">' +
          '<svg id="ag-s-manual-refresh-icon" class="' +
          (refreshingAll ? 'ag-s-spin' : '') +
          '" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
          '</button>' +
          '<span id="ag-s-hot-badge" class="ag-s-hot-badge"' +
          (savedActive ? '' : ' hidden') +
          '>' +
          escHtml(savedLabel) +
          '</span>' +
          '</div>' +
          '<div class="ag-s-hdr-links">' +
          '<a id="ag-s-link-github" class="ag-s-hdr-link" href="https://github.com/nkjDSLcvanv/antigravity-codex-theme" target="_blank" rel="noopener noreferrer" data-ext-link="github">' +
          '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
          '<span>' +
          escHtml(s.githubLabel) +
          '</span>' +
          '</a>' +
          '<a id="ag-s-link-feedback" class="ag-s-hdr-link" href="https://x.com/shehxuhxjx66088/status/2124698149742883293?a=EQtEZD2AMCGaj9bBRIo&s=20" target="_blank" rel="noopener noreferrer" data-ext-link="feedback">' +
          '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.52 6.77 15.48 0h-1.41L8.9 5.88 4.77 0H0l6.25 8.9L0 16h1.41l5.46-6.21L11.23 16H16L9.52 6.77Zm-1.93 2.2-.63-.89L1.92 1.04h2.17l4.07 5.7.63.89 5.29 7.4h-2.17L7.59 8.97Z"/></svg>' +
          '<span>' +
          escHtml(s.feedbackLabel) +
          '</span>' +
          '</a>' +
          '</div>' +
          '</div>' +
          '<p class="ag-s-subtitle">' +
          escHtml(s.subtitlePrefix) +
          '<span class="ag-s-mono">user/config.json</span>' +
          escHtml(s.subtitleSuffix) +
          '</p>' +
          '</div>' +
          '<div class="ag-s-sections">' +
          // Group 1: Core Modules
          '<div>' +
          '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
          escHtml(s.secCore) +
          '</span></div>' +
          '<div class="ag-s-card">' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-theme">' +
          escHtml(s.modTheme) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modThemeDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-theme" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="theme" aria-label="' +
          escHtml(s.modTheme) +
          '" ' +
          (mods.theme !== false ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-i18n">' +
          escHtml(s.modI18n) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modI18nDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-i18n" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="i18n" aria-label="' +
          escHtml(s.modI18n) +
          '" ' +
          (mods.i18n !== false ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-metrics">' +
          escHtml(s.modMetrics) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modMetricsDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-metrics" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="metrics" aria-label="' +
          escHtml(s.modMetrics) +
          '" ' +
          (mods.metrics !== false ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-quotabar">' +
          escHtml(s.modQuotaBar) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modQuotaBarDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-quotabar" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="quotaBar" aria-label="' +
          escHtml(s.modQuotaBar) +
          '" ' +
          (mods.quotaBar !== false ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '</div>' +
          '</div>' +
          // Group 2: Optional Enhancements
          '<div>' +
          '<div class="ag-s-section-head">' +
          '<span class="ag-s-section-title">' +
          escHtml(s.secOptional) +
          '</span>' +
          '<span class="ag-s-section-hint">' +
          escHtml(s.secOptionalHint) +
          '</span>' +
          '</div>' +
          '<div class="ag-s-card">' +
          // Prompt Suggestions
          '<div class="ag-s-row">' +
          '<div class="ag-s-row-main">' +
          '<div class="ag-s-row-info">' +
          '<div class="ag-s-row-label-wrap">' +
          '<label class="ag-s-row-label" for="ag-s-sw-suggest">' +
          escHtml(s.modSuggest) +
          '</label>' +
          '<span class="ag-s-worker-pill" data-status="' +
          workerStatus +
          '">' +
          '<span class="ag-s-worker-dot"></span>' +
          '<span>' +
          escHtml(workerLabel) +
          '</span>' +
          '</span>' +
          '</div>' +
          '<div class="ag-s-row-desc">' +
          escHtml(s.modSuggestDescPre) +
          '<span class="ag-s-mono">Tab</span>' +
          escHtml(s.modSuggestDescMid) +
          '<span class="ag-s-mono">→</span>' +
          escHtml(s.modSuggestDescPost) +
          '<span class="ag-s-mono">agy</span>' +
          escHtml(s.modSuggestDescEnd) +
          '</div>' +
          '</div>' +
          '<input id="ag-s-sw-suggest" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="promptSuggestions" aria-label="' +
          escHtml(s.modSuggest) +
          '" ' +
          (psOn ? 'checked' : '') +
          ' />' +
          '</div>' +
          '<div class="ag-s-subrow"' +
          (psOn ? '' : ' hidden') +
          '>' +
          '<div>' +
          '<div class="ag-s-sub-label">' +
          escHtml(s.suggestModelLbl) +
          '</div>' +
          '<div class="ag-s-sub-desc">' +
          escHtml(s.suggestModelDescPre) +
          '<span class="ag-s-mono">agy models</span>' +
          escHtml(s.suggestModelDescPost) +
          '</div>' +
          '</div>' +
          '<div class="ag-s-picker-controls">' +
          '<button type="button" id="ag-s-model-trigger" class="ag-s-pill-trigger" aria-haspopup="menu" aria-expanded="false">' +
          '<span class="ag-s-trigger-text">' +
          '<span>' +
          escHtml(selInfo.family.name) +
          '</span>' +
          (selInfo.effortLabel ? '<span class="ag-s-trigger-effort">' + escHtml(selInfo.effortLabel) + '</span>' : '') +
          '</span>' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.6;flex-shrink:0"><path d="M4 6l4 4 4-4"/></svg>' +
          '</button>' +
          '<button type="button" id="ag-s-refresh-models" class="ag-s-icon-btn" aria-label="' +
          escHtml(s.refreshModelsTitle) +
          '">' +
          '<svg id="ag-s-refresh-icon" class="' +
          (refreshingModels ? 'ag-s-spin' : '') +
          '" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
          '</button>' +
          '</div>' +
          '</div>' +
          '</div>' +
          // SSH Remote
          '<div class="ag-s-row">' +
          '<div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-ssh">' +
          escHtml(s.modSsh) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modSshDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-ssh" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="sshRemote" aria-label="' +
          escHtml(s.modSsh) +
          '" ' +
          (sshOn ? 'checked' : '') +
          ' />' +
          '</div>' +
          '<div class="ag-s-subrow"' +
          (sshOn ? '' : ' hidden') +
          '>' +
          '<span class="ag-s-sub-label">' +
          escHtml(s.sshHostsLbl) +
          '</span>' +
          '<div class="ag-s-chips">' +
          chipsHtml +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          // Group 3: Telemetry Preferences
          '<div>' +
          '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
          escHtml(s.secTelemetry) +
          '</span></div>' +
          '<div class="ag-s-card">' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
          escHtml(s.layoutLbl) +
          '</div><div class="ag-s-row-desc">' +
          escHtml(s.layoutDesc) +
          '</div></div>' +
          '<div class="ag-s-seg" role="group" aria-label="' +
          escHtml(s.layoutLbl) +
          '">' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryLayout" data-val="compact" aria-pressed="' +
          (cfg.telemetryLayout !== 'detailed' ? 'true' : 'false') +
          '">' +
          escHtml(s.layoutCompact) +
          '</button>' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryLayout" data-val="detailed" aria-pressed="' +
          (cfg.telemetryLayout === 'detailed' ? 'true' : 'false') +
          '">' +
          escHtml(s.layoutDetailed) +
          '</button>' +
          '</div>' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
          escHtml(s.cacheLbl) +
          '</div><div class="ag-s-row-desc">' +
          escHtml(s.cacheDesc) +
          '</div></div>' +
          '<div class="ag-s-seg" role="group" aria-label="' +
          escHtml(s.cacheLbl) +
          '">' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryCacheMode" data-val="session" aria-pressed="' +
          (cfg.telemetryCacheMode !== 'step' ? 'true' : 'false') +
          '">' +
          escHtml(s.cacheSession) +
          '</button>' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryCacheMode" data-val="step" aria-pressed="' +
          (cfg.telemetryCacheMode === 'step' ? 'true' : 'false') +
          '">' +
          escHtml(s.cacheStep) +
          '</button>' +
          '</div>' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
          escHtml(s.defaultExpandLbl) +
          '</div><div class="ag-s-row-desc">' +
          escHtml(s.defaultExpandDesc) +
          '</div></div>' +
          '<div class="ag-s-seg" role="group" aria-label="' +
          escHtml(s.defaultExpandLbl) +
          '">' +
          '<button type="button" class="ag-s-seg-btn" data-bool-seg="telemetryDefaultExpanded" data-val="false" aria-pressed="' +
          (!cfg.telemetryDefaultExpanded ? 'true' : 'false') +
          '">' +
          escHtml(s.defaultExpandOff) +
          '</button>' +
          '<button type="button" class="ag-s-seg-btn" data-bool-seg="telemetryDefaultExpanded" data-val="true" aria-pressed="' +
          (cfg.telemetryDefaultExpanded ? 'true' : 'false') +
          '">' +
          escHtml(s.defaultExpandOn) +
          '</button>' +
          '</div>' +
          '</div></div>' +
          '</div>' +
          '</div>' +
          // Group 3.5: Quota Bar Appearance
          (() => {
            if (mods.quotaBar === false) return '';
            const q = Object.assign({}, DEFAULT_QUOTA_BAR_UI, cfg.quotaBar || {});
            const segBtn = (field, val, label) =>
              '<button type="button" class="ag-s-seg-btn" data-quota-seg="' +
              field +
              '" data-val="' +
              val +
              '" aria-pressed="' +
              (q[field] === val ? 'true' : 'false') +
              '">' +
              escHtml(label) +
              '</button>';
            const qCache = window.__ag_quota_cache;
            const b5 = qCache && qCache.groups && qCache.groups[0] && qCache.groups[0].buckets.find((b) => b.window === '5h');
            const bw = qCache && qCache.groups && qCache.groups[0] && qCache.groups[0].buckets.find((b) => b.window === 'weekly');
            const p5 = b5 ? b5.pct : 94;
            const pw = bw ? bw.pct : 98;
            const prevLvl = (p) => (p <= 20 ? 'crit' : p <= 50 ? 'warn' : 'ok');
            const prevItem = (lbl, pct, rst) => {
              const rstEl = q.showReset ? '<span class="ag-q-rst">(' + rst + ')</span>' : '';
              if (q.style === 'pill') {
                return '<span class="ag-q-item ag-q-pill-chip" data-lvl="' + prevLvl(pct) + '"><span class="ag-q-dot"></span><span class="ag-q-lbl">' + lbl + '</span><span class="ag-q-pct">' + pct + '%</span>' + rstEl + '</span>';
              }
              if (q.style === 'text') {
                return '<span class="ag-q-item" data-lvl="' + prevLvl(pct) + '"><span class="ag-q-lbl">' + lbl + '</span><span class="ag-q-pct">' + pct + '%</span>' + rstEl + '</span>';
              }
              return '<span class="ag-q-item" data-lvl="' + prevLvl(pct) + '"><span class="ag-q-lbl">' + lbl + '</span><span class="ag-q-track"><span class="ag-q-fill" style="width:' + pct + '%"></span></span><span class="ag-q-pct">' + pct + '%</span>' + rstEl + '</span>';
            };
            const prevStyleAttr =
              (q.customColor ? '--ag-q-custom-color:' + escHtml(q.customColor) + ';' : '') +
              (q.customBg ? '--ag-q-custom-bg:' + escHtml(q.customBg) + ';' : '');
            const prevItems = [];
            if (q.windows !== 'weekly') prevItems.push(prevItem('5h', p5, '40m'));
            if (q.windows !== '5h') prevItems.push(prevItem(isZhUi() ? '周' : 'Wk', pw, '6d'));
            const prevHtml =
              '<div class="ag-q-preview-bar" data-ag-q-style="' +
              escHtml(q.style) +
              '" data-ag-q-theme="' +
              escHtml(q.theme) +
              '" data-ag-q-size="' +
              escHtml(q.size) +
              '"' +
              (prevStyleAttr ? ' style="' + prevStyleAttr + '"' : '') +
              '>' +
              '<span class="ag-q-group"><span class="ag-q-grp">' +
              (q.scope === 'all' ? 'Gemini' : isZhUi() ? '配额' : 'Quota') +
              '</span>' +
              prevItems.join('') +
              '</span>' +
              (q.scope === 'all' ? '<span class="ag-q-grp-sep">·</span><span class="ag-q-group"><span class="ag-q-grp">Claude/GPT</span>' + prevItem('5h', 100, '') + '</span>' : '') +
              (q.showCredits ? '<span class="ag-q-credits">' + (isZhUi() ? '点数 500' : 'Cr 500') + '</span>' : '') +
              '</div>';

            return (
              '<div>' +
              '<div class="ag-s-section-head">' +
              '<span class="ag-s-section-title">' +
              escHtml(s.secQuota) +
              '</span>' +
              '<span class="ag-s-section-hint">' +
              escHtml(s.secQuotaHint) +
              '</span>' +
              '</div>' +
              '<div class="ag-s-card">' +
              '<div class="ag-s-row">' +
              '<div class="ag-s-sub-label" style="margin-bottom:8px">' +
              escHtml(s.qPreviewLbl) +
              '</div>' +
              '<div class="ag-s-quota-preview-box" data-align="' +
              escHtml(q.align) +
              '">' +
              prevHtml +
              '</div>' +
              '</div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qStyleLbl) +
              '</div><div class="ag-s-row-desc">' +
              escHtml(s.qStyleDesc) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('style', 'text', s.qStyleText) +
              segBtn('style', 'bar', s.qStyleBar) +
              segBtn('style', 'pill', s.qStylePill) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qPlaceLbl) +
              '</div><div class="ag-s-row-desc">' +
              escHtml(s.qPlaceDesc) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('placement', 'inline', s.qPlaceInline) +
              segBtn('placement', 'separate', s.qPlaceSeparate) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qScopeLbl) +
              '</div><div class="ag-s-row-desc">' +
              escHtml(s.qScopeDesc) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('scope', 'current', s.qScopeCurrent) +
              segBtn('scope', 'all', s.qScopeAll) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qWinLbl) +
              '</div><div class="ag-s-row-desc">' +
              escHtml(s.qWinDesc) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('windows', 'both', s.qWinBoth) +
              segBtn('windows', '5h', s.qWin5h) +
              segBtn('windows', 'weekly', s.qWinWeekly) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row">' +
              '<div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qThemeLbl) +
              '</div><div class="ag-s-row-desc">' +
              escHtml(s.qThemeDesc) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('theme', 'auto', s.qThemeAuto) +
              segBtn('theme', 'mono', s.qThemeMono) +
              segBtn('theme', 'accent', s.qThemeAccent) +
              segBtn('theme', 'custom', s.qThemeCustom) +
              '</div>' +
              '</div>' +
              '<div class="ag-s-subrow"' +
              (q.theme === 'custom' ? '' : ' hidden') +
              '>' +
              '<div class="ag-s-color-row">' +
              '<label class="ag-s-color-chip"><span>' +
              escHtml(s.qCustomFg) +
              '</span><input type="color" class="ag-s-color-input" data-quota-color="customColor" value="' +
              escHtml(q.customColor || '#2B7FFF') +
              '" /></label>' +
              '<label class="ag-s-color-chip"><span>' +
              escHtml(s.qCustomBg) +
              '</span><input type="color" class="ag-s-color-input" data-quota-color="customBg" value="' +
              escHtml(/^#[0-9a-fA-F]{6}$/.test(q.customBg || '') ? q.customBg : '#EFF6FF') +
              '" /></label>' +
              '<button type="button" id="ag-s-quota-color-reset" class="ag-s-color-clear">' +
              escHtml(s.qCustomClear) +
              '</button>' +
              '</div>' +
              '</div>' +
              '</div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qSizeLbl) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('size', 'sm', s.qSizeSm) +
              segBtn('size', 'md', s.qSizeMd) +
              segBtn('size', 'lg', s.qSizeLg) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
              escHtml(s.qAlignLbl) +
              '</div></div>' +
              '<div class="ag-s-seg" role="group">' +
              segBtn('align', 'left', s.qAlignLeft) +
              segBtn('align', 'center', s.qAlignCenter) +
              segBtn('align', 'right', s.qAlignRight) +
              segBtn('align', 'between', s.qAlignBetween) +
              '</div>' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-qreset">' +
              escHtml(s.qShowResetLbl) +
              '</label></div>' +
              '<input id="ag-s-sw-qreset" type="checkbox" switch role="switch" class="ag-s-switch" data-quota-toggle="showReset" ' +
              (q.showReset ? 'checked' : '') +
              ' />' +
              '</div></div>' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-qcredits">' +
              escHtml(s.qShowCreditsLbl) +
              '</label></div>' +
              '<input id="ag-s-sw-qcredits" type="checkbox" switch role="switch" class="ag-s-switch" data-quota-toggle="showCredits" ' +
              (q.showCredits ? 'checked' : '') +
              ' />' +
              '</div></div>' +
              '</div>' +
              '</div>'
            );
          })() +
          // Group 4: Plugin Version & Updates
          (() => {
            const u = uiState.update || {};
            const verStr = u.currentVersion ? 'v' + String(u.currentVersion).replace(/^v/i, '') : getShortVersionTag();
            const isBusy = u.phase === 'checking' || u.phase === 'updating';
            let pillHtml = '';
            let descText = s.updDescIdle;
            if (u.phase === 'checking') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="idle">' + escHtml(s.updPillChecking) + '</span>';
              descText = s.updDescChecking;
            } else if (u.phase === 'updating') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="warn">' + escHtml(s.updPillUpdating) + '</span>';
              descText = s.updDescUpdating;
            } else if (u.status === 'applied') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="ok">' + escHtml(s.updPillApplied) + '</span>';
              descText = s.updDescApplied;
            } else if (u.status === 'up_to_date') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="ok">' + escHtml(s.updPillLatest) + '</span>';
              descText = s.updDescUpToDate;
            } else if (u.status === 'ahead') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="ok">' + escHtml(s.updPillAhead) + '</span>';
              descText = s.updDescAhead;
            } else if (u.status === 'update_available') {
              const latestTag = u.latestVersion ? 'v' + String(u.latestVersion).replace(/^v/i, '') : '';
              pillHtml =
                '<span class="ag-s-upd-pill" data-tone="warn">' +
                escHtml(s.updPillAvailablePrefix + latestTag) +
                '</span>';
              descText = s.updDescAvailable;
            } else if (u.status === 'main_diff') {
              const diffSuffix = u.changedCount > 0 ? ' (' + u.changedCount + ')' : '';
              pillHtml =
                '<span class="ag-s-upd-pill" data-tone="warn">' +
                escHtml(s.updPillMainDiff + diffSuffix) +
                '</span>';
              descText = s.updDescMainDiff;
            } else if (u.status === 'error') {
              pillHtml = '<span class="ag-s-upd-pill" data-tone="err">' + escHtml(s.updPillErr) + '</span>';
              descText = u.error ? String(u.error).slice(0, 140) : s.updPillErr;
            }

            const showApply = u.status === 'update_available' || u.status === 'main_diff' || u.phase === 'updating';
            const applyLabel =
              u.phase === 'updating'
                ? s.updBtnUpdating
                : u.status === 'update_available'
                ? s.updBtnApply
                : s.updBtnSyncMain;

            return (
              '<div>' +
              '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
              escHtml(s.secUpdate) +
              '</span></div>' +
              '<div class="ag-s-card">' +
              '<div class="ag-s-row"><div class="ag-s-row-main">' +
              '<div class="ag-s-row-info">' +
              '<div class="ag-s-row-label-wrap">' +
              '<span class="ag-s-row-label" style="cursor:default">' +
              escHtml(s.updTitle) +
              '</span>' +
              '<span class="ag-s-upd-pill">' +
              escHtml(verStr) +
              '</span>' +
              pillHtml +
              '</div>' +
              '<div class="ag-s-row-desc">' +
              escHtml(descText) +
              '</div>' +
              '</div>' +
              '<div class="ag-s-upd-actions">' +
              '<button type="button" id="ag-s-check-update" class="ag-s-btn-secondary"' +
              (isBusy ? ' disabled' : '') +
              '>' +
              escHtml(u.phase === 'checking' ? s.updBtnChecking : s.updBtnCheck) +
              '</button>' +
              (showApply
                ? '<button type="button" id="ag-s-apply-update" class="' +
                  (u.status === 'update_available' || u.phase === 'updating' ? 'ag-s-btn-primary' : 'ag-s-btn-secondary') +
                  '"' +
                  (isBusy ? ' disabled' : '') +
                  '>' +
                  escHtml(applyLabel) +
                  '</button>'
                : '') +
              '</div>' +
              '</div></div>' +
              '</div>' +
              '</div>'
            );
          })() +
          '</div>';

        if (prevScroll > 0) pane.scrollTop = prevScroll;

        if (addingHost) {
          const inp = document.getElementById('ag-s-host-input');
          if (inp) {
            inp.focus();
            inp.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                submitNewHost(inp.value);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                addingHost = false;
                invalidHost = false;
                renderPane();
              }
            });
          }
        }

        if (savedActive) {
          if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
          const remain = Math.max(100, window.__ag_settings_saved_until - Date.now());
          saveBadgeTimer = setTimeout(() => {
            const b = document.getElementById('ag-s-hot-badge');
            if (b) {
              b.hidden = true;
            }
          }, remain);
        }

        if (isPopoverOpen(document.getElementById('ag-settings-model-menu'))) {
          renderModelMenuItems();
        }
      }

      function submitNewHost(rawVal) {
        const host = String(rawVal || '').trim();
        if (!host) {
          addingHost = false;
          invalidHost = false;
          renderPane();
          return;
        }
        if (host.startsWith('-') || !VALID_HOST_RE.test(host)) {
          invalidHost = true;
          const inp = document.getElementById('ag-s-host-input');
          if (inp) {
            inp.setAttribute('data-invalid', '1');
            inp.focus();
          }
          return;
        }
        addingHost = false;
        invalidHost = false;
        const nextHosts = (uiState.config.sshHosts || []).slice();
        if (!nextHosts.includes(host)) nextHosts.push(host);
        commitPatch({ sshHosts: nextHosts });
      }

      function setActiveCustomTab(tab) {
        const nextTab = tab === 'codex' || tab === 'stats' ? tab : '';
        window.__ag_settings_active_tab = nextTab;
        window.__ag_settings_tab_open = nextTab === 'codex';
        if (activeDlg) {
          if (nextTab) {
            activeDlg.setAttribute('data-ag-codex-settings-open', nextTab);
          } else {
            activeDlg.removeAttribute('data-ag-codex-settings-open');
          }
        }
        if (nextTab === 'codex') {
          renderPane();
          fetchSettingsState({
            includeModels: !window.__ag_settings_models_cache,
            refreshModels: false
          });
          syncStatusPoller();
        } else if (nextTab === 'stats') {
          hideModelMenus({ restoreFocus: false });
          syncStatusPoller();
          renderStatsPane();
          fetchGlobalStats({ range: statsRange, force: true });
        } else {
          hideModelMenus({ restoreFocus: false });
          syncStatusPoller();
        }
      }

      function bindPaneEvents(pane) {
        pane.addEventListener('change', (ev) => {
          const sw = ev.target && ev.target.closest ? ev.target.closest('input.ag-s-switch[data-bind-mod]') : null;
          if (sw) {
            const mod = sw.getAttribute('data-bind-mod');
            if (!mod) return;
            const checked = Boolean(sw.checked);
            if (mod === 'promptSuggestions' && !checked) {
              hideModelMenus({ restoreFocus: false });
            }
            commitPatch({ modules: { [mod]: checked } });
            return;
          }

          const qSw = ev.target && ev.target.closest ? ev.target.closest('input.ag-s-switch[data-quota-toggle]') : null;
          if (qSw) {
            const qField = qSw.getAttribute('data-quota-toggle');
            if (qField) commitPatch({ quotaBar: { [qField]: Boolean(qSw.checked) } });
            return;
          }

          const qCol = ev.target && ev.target.closest ? ev.target.closest('input[data-quota-color]') : null;
          if (qCol) {
            const cField = qCol.getAttribute('data-quota-color');
            if (cField) commitPatch({ quotaBar: { [cField]: String(qCol.value || '').trim() } });
          }
        });

        pane.addEventListener('click', (ev) => {
          const manualRef = ev.target && ev.target.closest ? ev.target.closest('#ag-s-manual-refresh') : null;
          if (manualRef) {
            ev.preventDefault();
            ev.stopPropagation();
            fetchSettingsState({ includeModels: true, refreshModels: true, forceReload: true });
            return;
          }

          const checkUpd = ev.target && ev.target.closest ? ev.target.closest('#ag-s-check-update') : null;
          if (checkUpd) {
            ev.preventDefault();
            ev.stopPropagation();
            checkPluginUpdate();
            return;
          }

          const applyUpd = ev.target && ev.target.closest ? ev.target.closest('#ag-s-apply-update') : null;
          if (applyUpd) {
            ev.preventDefault();
            ev.stopPropagation();
            applyPluginUpdateAction();
            return;
          }

          const extLink = ev.target && ev.target.closest ? ev.target.closest('a[data-ext-link]') : null;
          if (extLink) {
            const key = extLink.getAttribute('data-ext-link');
            if (key && typeof window.__agOpenExternalUrl === 'function') {
              ev.preventDefault();
              ev.stopPropagation();
              try {
                window.__agOpenExternalUrl(JSON.stringify({ key }));
              } catch {}
            }
            return;
          }

          const trigger = ev.target && ev.target.closest ? ev.target.closest('#ag-s-model-trigger') : null;
          if (trigger) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleModelMenu(trigger, ev.detail === 0);
            return;
          }

          const refBtn = ev.target && ev.target.closest ? ev.target.closest('#ag-s-refresh-models') : null;
          if (refBtn) {
            ev.preventDefault();
            ev.stopPropagation();
            fetchSettingsState({ includeModels: true, refreshModels: true });
            return;
          }

          const seg = ev.target && ev.target.closest ? ev.target.closest('.ag-s-seg-btn[data-seg]') : null;
          if (seg) {
            const field = seg.getAttribute('data-seg');
            const val = seg.getAttribute('data-val');
            if (field && val && uiState.config[field] !== val) {
              commitPatch({ [field]: val });
            }
            return;
          }

          const boolSeg = ev.target && ev.target.closest ? ev.target.closest('.ag-s-seg-btn[data-bool-seg]') : null;
          if (boolSeg) {
            const field = boolSeg.getAttribute('data-bool-seg');
            const val = boolSeg.getAttribute('data-val') === 'true';
            if (field && Boolean(uiState.config[field]) !== val) {
              commitPatch({ [field]: val });
            }
            return;
          }

          const qSeg = ev.target && ev.target.closest ? ev.target.closest('.ag-s-seg-btn[data-quota-seg]') : null;
          if (qSeg) {
            const qField = qSeg.getAttribute('data-quota-seg');
            const val = qSeg.getAttribute('data-val');
            const curQ = uiState.config.quotaBar || DEFAULT_QUOTA_BAR_UI;
            if (qField && val && curQ[qField] !== val) {
              commitPatch({ quotaBar: { [qField]: val } });
            }
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-quota-color-reset')) {
            commitPatch({ quotaBar: { customColor: '', customBg: '' } });
            return;
          }

          const rmBtn = ev.target && ev.target.closest ? ev.target.closest('[data-rm-host]') : null;
          if (rmBtn) {
            const idx = Number(rmBtn.getAttribute('data-rm-host'));
            const nextHosts = (uiState.config.sshHosts || []).slice();
            if (idx >= 0 && idx < nextHosts.length) {
              nextHosts.splice(idx, 1);
              commitPatch({ sshHosts: nextHosts });
            }
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-add-host')) {
            addingHost = true;
            invalidHost = false;
            renderPane();
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-host-ok')) {
            const inp = document.getElementById('ag-s-host-input');
            submitNewHost(inp ? inp.value : '');
          }
        });

        pane.addEventListener('keydown', (ev) => {
          const trigger = ev.target && ev.target.closest ? ev.target.closest('#ag-s-model-trigger') : null;
          if (trigger && ev.key === 'ArrowDown') {
            ev.preventDefault();
            ev.stopPropagation();
            const root = ensureModelPopovers();
            if (!isPopoverOpen(root)) {
              toggleModelMenu(trigger, true);
            } else {
              const first = root.querySelector('.ag-s-menu-list > button');
              if (first) first.focus();
            }
          }
        });
      }

      function tryMountInSettingsModal() {
        if (disposed) return;
        const sidebar = document.querySelector('[data-testid="settings-sidebar"]');
        const dlg = sidebar ? sidebar.closest('.settings-modal-container') || sidebar.closest('[role="dialog"]') : null;

        if (!dlg || !sidebar) {
          if (activeDlg) {
            activeDlg = null;
            if (activeSidebar && boundSidebarClick) {
              try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
            }
            activeSidebar = null;
            boundSidebarClick = null;
            window.__ag_settings_active_tab = '';
            window.__ag_settings_tab_open = false;
            window.__ag_settings_scroll_top = 0;
            hideModelMenus({ restoreFocus: false });
            syncStatusPoller();
          }
          return;
        }

        const listRoot = sidebar.firstElementChild;
        const firstNavGroup =
          listRoot &&
          (Array.from(listRoot.children).find((el) => el.querySelector && el.querySelector('[data-testid^="settings-nav-item-"]')) ||
            listRoot.children[1]);
        const splitRow = sidebar.closest('.relative.flex.w-full.h-full') || (dlg.querySelector('.relative.flex.w-full.h-full'));
        const rightPane = splitRow && splitRow.children && splitRow.children[1];
        if (!firstNavGroup || !rightPane) return;

        let justMounted = activeDlg !== dlg;
        activeDlg = dlg;
        rightPane.setAttribute('data-ag-settings-right-pane', '1');

        if (activeSidebar !== sidebar) {
          if (activeSidebar && boundSidebarClick) {
            try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
          }
          activeSidebar = sidebar;
          boundSidebarClick = (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
            if (
              btn &&
              btn.id !== 'ag-settings-nav-btn' &&
              btn.id !== 'ag-settings-stats-nav-btn' &&
              window.__ag_settings_active_tab
            ) {
              setActiveCustomTab('');
            }
          };
          sidebar.addEventListener('click', boundSidebarClick, true);
        }

        let divider = document.getElementById('ag-settings-nav-divider');
        if (!divider) {
          divider = document.createElement('div');
          divider.id = 'ag-settings-nav-divider';
        }
        if (divider.parentElement !== firstNavGroup) {
          firstNavGroup.appendChild(divider);
          justMounted = true;
        }

        let navWrap = document.getElementById('ag-settings-nav-wrap');
        if (!navWrap) {
          navWrap = document.createElement('div');
          navWrap.id = 'ag-settings-nav-wrap';
          navWrap.className = 'relative group/nav-item';
          const btn = document.createElement('button');
          btn.id = 'ag-settings-nav-btn';
          btn.type = 'button';
          btn.setAttribute('data-testid', 'settings-nav-item-CodexTheme');
          btn.innerHTML =
            '<span class="ag-s-nav-left">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;flex-shrink:0" aria-hidden="true">' +
            '<circle cx="8" cy="8" r="5.5"></circle>' +
            '<path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" fill="currentColor" stroke="none"></path>' +
            '</svg>' +
            '<span class="ag-s-nav-label"></span>' +
            '</span>' +
            '<span class="ag-s-nav-ver"></span>';
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setActiveCustomTab('codex');
          });
          navWrap.appendChild(btn);
          justMounted = true;
        }
        if (navWrap.parentElement !== firstNavGroup) {
          firstNavGroup.appendChild(navWrap);
          justMounted = true;
        }

        let statsNavWrap = document.getElementById('ag-settings-stats-nav-wrap');
        if (!statsNavWrap) {
          statsNavWrap = document.createElement('div');
          statsNavWrap.id = 'ag-settings-stats-nav-wrap';
          statsNavWrap.className = 'relative group/nav-item';
          const sBtn = document.createElement('button');
          sBtn.id = 'ag-settings-stats-nav-btn';
          sBtn.type = 'button';
          sBtn.setAttribute('data-testid', 'settings-nav-item-TokenStats');
          sBtn.innerHTML =
            '<span class="ag-s-nav-left">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;flex-shrink:0" aria-hidden="true">' +
            '<path d="M3 13V8M8 13V3M13 13V6"/>' +
            '</svg>' +
            '<span class="ag-s-nav-label"></span>' +
            '</span>';
          sBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setActiveCustomTab('stats');
          });
          statsNavWrap.appendChild(sBtn);
          justMounted = true;
        }
        if (statsNavWrap.parentElement !== firstNavGroup) {
          firstNavGroup.appendChild(statsNavWrap);
          justMounted = true;
        }

        let pane = document.getElementById('ag-settings-pane');
        if (!pane) {
          pane = document.createElement('div');
          pane.id = 'ag-settings-pane';
          bindPaneEvents(pane);
          justMounted = true;
        }
        if (pane.parentElement !== rightPane) {
          rightPane.appendChild(pane);
          justMounted = true;
        }

        let statsPane = document.getElementById('ag-stats-pane');
        if (!statsPane) {
          statsPane = document.createElement('div');
          statsPane.id = 'ag-stats-pane';
          statsPane.addEventListener('click', (ev) => {
            const refBtn = ev.target && ev.target.closest ? ev.target.closest('#ag-stats-refresh') : null;
            if (refBtn) {
              ev.preventDefault();
              ev.stopPropagation();
              fetchGlobalStats({ range: statsRange, force: true });
              return;
            }
            const rangeBtn = ev.target && ev.target.closest ? ev.target.closest('[data-stats-range]') : null;
            if (rangeBtn) {
              const r = rangeBtn.getAttribute('data-stats-range');
              if (r && r !== statsRange) {
                fetchGlobalStats({ range: r, force: false });
              }
            }
          });
          justMounted = true;
        }
        if (statsPane.parentElement !== rightPane) {
          rightPane.appendChild(statsPane);
          justMounted = true;
        }

        if (justMounted) {
          renderPane();
          renderStatsPane();
          const curTab = window.__ag_settings_active_tab || (window.__ag_settings_tab_open ? 'codex' : '');
          if (curTab === 'codex') {
            activeDlg.setAttribute('data-ag-codex-settings-open', 'codex');
            fetchSettingsState({
              includeModels: !window.__ag_settings_models_cache,
              refreshModels: false
            });
            syncStatusPoller();
          } else if (curTab === 'stats') {
            activeDlg.setAttribute('data-ag-codex-settings-open', 'stats');
            fetchGlobalStats({ range: statsRange, force: false });
          }
        }
      }

      function scheduleScan(delayMs) {
        if (disposed || scanTimer) return;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          tryMountInSettingsModal();
        }, delayMs);
      }

      const onDocClick = (ev) => {
        if (disposed) return;
        if (!SUPPORTS_POPOVER) {
          const root = document.getElementById('ag-settings-model-menu');
          if (
            root &&
            !root.hidden &&
            ev.target &&
            ev.target.closest &&
            !ev.target.closest('#ag-settings-model-menu') &&
            !ev.target.closest('#ag-s-model-trigger')
          ) {
            hideModelMenus({ restoreFocus: false });
          }
        }
        if (ev.target && ev.target.closest && ev.target.closest('[data-testid="settings-button"]')) {
          scheduleScan(40);
          setTimeout(() => { if (!disposed) tryMountInSettingsModal(); }, 160);
        }
      };

      const observer =
        typeof MutationObserver !== 'undefined'
          ? new MutationObserver(() => {
              if (activeDlg) {
                const navOk = document.getElementById('ag-settings-nav-wrap');
                const paneOk = document.getElementById('ag-settings-pane');
                if (!activeDlg.isConnected || !navOk || !navOk.isConnected || !paneOk || !paneOk.isConnected) {
                  scheduleScan(60);
                }
                return;
              }
              if (
                window.location.search.includes('settingsOpen=true') ||
                document.querySelector('[data-testid="settings-sidebar"]')
              ) {
                scheduleScan(80);
              }
            })
          : null;
      if (observer && document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
      document.addEventListener('click', onDocClick, true);

      tryMountInSettingsModal();

      if (Array.isArray(window.__ag_cleanup_fns)) {
        window.__ag_cleanup_fns.push(() => {
          disposed = true;
          if (scanTimer) clearTimeout(scanTimer);
          if (statusPollTimer) clearInterval(statusPollTimer);
          if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
          if (hoverSwitchTimer) clearTimeout(hoverSwitchTimer);
          if (observer) observer.disconnect();
          document.removeEventListener('click', onDocClick, true);
          if (activeSidebar && boundSidebarClick) {
            try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
          }
          hideModelMenus({ restoreFocus: false });
          const oldPopovers = [
            document.getElementById('ag-settings-model-menu'),
            document.getElementById('ag-settings-effort-menu')
          ];
          oldPopovers.forEach((el) => { if (el) el.remove(); });
          // Preserve nav & pane nodes across hot-reloads only if modal is closed? Remove cleanly so new bundle re-mounts fresh with preserved __ag_settings_tab_open!
          cleanupCodexSettingsDom();
          try { delete window.__ag_on_settings_state; } catch { window.__ag_on_settings_state = null; }
        });
      }
    })();
  }
