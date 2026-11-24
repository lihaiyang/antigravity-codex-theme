/**
 * core/daemon/global-stats.mjs — Cached All-Conversation SQLite Token Aggregator
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseGenMetadataRow, extractStepStartMs } from './protobuf.mjs';
import { getDbSignature } from './sqlite-metrics.mjs';

function formatLocalDateIso(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLocalDayStartMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function createGlobalStatsReader({ getDatabaseSync }) {
  const dbCache = new Map();

  function parseSingleConversationDb(dbPath, sig, DatabaseSync) {
    let db = null;
    try {
      const stat = fs.statSync(dbPath, { throwIfNoEntry: false });
      const fallbackMs = stat ? stat.mtimeMs : Date.now();
      db = new DatabaseSync(dbPath, { readOnly: true, timeout: 200 });

      const stepTsMap = new Map();
      let lastStepTs = 0;
      try {
        const stepRows = db.prepare('SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL').all();
        for (let i = 0; i < stepRows.length; i++) {
          const r = stepRows[i];
          const ts = extractStepStartMs(r.metadata);
          if (ts > 0) {
            stepTsMap.set(r.idx, ts);
            if (ts > lastStepTs) lastStepTs = ts;
          }
        }
      } catch {}

      const gens = [];
      let genRows = [];
      try {
        genRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      } catch {
        genRows = [];
      }

      let maxGenTs = lastStepTs || fallbackMs;
      for (let i = 0; i < genRows.length; i++) {
        const p = parseGenMetadataRow(genRows[i]);
        if (p.ctx <= 0 && p.outTok <= 0) continue;
        const tsMs = (p.maxStepIdx >= 0 && stepTsMap.get(p.maxStepIdx)) || lastStepTs || fallbackMs;
        if (tsMs > maxGenTs) maxGenTs = tsMs;
        gens.push({
          tsMs,
          inTok: p.inTok,
          cacheWrite: p.cacheWrite,
          cacheRead: p.cacheRead,
          outTok: p.outTok,
          thinkTok: p.thinkTok,
          respTok: p.respTok,
          modelName: p.modelName || 'Unknown'
        });
      }

      return { sig, gens, lastTsMs: maxGenTs };
    } catch {
      return null;
    } finally {
      if (db) {
        try {
          db.close();
        } catch {}
      }
    }
  }

  function getGlobalStats(conversationsDir, { range = 'all', force = false } = {}) {
    const DatabaseSync = typeof getDatabaseSync === 'function' ? getDatabaseSync() : null;
    if (!DatabaseSync) {
      return { ok: false, error: 'node:sqlite unavailable' };
    }
    if (!conversationsDir || !fs.existsSync(conversationsDir)) {
      return { ok: false, error: 'conversations directory not found' };
    }

    const validRange = range === 'today' || range === '7d' || range === '30d' ? range : 'all';
    let entries;
    try {
      entries = fs.readdirSync(conversationsDir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, error: err?.message || 'failed to read conversations directory' };
    }

    const dbFiles = [];
    const livePaths = new Set();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.isFile() || !e.name.endsWith('.db')) continue;
      const fullPath = path.join(conversationsDir, e.name);
      const cid = e.name.slice(0, -3);
      dbFiles.push({ cid, fullPath });
      livePaths.add(fullPath);
    }

    for (const cachedPath of dbCache.keys()) {
      if (!livePaths.has(cachedPath)) {
        dbCache.delete(cachedPath);
      }
    }

    for (let i = 0; i < dbFiles.length; i++) {
      const { cid, fullPath } = dbFiles[i];
      const sig = getDbSignature(cid, conversationsDir);
      if (!sig) continue;
      const prev = dbCache.get(fullPath);
      if (!force && prev && prev.sig === sig) continue;
      const parsed = parseSingleConversationDb(fullPath, sig, DatabaseSync);
      if (parsed) {
        dbCache.set(fullPath, parsed);
      }
    }

    const nowMs = Date.now();
    const todayStartMs = getLocalDayStartMs(nowMs);
    let cutoffMs = 0;
    if (validRange === 'today') cutoffMs = todayStartMs;
    else if (validRange === '7d') cutoffMs = nowMs - 7 * 86400000;
    else if (validRange === '30d') cutoffMs = nowMs - 30 * 86400000;

    let activeConversations = 0;
    let totalGenerations = 0;
    let totalIn = 0;
    let totalCacheWrite = 0;
    let totalCacheRead = 0;
    let totalOut = 0;
    let totalThink = 0;
    let totalResp = 0;

    const modelMap = new Map();
    const convList = [];

    const dailyDays = validRange === 'today' || validRange === '7d' ? 7 : 14;
    const dailyBuckets = new Map();
    const dailyOrder = [];
    for (let d = dailyDays - 1; d >= 0; d--) {
      const ms = todayStartMs - d * 86400000;
      const iso = formatLocalDateIso(ms);
      const bucket = {
        iso,
        date: iso.slice(5),
        totalTokens: 0,
        totalPrompt: 0,
        totalOut: 0,
        gens: 0
      };
      dailyBuckets.set(iso, bucket);
      dailyOrder.push(bucket);
    }

    for (let i = 0; i < dbFiles.length; i++) {
      const { cid, fullPath } = dbFiles[i];
      const entry = dbCache.get(fullPath);
      if (!entry || !Array.isArray(entry.gens) || entry.gens.length === 0) continue;

      let convGens = 0;
      let convIn = 0;
      let convCacheWrite = 0;
      let convCacheRead = 0;
      let convOut = 0;
      let convLastTs = 0;

      for (let j = 0; j < entry.gens.length; j++) {
        const g = entry.gens[j];
        if (cutoffMs > 0 && g.tsMs < cutoffMs) continue;

        convGens += 1;
        convIn += g.inTok;
        convCacheWrite += g.cacheWrite;
        convCacheRead += g.cacheRead;
        convOut += g.outTok;
        if (g.tsMs > convLastTs) convLastTs = g.tsMs;

        totalGenerations += 1;
        totalIn += g.inTok;
        totalCacheWrite += g.cacheWrite;
        totalCacheRead += g.cacheRead;
        totalOut += g.outTok;
        totalThink += g.thinkTok;
        totalResp += g.respTok;

        const gPrompt = g.inTok + g.cacheWrite + g.cacheRead;
        const gTotal = gPrompt + g.outTok;

        const mName = g.modelName || 'Unknown';
        let mAgg = modelMap.get(mName);
        if (!mAgg) {
          mAgg = {
            name: mName,
            gens: 0,
            totalTokens: 0,
            inTok: 0,
            cacheWrite: 0,
            cacheRead: 0,
            outTok: 0,
            thinkTok: 0
          };
          modelMap.set(mName, mAgg);
        }
        mAgg.gens += 1;
        mAgg.totalTokens += gTotal;
        mAgg.inTok += g.inTok;
        mAgg.cacheWrite += g.cacheWrite;
        mAgg.cacheRead += g.cacheRead;
        mAgg.outTok += g.outTok;
        mAgg.thinkTok += g.thinkTok;

        const iso = formatLocalDateIso(g.tsMs);
        const dayBucket = dailyBuckets.get(iso);
        if (dayBucket) {
          dayBucket.totalTokens += gTotal;
          dayBucket.totalPrompt += gPrompt;
          dayBucket.totalOut += g.outTok;
          dayBucket.gens += 1;
        }
      }

      if (convGens > 0) {
        activeConversations += 1;
        const convPrompt = convIn + convCacheWrite + convCacheRead;
        const convTotal = convPrompt + convOut;
        convList.push({
          id: cid,
          shortId: cid.slice(0, 8),
          lastTsMs: convLastTs || entry.lastTsMs,
          gens: convGens,
          totalTokens: convTotal,
          outTok: convOut,
          cacheHitRate: convPrompt > 0 ? Number(((convCacheRead / convPrompt) * 100).toFixed(1)) : 0
        });
      }
    }

    const totalPrompt = totalIn + totalCacheWrite + totalCacheRead;
    const totalTokens = totalPrompt + totalOut;
    const cacheHitRate = totalPrompt > 0 ? Number(((totalCacheRead / totalPrompt) * 100).toFixed(1)) : 0;

    const models = Array.from(modelMap.values())
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((m) => ({
        ...m,
        sharePct: totalTokens > 0 ? Number(((m.totalTokens / totalTokens) * 100).toFixed(1)) : 0
      }));

    const topConversations = convList.sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5);

    return {
      ok: true,
      range: validRange,
      scannedFiles: dbFiles.length,
      activeConversations,
      totalGenerations,
      totalIn,
      totalCacheWrite,
      totalCacheRead,
      totalPrompt,
      totalOut,
      totalThink,
      totalResp,
      totalTokens,
      cacheHitRate,
      daily: dailyOrder,
      models,
      topConversations,
      computedAt: nowMs
    };
  }

  return { getGlobalStats };
}
