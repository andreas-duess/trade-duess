#!/usr/bin/env node
/**
 * Fetches official U.S. Census International Trade export data (2021-2026 YTD)
 * and UN ComTrade global import / competitor data (2020 & 2024) for all curated
 * USAEDC cooperator commodity presets, writing compact static JSON shards to
 * public/data/.
 *
 * Requires ~/.config/secrets/CENSUS_API_KEY and ~/.config/secrets/COMTRADE_API_KEY
 * (or CENSUS_API_KEY / COMTRADE_API_KEY environment variables).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { COMMODITY_PRESETS } from '../src/data/presets.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const SHARDS_DIR = path.join(OUT_DIR, 'commodities');

const YEARS = [2021, 2022, 2023, 2024, 2025];
let YTD_YEAR = 2026;
let YTD_MONTH = '09'; // Auto-detected at runtime; fallback Sept 2026
let YTD_LABEL = 'Jan–Sep 2026';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function detectLatestCensusPeriod(censusKey) {
  const now = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const mm = String(m).padStart(2, '0');
    const url = `https://api.census.gov/data/timeseries/intltrade/exports/hs?get=ALL_VAL_YR&E_COMMODITY=080212&CTY_CODE=-&time=${y}-${mm}&key=${censusKey}`;
    try {
      const res = await fetch(url);
      if (res.ok && res.status !== 204) {
        const json = await res.json();
        if (Array.isArray(json) && json.length > 1 && Number(json[1][0]) > 0) {
          return {
            year: y,
            month: mm,
            label: m === 1 ? `Jan ${y}` : `Jan–${MONTH_NAMES[m - 1]} ${y}`,
          };
        }
      }
    } catch {
      // continue walking backwards
    }
  }
  return { year: YTD_YEAR, month: YTD_MONTH, label: YTD_LABEL };
}

async function loadSecret(name) {
  if (process.env[name]) return process.env[name].trim();
  const p = path.join(os.homedir(), '.config', 'secrets', name);
  return (await fs.readFile(p, 'utf8')).trim();
}

async function fetchJson(url, headers = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 204) return null;
      if (res.status === 429 || res.status >= 500) {
        const waitMs = 1200 * attempt;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status} for ${url.replace(/key=[^&]+/, 'key=***')}: ${txt.slice(0, 180)}`);
      }
      const text = await res.text();
      if (!text.trim()) return null;
      return JSON.parse(text);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 900 * attempt));
    }
  }
  return null;
}

function titleCaseCountry(raw) {
  if (!raw) return '';
  const map = {
    'UNITED ARAB EMIRATES': 'United Arab Emirates',
    'UNITED KINGDOM': 'United Kingdom',
    'KOREA, SOUTH': 'South Korea',
    'SOUTH KOREA': 'South Korea',
    'DOMINICAN REPUBLIC': 'Dominican Republic',
    'SAUDI ARABIA': 'Saudi Arabia',
    'SOUTH AFRICA': 'South Africa',
    'NEW ZEALAND': 'New Zealand',
    'COSTA RICA': 'Costa Rica',
    'EL SALVADOR': 'El Salvador',
    'HONG KONG': 'Hong Kong',
    'TRINIDAD AND TOBAGO': 'Trinidad & Tobago',
    'SRI LANKA': 'Sri Lanka',
    'CZECH REPUBLIC': 'Czechia',
    'TURKEY': 'Turkey',
    'TURKIYE': 'Turkey',
    'VIETNAM': 'Vietnam',
    'CHINA': 'China',
    'USA': 'United States',
  };
  const upper = raw.trim().toUpperCase();
  if (map[upper]) return map[upper];
  return upper
    .toLowerCase()
    .replace(/(^|\s|[-/(])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/\bOf\b/g, 'of')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bThe\b/g, 'the');
}

function titleCaseDistrict(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|\s|[-/(,])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/,\s*([a-z]{2})$/i, (_, st) => `, ${st.toUpperCase()}`);
}

/**
 * Census returns both real countries (numeric codes >= 1000) and regional/trade-bloc
 * aggregates (codes like "-", "0003", "0014", "0020", "0XXX", "1XXX" totals, etc.).
 */
