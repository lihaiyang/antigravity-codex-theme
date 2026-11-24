/**
 * core/daemon/paths.mjs — Cross-Platform Channel Discovery & Dynamic Bundle Builder
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ALLOWED_ORIGINS, extractJsoncNumberProperty, stripUtf8Bom } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const CORE_DIR = path.join(ROOT_DIR, 'core');
export const STYLES_DIR = path.join(CORE_DIR, 'styles');
export const RUNTIME_DIR = path.join(CORE_DIR, 'runtime');
export const USER_DIR = path.join(ROOT_DIR, 'user');
export const BASE_VERSION = '1.3.1';

export function parseDaemonCliArgs(argv = process.argv.slice(2)) {
  const hasFlag = (f) => argv.some((a) => a === f || a.startsWith(f + '='));
  const getArg = (flag, fallback = null) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(flag + '=')) return argv[i].slice(flag.length + 1);
    }
    return fallback;
  };
  return {
    safeMode: hasFlag('--safe-mode'),
    runOnce: hasFlag('--once'),
    cliChannel: getArg('--channel', null),
    portFile: getArg('--port-file', ''),
    conversationsDir: getArg('--conversations-dir', '')
  };
}

export function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return fallback;
  }
}

export function readTextSafe(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function getFileMtimeSig(filePath) {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : '0:0';
  } catch {
    return '0:0';
  }
}

export function listSortedFiles(dirPath, ext) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith(ext))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

export function normalizeOverrideDict(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') return {};
  const source = rawObj.exact && typeof rawObj.exact === 'object' ? rawObj.exact : rawObj;
  const clean = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

export function resolveChannelPaths(singleChannel = 'stable', userCfg = {}, cliOpts = {}) {
  const home = os.homedir();
  const isInsiders = singleChannel === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  const geminiSubDir = isInsiders ? '.gemini/antigravity-insiders' : '.gemini/antigravity';

  let defaultPortFile;
  if (process.platform === 'darwin') {
    defaultPortFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    defaultPortFile = path.join(appData, appDirName, 'DevToolsActivePort');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    defaultPortFile = path.join(xdgConfig, appDirName, 'DevToolsActivePort');
  }

  const defaultConvDir = path.join(home, geminiSubDir, 'conversations');
  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const parsedPort = extractJsoncNumberProperty(fs.readFileSync(argvPath, 'utf8'), 'remote-debugging-port');
      if (parsedPort && parsedPort > 0) fallbackPort = parsedPort;
    }
  } catch {}

  const portFile = cliOpts.portFile || userCfg.portFile || defaultPortFile;
  const lsLogFile =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Logs', appDirName, 'language_server.log')
      : path.join(path.dirname(defaultPortFile), 'logs', 'language_server.log');
  const channelInstalled =
    fs.existsSync(portFile) || fs.existsSync(path.dirname(defaultPortFile)) || fs.existsSync(dotDir);

  return {
    channel: singleChannel,
    portFile,
    lsLogFile,
    fallbackPort: Number(userCfg.fallbackPort) > 0 ? Number(userCfg.fallbackPort) : fallbackPort,
    channelInstalled,
    conversationsDir: cliOpts.conversationsDir || userCfg.conversationsDir || defaultConvDir
  };
}

export function resolveActiveChannelEndpoints(channelMode = 'auto', userCfg = {}, cliOpts = {}) {
  const explicitPortFile = cliOpts.portFile || userCfg.portFile || '';
  if (explicitPortFile) {
    const ch = channelMode === 'insiders' ? 'insiders' : 'stable';
    return [resolveChannelPaths(ch, userCfg, cliOpts)];
  }
  if (channelMode === 'stable' || channelMode === 'insiders') {
    return [resolveChannelPaths(channelMode, userCfg, cliOpts)];
  }
  return [
    resolveChannelPaths('stable', userCfg, cliOpts),
    resolveChannelPaths('insiders', userCfg, cliOpts)
  ];
}

const EDITABLE_MODULE_KEYS = new Set([
  'theme',
  'i18n',
  'metrics',
  'quotaBar',
  'promptSuggestions',
  'sshRemote',
  'deadlockHealer',
  'zoomShortcuts',
  'cdpAutoRelaunch',
  'customCss',
  'customJs'
]);
const VALID_SSH_HOST_RE = /^[a-zA-Z0-9_@][a-zA-Z0-9._:@-]{0,127}$/;
const VALID_SUGGEST_MODEL_RE = /^[a-zA-Z0-9._:/-]{2,80}$/;

export const DEFAULT_QUOTA_BAR_CONFIG = Object.freeze({
  style: 'bar',          // 'text' | 'bar' | 'pill'
  placement: 'inline',   // 'inline' | 'separate'
  scope: 'current',      // 'current' | 'all'
  windows: 'both',       // 'both' | '5h' | 'weekly'
  theme: 'auto',         // 'auto' | 'mono' | 'accent' | 'custom'
  size: 'md',            // 'sm' | 'md' | 'lg'
  align: 'center',       // 'left' | 'center' | 'right' | 'between'
  showReset: true,
  showCredits: false,
  customColor: '',
  customBg: ''
});

function sanitizeQuotaColor(val, allowRgba = false) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (
    allowRgba &&
    s.length <= 48 &&
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0?\.\d+|1(?:\.0+)?|0))?\s*\)$/.test(s)
  ) {
    return s;
  }
  return '';
}

export function normalizeQuotaBarConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    style: src.style === 'text' || src.style === 'pill' || src.style === 'bar' ? src.style : DEFAULT_QUOTA_BAR_CONFIG.style,
    placement: src.placement === 'separate' || src.placement === 'inline' ? src.placement : DEFAULT_QUOTA_BAR_CONFIG.placement,
    scope: src.scope === 'all' || src.scope === 'current' ? src.scope : DEFAULT_QUOTA_BAR_CONFIG.scope,
    windows: src.windows === '5h' || src.windows === 'weekly' || src.windows === 'both' ? src.windows : DEFAULT_QUOTA_BAR_CONFIG.windows,
    theme: src.theme === 'mono' || src.theme === 'accent' || src.theme === 'custom' || src.theme === 'auto' ? src.theme : DEFAULT_QUOTA_BAR_CONFIG.theme,
    size: src.size === 'sm' || src.size === 'lg' || src.size === 'md' ? src.size : DEFAULT_QUOTA_BAR_CONFIG.size,
    align: src.align === 'left' || src.align === 'right' || src.align === 'between' || src.align === 'center' ? src.align : DEFAULT_QUOTA_BAR_CONFIG.align,
    showReset: typeof src.showReset === 'boolean' ? src.showReset : DEFAULT_QUOTA_BAR_CONFIG.showReset,
    showCredits: typeof src.showCredits === 'boolean' ? src.showCredits : DEFAULT_QUOTA_BAR_CONFIG.showCredits,
    customColor: sanitizeQuotaColor(src.customColor, false),
    customBg: sanitizeQuotaColor(src.customBg, true)
  };
}

export function sanitizeConfigPatch(currentCfg, patch) {
  const base = currentCfg && typeof currentCfg === 'object' ? JSON.parse(JSON.stringify(currentCfg)) : {};
  if (!patch || typeof patch !== 'object') return base;

  if (patch.modules && typeof patch.modules === 'object') {
    const nextModules = base.modules && typeof base.modules === 'object' ? { ...base.modules } : {};
    for (const [k, v] of Object.entries(patch.modules)) {
      if (EDITABLE_MODULE_KEYS.has(k) && typeof v === 'boolean') {
        nextModules[k] = v;
      }
    }
    base.modules = nextModules;
  }

  if (patch.telemetryLayout === 'compact' || patch.telemetryLayout === 'detailed') {
    base.telemetryLayout = patch.telemetryLayout;
  }
  if (patch.telemetryCacheMode === 'session' || patch.telemetryCacheMode === 'step') {
    base.telemetryCacheMode = patch.telemetryCacheMode;
  }
  if (typeof patch.telemetryDefaultExpanded === 'boolean') {
    base.telemetryDefaultExpanded = patch.telemetryDefaultExpanded;
  }
  if (typeof patch.promptSuggestionModel === 'string') {
    const m = patch.promptSuggestionModel.trim();
    if (m && !m.startsWith('-') && VALID_SUGGEST_MODEL_RE.test(m)) {
      base.promptSuggestionModel = m;
    }
  }
  if (Array.isArray(patch.sshHosts)) {
    const out = [];
    const seen = new Set();
    for (const raw of patch.sshHosts) {
      const h = String(raw || '').trim();
      if (!h || h.startsWith('-') || !VALID_SSH_HOST_RE.test(h) || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
      if (out.length >= 32) break;
    }
    base.sshHosts = out;
  }

  if (patch.quotaBar && typeof patch.quotaBar === 'object') {
    base.quotaBar = normalizeQuotaBarConfig({
      ...(base.quotaBar && typeof base.quotaBar === 'object' ? base.quotaBar : {}),
      ...patch.quotaBar
    });
  }

  return base;
}

export function createBundleController({ safeMode = false, cliChannel = null, hasSqlite = false, cliOpts = {} } = {}) {
  let cachedBundleSig = '';
  let cachedInjectScript = '';
  let cachedPatchVersion = '';
  let activeConfig = {
    enabled: true,
    channel: 'auto',
    preset: 'codex-pure-white',
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    telemetryDefaultExpanded: false,
    contextLimit: 'auto',
    manualContextLimit: 0,
    fallbackContextLimit: 256000,
    promptSuggestionModel: 'gemini-3.8-flash-low',
    modules: {
      theme: true,
      i18n: true,
      metrics: Boolean(hasSqlite),
      quotaBar: true,
      sshRemote: false,
      promptSuggestions: false,
      deadlockHealer: true,
      zoomShortcuts: true,
      cdpAutoRelaunch: true,
      customCss: true,
      customJs: true
    },
    quotaBar: { ...DEFAULT_QUOTA_BAR_CONFIG },
    sshHosts: [],
    themeVars: {},
    selectors: {},
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
    endpoints: []
  };

  function rebuildBundleIfNeeded(force = false) {
    const styleFiles = listSortedFiles(STYLES_DIR, '.css');
    const runtimeFiles = listSortedFiles(RUNTIME_DIR, '.js');
    const coreFiles = [...styleFiles, path.join(CORE_DIR, 'i18n.json'), ...runtimeFiles];
    const userFiles = safeMode
      ? []
      : [
          path.join(USER_DIR, 'config.json'),
          path.join(USER_DIR, 'custom.css'),
          path.join(USER_DIR, 'i18n.override.json'),
          path.join(USER_DIR, 'custom.js')
        ];

    const sig =
      coreFiles.map(getFileMtimeSig).join('|') +
      '|' +
      userFiles.map(getFileMtimeSig).join('|') +
      `|safe:${safeMode}|cli:${cliChannel || ''}|sqlite:${hasSqlite}`;

    if (!force && sig === cachedBundleSig && cachedInjectScript) {
      return false;
    }

    const userCfg = safeMode ? {} : readJsonSafe(path.join(USER_DIR, 'config.json'), {});
    const enabled = safeMode ? true : userCfg.enabled !== false;
    const channel = cliChannel || userCfg.channel || 'auto';
    const presetRaw = String(userCfg.preset || 'codex-pure-white').trim();
    const preset = presetRaw === 'codex-dark' || presetRaw === 'onyx-dark' ? 'codex-dark' : 'codex-pure-white';
    const telemetryLayout = userCfg.telemetryLayout === 'detailed' ? 'detailed' : 'compact';
    const telemetryCacheMode = userCfg.telemetryCacheMode === 'step' ? 'step' : 'session';
    const telemetryDefaultExpanded = Boolean(userCfg.telemetryDefaultExpanded);

    const rawContextLimit = userCfg.contextLimit;
    const isAutoLimit =
      rawContextLimit === undefined ||
      rawContextLimit === null ||
      String(rawContextLimit).trim() === '' ||
      String(rawContextLimit).trim().toLowerCase() === 'auto';
    const manualContextLimit = !isAutoLimit && Number(rawContextLimit) > 0 ? Number(rawContextLimit) : 0;
    const fallbackContextLimit =
      Number(userCfg.fallbackContextLimit) > 0 ? Number(userCfg.fallbackContextLimit) : 256000;
    const contextLimit = manualContextLimit > 0 ? manualContextLimit : 'auto';

    const rawModules = Object.assign({}, userCfg.features || {}, userCfg.modules || {});
    if (typeof rawModules.metricsCapsule === 'boolean' && typeof rawModules.metrics !== 'boolean') {
      rawModules.metrics = rawModules.metricsCapsule;
    }
    const modules = Object.assign(
      {
        theme: true,
        i18n: true,
        metrics: true,
        quotaBar: true,
        sshRemote: false,
        promptSuggestions: false,
        deadlockHealer: true,
        zoomShortcuts: true,
        cdpAutoRelaunch: true,
        customCss: true,
        customJs: true
      },
      rawModules
    );
    const hasThemeFiles =
      fs.existsSync(path.join(STYLES_DIR, '10-light-codex.css')) ||
      fs.existsSync(path.join(STYLES_DIR, '00-base.css'));
    const hasI18nFiles =
      fs.existsSync(path.join(CORE_DIR, 'i18n.json')) &&
      fs.existsSync(path.join(RUNTIME_DIR, '60-i18n-engine.js'));
    const hasMetricsFiles =
      fs.existsSync(path.join(RUNTIME_DIR, '50-telemetry-ui.js')) &&
      fs.existsSync(path.join(CORE_DIR, 'daemon', 'sqlite-metrics.mjs'));
    const hasQuotaBarFiles = fs.existsSync(path.join(RUNTIME_DIR, '55-quota-bar.js'));
    const hasPromptSuggestFiles =
      fs.existsSync(path.join(RUNTIME_DIR, '70-prompt-suggestions.js')) &&
      fs.existsSync(path.join(CORE_DIR, 'daemon', 'prompt-suggest.mjs'));
    const hasGuardsFile = fs.existsSync(path.join(RUNTIME_DIR, '10-guards.js'));
    if (!hasThemeFiles) modules.theme = false;
    if (!hasI18nFiles) modules.i18n = false;
    if (!hasSqlite || !hasMetricsFiles) {
      modules.metrics = false;
      modules.sshRemote = false;
    }
    if (!hasQuotaBarFiles) modules.quotaBar = false;
    if (!hasPromptSuggestFiles) modules.promptSuggestions = false;
    if (!hasGuardsFile) {
      modules.deadlockHealer = false;
      modules.zoomShortcuts = false;
    }

    const quotaBar = safeMode ? { ...DEFAULT_QUOTA_BAR_CONFIG } : normalizeQuotaBarConfig(userCfg.quotaBar);

    const themeVars = !safeMode && userCfg.themeVars && typeof userCfg.themeVars === 'object' ? userCfg.themeVars : {};
    const endpoints = resolveActiveChannelEndpoints(channel, userCfg, cliOpts);

    const normalizedSelectors = Object.assign({}, userCfg.selectors || {});
    if (
      normalizedSelectors.branchPillInBox &&
      !String(normalizedSelectors.branchPillInBox).includes('project-branch-picker')
    ) {
      delete normalizedSelectors.branchPillInBox;
    }
    if (normalizedSelectors.homeGreeting && !String(normalizedSelectors.homeGreeting).includes('home-splash-content')) {
      delete normalizedSelectors.homeGreeting;
    }
    if (
      typeof normalizedSelectors.excludeI18n === 'string' &&
      normalizedSelectors.excludeI18n.trim() &&
      !normalizedSelectors.excludeI18n.includes('.monaco-editor')
    ) {
      normalizedSelectors.excludeI18n +=
        ', .monaco-editor, .monaco-diff-editor, .xterm, [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, [class*="onyx-key"]';
    }

    const rawPromptModel = typeof userCfg.promptSuggestionModel === 'string' ? userCfg.promptSuggestionModel.trim() : '';
    const promptSuggestionModel =
      rawPromptModel && !rawPromptModel.startsWith('-') && /^[a-zA-Z0-9._:/-]+$/.test(rawPromptModel)
        ? rawPromptModel
        : 'gemini-3.8-flash-low';

    activeConfig = {
      enabled,
      channel,
      preset,
      telemetryLayout,
      telemetryCacheMode,
      telemetryDefaultExpanded,
      contextLimit,
      manualContextLimit,
      fallbackContextLimit,
      promptSuggestionModel,
      modules,
      quotaBar,
      sshHosts: Array.isArray(userCfg.sshHosts) ? userCfg.sshHosts : [],
      themeVars,
      selectors: normalizedSelectors,
      allowedOrigins: Array.isArray(userCfg.allowedOrigins) ? userCfg.allowedOrigins : DEFAULT_ALLOWED_ORIGINS,
      endpoints
    };

    const activeStyleFiles = styleFiles.filter((filePath) => {
      const base = path.basename(filePath);
      if (base === '30-telemetry.css') return Boolean(modules.metrics);
      if (base === '35-quota-bar.css') return Boolean(modules.quotaBar);
      if (base === '40-prompt-suggestions.css') return Boolean(modules.promptSuggestions);
      if (base === '45-settings-ui.css') return Boolean(enabled);
      return modules.theme !== false;
    });
    const baseCss = activeStyleFiles.map((f) => readTextSafe(f, '')).join('\n\n');
    const customCss = !safeMode && modules.customCss ? readTextSafe(path.join(USER_DIR, 'custom.css'), '') : '';
    const baseDict = modules.i18n ? readJsonSafe(path.join(CORE_DIR, 'i18n.json'), {}) : {};
    const rawOverrideDict =
      modules.i18n && !safeMode ? readJsonSafe(path.join(USER_DIR, 'i18n.override.json'), {}) : {};
    const mergedDict = modules.i18n ? Object.assign({}, baseDict, normalizeOverrideDict(rawOverrideDict)) : {};
    const customJs = !safeMode && modules.customJs ? readTextSafe(path.join(USER_DIR, 'custom.js'), '') : '';
    const runtimeTemplate = runtimeFiles.map((f) => readTextSafe(f, '')).join('\n');

    const hash = crypto
      .createHash('sha256')
      .update(String(enabled))
      .update(runtimeTemplate)
      .update(baseCss)
      .update(customCss)
      .update(JSON.stringify(mergedDict))
      .update(customJs)
      .update(
        JSON.stringify({
          preset,
          telemetryLayout,
          telemetryCacheMode,
          telemetryDefaultExpanded,
          promptSuggestionModel,
          sshHosts: activeConfig.sshHosts,
          modules,
          quotaBar,
          themeVars,
          selectors: activeConfig.selectors
        })
      )
      .digest('hex')
      .slice(0, 8);

    const channelTag = channel === 'insiders' ? 'insiders' : 'stable';
    cachedPatchVersion = `${BASE_VERSION}-${channelTag}-${hash}`;

    const bootPayload = {
      version: cachedPatchVersion,
      platform: process.platform,
      enabled,
      preset,
      telemetryLayout,
      telemetryCacheMode,
      telemetryDefaultExpanded,
      quotaBar,
      cssText: baseCss,
      customCss,
      themeVars,
      i18nDict: mergedDict,
      modules,
      selectors: activeConfig.selectors,
      userConfig: {
        enabled,
        channel,
        preset,
        telemetryLayout,
        telemetryCacheMode,
        telemetryDefaultExpanded,
        contextLimit,
        promptSuggestionModel,
        sshHosts: activeConfig.sshHosts,
        modules,
        quotaBar,
        themeVars
      },
      customJs
    };

    cachedInjectScript = runtimeTemplate.replace(
      '})(__AG_BOOT_PAYLOAD__);',
      () => `})(${JSON.stringify(bootPayload)});`
    );
    cachedBundleSig = sig;
    return true;
  }

  function updateUserConfig(patch) {
    if (safeMode) return { ok: false, error: 'safeMode enabled' };
    const cfgPath = path.join(USER_DIR, 'config.json');
    try {
      fs.mkdirSync(USER_DIR, { recursive: true });
      const current = readJsonSafe(cfgPath, {});
      const next = sanitizeConfigPatch(current, patch);
      const serialized = JSON.stringify(next, null, 2) + '\n';
      const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      try {
        fs.renameSync(tmpPath, cfgPath);
      } catch {
        fs.writeFileSync(cfgPath, serialized, 'utf8');
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
      cachedBundleSig = '';
      rebuildBundleIfNeeded();
      return { ok: true, config: activeConfig };
    } catch (err) {
      return { ok: false, error: err?.message || String(err || 'write failed') };
    }
  }

  return {
    rebuildBundleIfNeeded,
    updateUserConfig,
    getState: () => ({
      activeConfig,
      cachedInjectScript,
      cachedPatchVersion
    })
  };
}