function isRealCensusCountry(code, name) {
  if (!code || !name) return false;
  if (!/^\d{4}$/.test(code)) return false;
  if (code.startsWith('0')) return false;
  const upper = name.toUpperCase();
  if (
    upper.includes('TOTAL FOR ALL') ||
    upper.includes('NORTH AMERICA') ||
    upper.includes('SOUTH AMERICA') ||
    upper.includes('CENTRAL AMERICA') ||
    upper.includes('EUROPEAN UNION') ||
    upper.includes('EURO AREA') ||
    upper.includes('ASIA') ||
    upper.includes('AFRICA') && !upper.includes('SOUTH AFRICA') && !upper.includes('CENTRAL AFRICAN') ||
    upper.includes('OCEANIA') ||
    upper.includes('OECD') ||
    upper.includes('OPEC') ||
    upper.includes('APEC') ||
    upper.includes('ASEAN') ||
    upper.includes('CAFTA') ||
    upper.includes('USMCA') ||
    upper.includes('NATO') ||
    upper.includes('PACIFIC RIM') ||
    upper.includes('TWENTY LATIN') ||
    upper.includes('UNIDENTIFIED')
  ) {
    return false;
  }
  return true;
}

async function fetchCensusForHsCode(hsCode, censusKey) {
  const periods = [
    ...YEARS.map((y) => ({ key: String(y), time: `${y}-12` })),
    { key: 'ytdPrev', time: `${YTD_YEAR - 1}-${YTD_MONTH}` },
    { key: 'ytdCurr', time: `${YTD_YEAR}-${YTD_MONTH}` },
  ];

  // Fetch all 7 country snapshots in parallel
  const countryResults = await Promise.all(
    periods.map(async (p) => {
      const url = `https://api.census.gov/data/timeseries/intltrade/exports/hs?get=CTY_CODE,CTY_NAME,ALL_VAL_YR&E_COMMODITY=${hsCode}&time=${p.time}&key=${censusKey}`;
      const rows = await fetchJson(url);
      return { key: p.key, rows: Array.isArray(rows) ? rows.slice(1) : [] };
    })
  );

  // Fetch 2025 customs districts
  const distUrl = `https://api.census.gov/data/timeseries/intltrade/exports/hs?get=DISTRICT,DIST_NAME,ALL_VAL_YR&E_COMMODITY=${hsCode}&time=2025-12&key=${censusKey}`;
  const distRows = await fetchJson(distUrl);

  return {
    countryResults,
    districtRows: Array.isArray(distRows) ? distRows.slice(1) : [],
  };
}

function cleanComTradeName(name) {
  if (!name) return '';
  return name
    .replace(/^Rep\. of Korea$/i, 'South Korea')
    .replace(/^China, Hong Kong SAR$/i, 'Hong Kong')
    .replace(/^Viet Nam$/i, 'Vietnam')
    .replace(/^Türkiye$/i, 'Turkey')
    .replace(/^Russian Federation$/i, 'Russia')
    .replace(/^United Rep\. of Tanzania$/i, 'Tanzania')
    .replace(/^Bolivia \(Plurinational State of\)$/i, 'Bolivia')
    .replace(/^Iran \(Islamic Rep\. of\)$/i, 'Iran')
    .replace(/^Other Asia, nes$/i, 'Taiwan')
    .replace(/^USA$/i, 'United States');
}

async function fetchComTradeForPreset(preset, comtradeKey, reporterMap) {
  const cmdParam = preset.hsCodes.join(',');
  const headers = { 'Ocp-Apim-Subscription-Key': comtradeKey };

  // 1. World imports by every country (2020 and 2024)
  const worldUrl = `https://comtradeapi.un.org/data/v1/get/C/A/HS?period=2020,2024&cmdCode=${cmdParam}&flowCode=M&partnerCode=0&partner2Code=0&motCode=0&customsCode=C00`;
  const worldRes = await fetchJson(worldUrl, headers);

  // 2. Imports from USA by every country (2024)
  const usaUrl = `https://comtradeapi.un.org/data/v1/get/C/A/HS?period=2024&cmdCode=${cmdParam}&flowCode=M&partnerCode=842&partner2Code=0&motCode=0&customsCode=C00`;
  const usaRes = await fetchJson(usaUrl, headers);

  // 3. Top global exporters of this commodity (2024)
  const expUrl = `https://comtradeapi.un.org/data/v1/get/C/A/HS?period=2024&cmdCode=${cmdParam}&flowCode=X&partnerCode=0&partner2Code=0&motCode=0&customsCode=C00`;
  const expRes = await fetchJson(expUrl, headers);

  // Aggregate by reporterCode (summing across multiple HS codes in a basket)
  const byCountry = new Map();
  for (const row of worldRes?.data || []) {
    const code = String(row.reporterCode);
    if (code === '842' || code === '0') continue; // exclude USA as importer of itself & World
    const val = Number(row.primaryValue || 0);
    if (!val) continue;
    const entry = byCountry.get(code) || {
      code,
      name: cleanComTradeName(reporterMap.get(code) || `Country ${code}`),
      world2020: 0,
      world2024: 0,
      us2024: 0,
    };
    if (String(row.period) === '2020') entry.world2020 += val;
    if (String(row.period) === '2024') entry.world2024 += val;
    byCountry.set(code, entry);
  }

  for (const row of usaRes?.data || []) {
    const code = String(row.reporterCode);
    if (code === '842' || code === '0') continue;
    const val = Number(row.primaryValue || 0);
    const entry = byCountry.get(code);
    if (entry) entry.us2024 += val;
  }

  // Build clean market records (only countries with meaningful 2024 imports >= $5M or top 60)
  const allMarkets = [...byCountry.values()]
    .filter((m) => m.world2024 > 0)
    .sort((a, b) => b.world2024 - a.world2024)
    .slice(0, 65)
    .map((m) => {
      const usSharePct = m.world2024 > 0 ? Math.min(100, Number(((m.us2024 / m.world2024) * 100).toFixed(1))) : 0;
      const growth4yPct =
        m.world2020 > 500_000
          ? Number((((m.world2024 - m.world2020) / m.world2020) * 100).toFixed(1))
          : null;
      return {
        code: m.code,
        name: m.name,
        world2024: Math.round(m.world2024),
        world2020: Math.round(m.world2020),
        us2024: Math.round(m.us2024),
        usSharePct,
        growth4yPct,
      };
    });

  // Top global rival exporters (2024)
  const exportersMap = new Map();
  let globalExportTotal = 0;
  for (const row of expRes?.data || []) {
    const code = String(row.reporterCode);
    if (code === '0') continue;
    const val = Number(row.primaryValue || 0);
    if (!val) continue;
    globalExportTotal += val;
    const prev = exportersMap.get(code) || {
      code,
      name: cleanComTradeName(reporterMap.get(code) || `Country ${code}`),
      isUS: code === '842',
      value2024: 0,
    };
    prev.value2024 += val;
    exportersMap.set(code, prev);
  }

  const topGlobalExporters = [...exportersMap.values()]
    .sort((a, b) => b.value2024 - a.value2024)
    .slice(0, 10)
    .map((e) => ({
      name: e.name,
      isUS: e.isUS,
      value2024: Math.round(e.value2024),
      sharePct: globalExportTotal > 0 ? Number(((e.value2024 / globalExportTotal) * 100).toFixed(1)) : 0,
    }));

  return {
    year: 2024,
    baselineYear: 2020,
    markets: allMarkets,
    topGlobalExporters,
  };
}

async function buildPreset(preset, censusKey, comtradeKey, reporterMap) {
  // 1. Aggregate Census data across all HS codes in preset
  const totalsByYear = Object.fromEntries(YEARS.map((y) => [String(y), 0]));
  let totalYtdPrev = 0;
  let totalYtdCurr = 0;

  const countriesMap = new Map(); // ctyCode -> { code, name, byYear: {2021..2025}, ytdPrev, ytdCurr }
  const districtsMap = new Map(); // distCode -> { code, name, value2025 }

  for (const hsCode of preset.hsCodes) {
    const { countryResults, districtRows } = await fetchCensusForHsCode(hsCode, censusKey);

    for (const { key, rows } of countryResults) {
      for (const row of rows) {
        const [ctyCode, ctyName, valStr] = row;
        const val = Number(valStr || 0);
        if (!val) continue;

        if (ctyCode === '-') {
          if (key === 'ytdPrev') totalYtdPrev += val;
          else if (key === 'ytdCurr') totalYtdCurr += val;
          else totalsByYear[key] += val;
          continue;
        }

        if (!isRealCensusCountry(ctyCode, ctyName)) continue;

        const entry = countriesMap.get(ctyCode) || {
          code: ctyCode,
          name: titleCaseCountry(ctyName),
          byYear: Object.fromEntries(YEARS.map((y) => [String(y), 0])),
          ytdPrev: 0,
          ytdCurr: 0,
        };
        if (key === 'ytdPrev') entry.ytdPrev += val;
        else if (key === 'ytdCurr') entry.ytdCurr += val;
        else entry.byYear[key] += val;
        countriesMap.set(ctyCode, entry);
      }
    }

    for (const row of districtRows) {
      const [distCode, distName, valStr] = row;
      const val = Number(valStr || 0);
      if (!val || !distCode || distCode === '-') continue;
      const entry = districtsMap.get(distCode) || {
        code: distCode,
        name: titleCaseDistrict(distName),
        value2025: 0,
      };
      entry.value2025 += val;
      districtsMap.set(distCode, entry);
    }
  }

  // Fallback totals if Census didn't emit '-' row
  for (const y of YEARS) {
    const k = String(y);
    if (!totalsByYear[k]) {
      totalsByYear[k] = [...countriesMap.values()].reduce((s, c) => s + c.byYear[k], 0);
    }
  }
  if (!totalYtdPrev) totalYtdPrev = [...countriesMap.values()].reduce((s, c) => s + c.ytdPrev, 0);
  if (!totalYtdCurr) totalYtdCurr = [...countriesMap.values()].reduce((s, c) => s + c.ytdCurr, 0);

  const destinations = [...countriesMap.values()]
    .filter((c) => c.byYear['2025'] > 0 || c.ytdCurr > 0)
    .sort((a, b) => b.byYear['2025'] - a.byYear['2025'])
    .slice(0, 40)
    .map((c) => {
      const v25 = c.byYear['2025'];
      const v24 = c.byYear['2024'];
      const v21 = c.byYear['2021'];
      return {
        code: c.code,
        name: c.name,
        byYear: c.byYear,
        ytdPrev: c.ytdPrev,
        ytdCurr: c.ytdCurr,
        share2025Pct: totalsByYear['2025'] > 0 ? Number(((v25 / totalsByYear['2025']) * 100).toFixed(1)) : 0,
        yoyPct: v24 > 0 ? Number((((v25 - v24) / v24) * 100).toFixed(1)) : null,
        chg5yPct: v21 > 0 ? Number((((v25 - v21) / v21) * 100).toFixed(1)) : null,
      };
    });

  const districts = [...districtsMap.values()]
    .sort((a, b) => b.value2025 - a.value2025)
    .slice(0, 12)
    .map((d) => ({
      code: d.code,
      name: d.name,
      value2025: d.value2025,
      share2025Pct: totalsByYear['2025'] > 0 ? Number(((d.value2025 / totalsByYear['2025']) * 100).toFixed(1)) : 0,
    }));

  // 2. Fetch UN ComTrade global import demand & competitor share
  const whitespace = await fetchComTradeForPreset(preset, comtradeKey, reporterMap);

  const v25 = totalsByYear['2025'];
  const v24 = totalsByYear['2024'];
  const v21 = totalsByYear['2021'];

  return {
    ...preset,
    updatedAt: new Date().toISOString().slice(0, 10),
    ytdLabel: YTD_LABEL,
    summary: {
      total2025: v25,
      yoyPct: v24 > 0 ? Number((((v25 - v24) / v24) * 100).toFixed(1)) : null,
      chg5yPct: v21 > 0 ? Number((((v25 - v21) / v21) * 100).toFixed(1)) : null,
      ytdCurr: totalYtdCurr,
      ytdPrev: totalYtdPrev,
      ytdYoyPct: totalYtdPrev > 0 ? Number((((totalYtdCurr - totalYtdPrev) / totalYtdPrev) * 100).toFixed(1)) : null,
      topDestination: destinations[0]?.name || null,
      topDistrict: districts[0]?.name || null,
    },
    totalsByYear,
    destinations,
    districts,
    whitespace,
  };
}

async function main() {
  const censusKey = await loadSecret('CENSUS_API_KEY');
  const comtradeKey = await loadSecret('COMTRADE_API_KEY');

  const latest = await detectLatestCensusPeriod(censusKey);
  YTD_YEAR = latest.year;
  YTD_MONTH = latest.month;
  YTD_LABEL = latest.label;
  console.log(`Latest U.S. Census monthly release detected: ${YTD_YEAR}-${YTD_MONTH} (${YTD_LABEL})`);

  await fs.mkdir(SHARDS_DIR, { recursive: true });

  console.log('Fetching UN ComTrade country reference table...');
  const ref = await fetchJson('https://comtradeapi.un.org/files/v1/app/reference/Reporters.json');
  const reporterMap = new Map();
  for (const r of ref?.results || []) {
    reporterMap.set(String(r.id), r.text);
  }
  console.log(`Loaded ${reporterMap.size} ComTrade reporter names.\n`);

  const indexList = [];

  for (const preset of COMMODITY_PRESETS) {
    process.stdout.write(`Fetching ${preset.name.padEnd(32)} (${preset.hsLabel})... `);
    const data = await buildPreset(preset, censusKey, comtradeKey, reporterMap);
    await fs.writeFile(path.join(SHARDS_DIR, `${preset.id}.json`), JSON.stringify(data));

    const valM = (data.summary.total2025 / 1e6).toFixed(0);
    const yoy = data.summary.yoyPct != null ? `${data.summary.yoyPct >= 0 ? '+' : ''}${data.summary.yoyPct}%` : 'n/a';
    console.log(`$${valM}M (${yoy} YoY) | Top: ${data.summary.topDestination} | ${data.whitespace.markets.length} global markets`);

    indexList.push({
      id: data.id,
      name: data.name,
      sector: data.sector,
      cooperator: data.cooperator,
      hsLabel: data.hsLabel,
      total2025: data.summary.total2025,
      yoyPct: data.summary.yoyPct,
      topDestination: data.summary.topDestination,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString().slice(0, 10),
    censusLatestMonth: `${YTD_YEAR}-${YTD_MONTH}`,
    ytdLabel: YTD_LABEL,
    comtradeYear: 2024,
    commodities: indexList,
  };

  await fs.writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone! Wrote ${indexList.length} commodity shards to public/data/commodities/.`);
}

main().catch((err) => {
  console.error('\nFetch failed:', err);
  process.exit(1);
});
