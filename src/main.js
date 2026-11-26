import './styles.css';
import { COMMODITY_PRESETS } from './data/presets.js';
import {
  formatMoney,
  formatPct,
  pctClass,
  rankWhitespaceMarkets,
  buildScorecardTsv,
  buildWhitespaceTsv,
  buildScorecardCsv,
  buildWhitespaceCsv,
} from './engine/formatters.js';
import { renderTrendChartSvg, renderWhitespaceSvg } from './engine/charts.js';

const ARROW_RIGHT = `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const CHEVRON_DOWN = `<svg class="hero-qa-chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const HERO_FAQS = [
  {
    q: 'Where does the data come from?',
    a: 'U.S. export totals, destination tables, and customs-district breakdowns come from the official U.S. Census Bureau International Trade API (the same upstream dataset that feeds USDA GATS), current through September 2026. Global import demand, U.S. market share, and global exporter rankings come from UN ComTrade (2020 and 2024 annual HS data).',
  },
  {
    q: 'How do I share a commodity view with my board or team?',
    a: 'Every commodity, country filter, and tab updates the page URL automatically, so you can send a direct link such as trade.duess.com/?commodity=rice. Use "Copy table for PowerPoint / UES" to paste clean formatted columns straight into slides, Excel, or Word.',
  },
  {
    q: 'Can I add another commodity or HS code?',
    a: 'The tool currently covers 24 curated USAEDC cooperator commodity baskets. If your organization tracks a different HS4 or HS6 code, email andreas@duess.com and I will add it.',
  },
];

const SECTORS = [...new Set(COMMODITY_PRESETS.map((p) => p.sector))];

const shardCache = new Map();

const state = {
  commodityId: 'almonds',
  tab: 'scorecard', // 'scorecard' | 'whitespace'
  destinationCode: '', // '' = all destinations
  showAllDestinations: false,
  xMode: 'size', // 'size' | 'growth'
  maxUsShare: 15,
  selectedMarketCode: null,
  loading: true,
  error: '',
  data: null,
  copiedWhat: '',
  openFaqs: new Set(),
};

const app = document.getElementById('app');

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const c = params.get('commodity');
  if (c && COMMODITY_PRESETS.some((p) => p.id === c)) {
    state.commodityId = c;
  }
  const t = params.get('tab');
  if (t === 'whitespace' || t === 'scorecard') {
    state.tab = t;
  }
  const dest = params.get('dest');
  if (dest) state.destinationCode = dest;
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set('commodity', state.commodityId);
  if (state.tab !== 'scorecard') params.set('tab', state.tab);
  if (state.destinationCode && state.tab === 'scorecard') params.set('dest', state.destinationCode);
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', next);
}

async function loadCommodity(id) {
  state.commodityId = id;
  state.destinationCode = '';
  state.showAllDestinations = false;
  state.selectedMarketCode = null;
  state.error = '';
  syncUrl();

  if (shardCache.has(id)) {
    state.data = shardCache.get(id);
    state.loading = false;
    selectDefaultWhitespaceMarket();
    render();
    return;
  }

  state.loading = true;
  render();

  try {
    const res = await fetch(`/data/commodities/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error(`Could not load dataset (${res.status}).`);
    const json = await res.json();
    shardCache.set(id, json);
    state.data = json;
    state.loading = false;
    selectDefaultWhitespaceMarket();
    render();
  } catch (err) {
    state.loading = false;
    state.error = err?.message || 'Could not load trade data.';
    render();
  }
}

function selectDefaultWhitespaceMarket() {
  if (!state.data?.whitespace?.markets?.length) {
    state.selectedMarketCode = null;
    return;
  }
  const ranked = rankWhitespaceMarkets(state.data.whitespace.markets, {
    maxUsShare: state.maxUsShare,
    minMarketSize: 5_000_000,
  });
  state.selectedMarketCode = ranked[0]?.code || state.data.whitespace.markets[0]?.code || null;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    state.copiedWhat = label;
    render();
    setTimeout(() => {
      state.copiedWhat = '';
      render();
    }, 2200);
  } catch {
    downloadBlob(text, `trade-duess-${state.commodityId}.txt`, 'text/plain;charset=utf-8');
  }
}

function renderScorecardTab(data) {
  const activeDest = state.destinationCode
    ? data.destinations.find((d) => d.code === state.destinationCode) || null
    : null;

  const byYear = activeDest ? activeDest.byYear : data.totalsByYear;
  const total2025 = byYear['2025'] || 0;
  const total2024 = byYear['2024'] || 0;
  const total2021 = byYear['2021'] || 0;
  const yoyPct = total2024 > 0 ? Number((((total2025 - total2024) / total2024) * 100).toFixed(1)) : null;
  const chg5yPct = total2021 > 0 ? Number((((total2025 - total2021) / total2021) * 100).toFixed(1)) : null;
  const ytdCurr = activeDest ? activeDest.ytdCurr : data.summary.ytdCurr;
  const ytdPrev = activeDest ? activeDest.ytdPrev : data.summary.ytdPrev;
  const ytdYoyPct = ytdPrev > 0 ? Number((((ytdCurr - ytdPrev) / ytdPrev) * 100).toFixed(1)) : null;

  const destLimit = state.showAllDestinations ? 25 : 10;
  const visibleDestinations = data.destinations.slice(0, destLimit);

  const chartSvg = renderTrendChartSvg({
    byYear,
    ytdCurr,
    ytdLabel: data.ytdLabel,
    title: `${data.name} U.S. exports${activeDest ? ` to ${activeDest.name}` : ''}`,
  });

  const maxDistrict = Math.max(...data.districts.map((d) => d.value2025), 1);

  return `
    <div class="commodity-head">
      <div>
        <div class="commodity-meta">
          <span class="hs-badge">${esc(data.hsLabel)}</span>
          <span class="coop-label">${esc(data.cooperator)}</span>
        </div>
        <h2 class="commodity-title">${esc(data.name)}${activeDest ? ` → ${esc(activeDest.name)}` : ''}</h2>
        <p class="commodity-note">${esc(data.note)}</p>
        ${
          activeDest
            ? `<button type="button" class="dest-filter-pill" data-action="clear-dest">Filtered to ${esc(activeDest.name)} (${activeDest.share2025Pct}% of U.S. exports) · Clear ×</button>`
            : ''
        }
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-ink" data-action="copy-scorecard">
          <span>${state.copiedWhat === 'scorecard' ? '✓ Table copied' : 'Copy table for PowerPoint / UES'}</span>
          ${state.copiedWhat === 'scorecard' ? '' : ARROW_RIGHT}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="download-csv">Download CSV</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="copy-link">
          ${state.copiedWhat === 'link' ? '✓ Link copied' : 'Copy link'}
        </button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-tile">
        <div class="kpi-val">${esc(formatMoney(total2025))}</div>
        <div class="kpi-name">2025 Full-Year Exports</div>
        <div class="kpi-sub">${activeDest ? `${activeDest.share2025Pct}% of total U.S. exports` : `Top market: ${esc(data.summary.topDestination || '—')}`}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val ${pctClass(yoyPct)}">${esc(formatPct(yoyPct))}</div>
        <div class="kpi-name">YoY Change (2024–25)</div>
        <div class="kpi-sub">Prior year: ${esc(formatMoney(total2024))}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val ${pctClass(chg5yPct)}">${esc(formatPct(chg5yPct))}</div>
        <div class="kpi-name">5-Year Change (2021–25)</div>
        <div class="kpi-sub">2021 baseline: ${esc(formatMoney(total2021))}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val">${esc(formatMoney(ytdCurr))}</div>
        <div class="kpi-name">${esc(data.ytdLabel)}</div>
        <div class="kpi-sub"><span class="delta-pill ${pctClass(ytdYoyPct)}">${esc(formatPct(ytdYoyPct))} vs. prior YTD</span></div>
      </div>
    </div>

    <div class="section-block">
      <div class="block-head">
        <div>
          <h3>5-Year Export Trend${activeDest ? ` (${esc(activeDest.name)})` : ''}</h3>
          <p class="block-sub">Annual U.S. export value (USD) from 2021 to 2025, plus ${esc(data.ytdLabel)} year-to-date.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="download-svg">Download chart SVG</button>
      </div>
      <div class="chart-frame" id="trend-chart-container">${chartSvg}</div>
    </div>

    <div class="two-col">
      <div>
        <div class="block-head">
          <div>
            <h3>Top ${destLimit} Export Destinations (2025)</h3>
            <p class="block-sub">Click any country row to filter the scorecard above.</p>
          </div>
          ${
            data.destinations.length > 10
              ? `<button type="button" class="btn btn-ghost btn-sm" data-action="toggle-dest-limit">${state.showAllDestinations ? 'Show top 10' : 'Show top 25'}</button>`
              : ''
          }
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Destination</th>
                <th class="num">2025 Exports</th>
                <th class="num">Share</th>
                <th class="num">YoY</th>
                <th class="num">5-Yr</th>
              </tr>
            </thead>
            <tbody>
              ${visibleDestinations
                .map(
                  (d, idx) => `
                  <tr class="is-clickable ${state.destinationCode === d.code ? 'is-selected' : ''}" data-select-dest="${esc(d.code)}">
                    <td class="rank-cell">${idx + 1}</td>
                    <td class="country-name">${esc(d.name)}</td>
                    <td class="num">${esc(formatMoney(d.byYear['2025']))}</td>
                    <td class="num">${d.share2025Pct.toFixed(1)}%</td>
                    <td class="num ${pctClass(d.yoyPct)}">${esc(formatPct(d.yoyPct))}</td>
                    <td class="num ${pctClass(d.chg5yPct)}">${esc(formatPct(d.chg5yPct))}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="block-head">
          <div>
            <h3>U.S. Customs Districts (2025)</h3>
            <p class="block-sub">Primary U.S. ports and border crossings shipping ${esc(data.name.toLowerCase())}.</p>
          </div>
        </div>
        <div class="bar-list">
          ${data.districts
            .slice(0, 10)
            .map((dist, idx) => {
              const pctW = Math.max(2, (dist.value2025 / maxDistrict) * 100);
              return `
                <div>
                  <div class="bar-row-top">
                    <span class="bar-label">${esc(dist.name)}</span>
                    <span class="bar-val">${esc(formatMoney(dist.value2025))} (${dist.share2025Pct.toFixed(1)}%)</span>
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill ${idx === 0 ? 'is-amber' : ''}" style="width:${pctW.toFixed(1)}%"></div>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    </div>

    <p class="source-foot">Source: U.S. Census Bureau International Trade API (${esc(data.hsLabel)}, updated ${esc(data.updatedAt)}). Values in nominal U.S. dollars (FAS basis).</p>
  `;
}

function renderWhitespaceTab(data) {
  const ws = data.whitespace;
  const markets = ws?.markets || [];
  const ranked = rankWhitespaceMarkets(markets, {
    maxUsShare: state.maxUsShare,
    minMarketSize: 5_000_000,
  });

  const selected =
    markets.find((m) => m.code === state.selectedMarketCode) ||
    ranked[0] ||
    markets[0] ||
    null;

  const chartSvg = renderWhitespaceSvg({
    markets,
    xMode: state.xMode,
    maxUsShare: state.maxUsShare,
    selectedCode: selected?.code || null,
  });

  const maxExporterVal = Math.max(...(ws?.topGlobalExporters || []).map((e) => e.value2024), 1);

  return `
    <div class="commodity-head">
      <div>
        <div class="commodity-meta">
          <span class="hs-badge">${esc(data.hsLabel)}</span>
          <span class="coop-label">UN ComTrade Global Imports (${ws?.year || 2024})</span>
        </div>
        <h2 class="commodity-title">Untapped Import Markets: ${esc(data.name)}</h2>
        <p class="commodity-note">Every bubble is an importing country. Amber bubbles in the shaded lower-right zone are large or growing import markets where current U.S. share is at or below ${state.maxUsShare}% (subject to tariffs or access rules).</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-ink" data-action="copy-whitespace">
          <span>${state.copiedWhat === 'whitespace' ? '✓ Table copied' : 'Copy whitespace table'}</span>
          ${state.copiedWhat === 'whitespace' ? '' : ARROW_RIGHT}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="download-ws-csv">Download CSV</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="copy-link">
          ${state.copiedWhat === 'link' ? '✓ Link copied' : 'Copy link'}
        </button>
      </div>
    </div>

    <div class="ws-controls">
      <div class="tab-switcher" role="group" aria-label="X-axis mode">
        <button type="button" class="tab-btn ${state.xMode === 'size' ? 'is-active' : ''}" data-xmode="size">By Market Size ($)</button>
        <button type="button" class="tab-btn ${state.xMode === 'growth' ? 'is-active' : ''}" data-xmode="growth">By 4-Year Growth (%)</button>
      </div>
      <div class="field-stack" style="min-width: 210px">
        <label for="share-threshold">Whitespace ceiling</label>
        <select id="share-threshold" data-select="maxUsShare">
          ${[10, 15, 25, 35]
            .map((n) => `<option value="${n}" ${state.maxUsShare === n ? 'selected' : ''}>U.S. share ≤ ${n}%</option>`)
            .join('')}
        </select>
      </div>
    </div>

    <div class="ws-grid">
      <div class="chart-frame chart-frame-ws" id="ws-chart-frame">
        ${chartSvg}
        <div class="chart-tooltip" id="ws-tooltip" hidden></div>
      </div>

      <aside class="detail-card">
        <p class="eyebrow"><span class="dash" aria-hidden="true"></span>Selected import market</p>
        <div class="market-picker">
          <select aria-label="Select import market" data-select="whitespaceMarket">
            ${[...markets]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(
                (m) =>
                  `<option value="${esc(m.code)}" ${selected?.code === m.code ? 'selected' : ''}>${esc(m.name)} (${esc(formatMoney(m.world2024))} · ${m.usSharePct.toFixed(1)}% U.S.)</option>`
              )
              .join('')}
          </select>
        </div>
        ${
          selected
            ? `
          <div class="detail-stats">
            <div class="detail-stat">
              <div class="detail-stat-val">${esc(formatMoney(selected.world2024))}</div>
              <div class="detail-stat-lbl">2024 Total Imports</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val">${selected.usSharePct.toFixed(1)}%</div>
              <div class="detail-stat-lbl">U.S. Market Share</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val">${esc(formatMoney(selected.us2024))}</div>
              <div class="detail-stat-lbl">Imported From U.S.</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val ${pctClass(selected.growth4yPct)}">${esc(formatPct(selected.growth4yPct))}</div>
              <div class="detail-stat-lbl">4-Yr Growth (2020–24)</div>
            </div>
          </div>
        `
            : `<p class="block-sub">Pick a market above or hover any bubble on the chart.</p>`
        }

        <div class="rivals-box">
          <h5>Top Global Exporters of ${esc(data.name)} (2024)</h5>
          <div class="bar-list">
            ${(ws?.topGlobalExporters || [])
              .slice(0, 7)
              .map((exp) => {
                const pctW = Math.max(3, (exp.value2024 / maxExporterVal) * 100);
                return `
                  <div>
                    <div class="bar-row-top">
                      <span class="bar-label">${esc(exp.name)}${exp.isUS ? ' ★' : ''}</span>
                      <span class="bar-val">${esc(formatMoney(exp.value2024))} (${exp.sharePct}%)</span>
                    </div>
                    <div class="bar-track">
                      <div class="bar-fill ${exp.isUS ? 'is-amber' : ''}" style="width:${pctW.toFixed(1)}%"></div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      </aside>
    </div>

    <div class="section-block">
      <div class="block-head">
        <div>
          <h3>Top Untapped Import Markets (U.S. Share ≤ ${state.maxUsShare}%)</h3>
          <p class="block-sub">Ranked by uncaptured non-U.S. import value weighted by 4-year market growth. Click any row to highlight on the chart.</p>
        </div>
      </div>
      ${
        ranked.length
          ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Importing Market</th>
                <th class="num">2024 Total Imports</th>
                <th class="num">From U.S.</th>
                <th class="num">U.S. Share</th>
                <th class="num">4-Yr Growth</th>
              </tr>
            </thead>
            <tbody>
              ${ranked
                .slice(0, 15)
                .map(
                  (m, idx) => `
                  <tr class="is-clickable ${selected?.code === m.code ? 'is-selected' : ''}" data-select-market="${esc(m.code)}">
                    <td class="rank-cell">${idx + 1}</td>
                    <td class="country-name">${esc(m.name)}</td>
                    <td class="num">${esc(formatMoney(m.world2024))}</td>
                    <td class="num">${esc(formatMoney(m.us2024))}</td>
                    <td class="num">${m.usSharePct.toFixed(1)}%</td>
                    <td class="num ${pctClass(m.growth4yPct)}">${esc(formatPct(m.growth4yPct))}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
          : `<p class="block-sub">The U.S. already holds strong share (&gt;${state.maxUsShare}%) across major importing markets for ${esc(data.name)}. Raise the ceiling above to inspect mid-share markets.</p>`
      }
    </div>

    <p class="source-foot">Source: UN ComTrade annual HS trade statistics (2020 and 2024, CIF import basis). Minor discrepancies vs. U.S. FAS export totals reflect CIF/FOB valuation and mirror reporting timing.</p>
  `;
}

function render() {
  const groupedOptions = SECTORS.map((sector) => {
    const opts = COMMODITY_PRESETS.filter((p) => p.sector === sector)
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${p.id === state.commodityId ? 'selected' : ''}>${esc(p.name)} (${esc(p.hsLabel)})</option>`
      )
      .join('');
    return `<optgroup label="${esc(sector)}">${opts}</optgroup>`;
  }).join('');

  const destOptions = state.data
    ? `<option value="">All destinations (World total)</option>` +
      state.data.destinations
        .map(
          (d) =>
            `<option value="${esc(d.code)}" ${state.destinationCode === d.code ? 'selected' : ''}>${esc(d.name)} (${esc(formatMoney(d.byYear['2025']))})</option>`
        )
        .join('')
    : `<option value="">All destinations</option>`;

  app.innerHTML = `
    <header class="site-header">
      <div class="inner header-bar">
        <div class="header-left">
          <a class="site-name" href="https://duess.com/for-usaedc-members/" title="Back to Duess Strategies for USAEDC Members">
            <img src="/ds-logo-light.svg" alt="Duess Strategies" class="site-logo" />
          </a>
        </div>
        <nav class="header-nav" aria-label="Free USAEDC resources">
          <a class="header-link is-current" href="https://trade.duess.com/" aria-current="page">Export Scorecard</a>
          <a class="header-link" href="https://events.duess.com/">Trade Show Map</a>
          <a class="header-link" href="https://ues-checker.duess.com/">UES Checker</a>
          <a class="header-link" href="https://duess.com/ai-policy/#fas">FAS AI Policy</a>
          <a class="header-link" href="https://duess.com/worksheet/">Worksheet</a>
        </nav>
      </div>
    </header>

    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="inner">
        <p class="eyebrow"><span class="dash" aria-hidden="true"></span>Free tool for FAS cooperators &amp; USAEDC members</p>
        <h1>U.S. agricultural export data, <em>ready for your next briefing.</em></h1>
        <p class="hero-lead">
          Pick a commodity to get a clean 5-year export scorecard, top destinations, U.S. port breakdown, and a global map showing untapped import markets where competitors currently hold share.<br />
          Zero login, instant load, ready for board decks and UES narratives.
        </p>
        <div class="hero-qa">
          ${HERO_FAQS.map(
            (item, i) => `
            <details class="hero-qa-row" data-faq-index="${i}" ${state.openFaqs.has(i) ? 'open' : ''}>
              <summary>
                <span class="hero-qa-q">${esc(item.q)}</span>
                ${CHEVRON_DOWN}
              </summary>
              <p class="hero-qa-a">${esc(item.a)}</p>
            </details>`
          ).join('')}
        </div>
      </div>
    </section>

    <section class="selector-band">
      <div class="inner">
        <div class="selector-top">
          <div class="selector-fields">
            <div class="field-stack">
              <label for="commodity-select">Commodity (${COMMODITY_PRESETS.length} presets)</label>
              <select id="commodity-select" data-select="commodity">${groupedOptions}</select>
            </div>
            ${
              state.tab === 'scorecard'
                ? `
              <div class="field-stack">
                <label for="dest-select">Destination country</label>
                <select id="dest-select" data-select="destination">${destOptions}</select>
              </div>`
                : ''
            }
          </div>

          <div class="tab-switcher" role="tablist" aria-label="View mode">
            <button type="button" class="tab-btn ${state.tab === 'scorecard' ? 'is-active' : ''}" data-tab="scorecard">01 · Export Scorecard</button>
            <button type="button" class="tab-btn ${state.tab === 'whitespace' ? 'is-active' : ''}" data-tab="whitespace">02 · Untapped Markets</button>
          </div>
        </div>
      </div>
    </section>

    <main class="workspace-band">
      <div class="inner">
        <div class="card">
          ${
            state.loading
              ? `<div class="loading-box">Loading official trade data…</div>`
              : state.error
                ? `<div class="loading-box">${esc(state.error)}</div>`
                : state.tab === 'scorecard'
                  ? renderScorecardTab(state.data)
                  : renderWhitespaceTab(state.data)
          }
        </div>

        <section class="faq-section" aria-labelledby="faq-heading">
          <div class="faq-head">
            <p class="eyebrow"><span class="dash" aria-hidden="true"></span>Common questions</p>
            <h2 id="faq-heading">Frequently asked questions</h2>
          </div>
          <div class="faq-list">
            <details class="faq-item" open>
              <summary>How does trade.duess.com compare to USDA FAS GATS?</summary>
              <p>trade.duess.com pulls from the same official U.S. Census Bureau International Trade API that feeds USDA FAS GATS, plus UN ComTrade for global import demand and rival exporter shares. Instead of building multi-step GATS queries, you pick a commodity preset and immediately get 5-year trends, YTD momentum, top destinations, U.S. customs districts, and untapped global markets.</p>
            </details>
            <details class="faq-item">
              <summary>What commodities are included in the U.S. Ag Export Scorecard?</summary>
              <p>The scorecard covers 24 curated USAEDC cooperator commodity baskets across tree nuts, meat and livestock, dairy, grains and oilseeds, specialty crops, wine, pet food, cotton, pulses, peanuts, genetics, and forestry products. Email <a href="mailto:andreas@duess.com">andreas@duess.com</a> to request an additional HS4 or HS6 basket.</p>
            </details>
            <details class="faq-item">
              <summary>What does the Untapped Markets tab show?</summary>
              <p>The Untapped Markets tab plots major importing countries by 2024 global import value (or 4-year growth) against current U.S. market share from UN ComTrade. Countries in the shaded lower-right zone are large or fast-growing import markets where U.S. share sits below your chosen ceiling, paired with the top global rival exporters currently supplying that commodity.</p>
            </details>
            <details class="faq-item">
              <summary>How do I use these numbers in a UES narrative or board deck?</summary>
              <p>Click <strong>Copy table for PowerPoint / UES</strong> to copy clean tab-separated columns that paste straight into PowerPoint, Excel, or Word. You can also download full CSV files or export the 5-year trend chart as a crisp SVG graphic. Always verify final figures against official USDA FAS or Census records before filing federal grant submissions.</p>
            </details>
            <details class="faq-item">
              <summary>Can I send a direct link to a specific commodity or destination?</summary>
              <p>Yes. Every commodity, destination country filter, and tab updates the browser URL automatically (such as <code>trade.duess.com/?commodity=almonds</code> or <code>trade.duess.com/?commodity=walnuts&amp;tab=whitespace</code>), so you can send a direct pre-filtered link to your board, staff, or committee members.</p>
            </details>
            <details class="faq-item">
              <summary>Is trade.duess.com free to use and does it require a login?</summary>
              <p>Yes. It is 100% free for USAEDC members, FAS cooperators, state regional trade groups, and agricultural exporters, with zero login and no paywalls.</p>
            </details>
          </div>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <div class="inner footer-inner">
        <div class="footer-top">
          <div class="footer-links">
            <a href="https://duess.com/for-usaedc-members/">AI for FAS Cooperators</a>
            <a href="https://trade.duess.com/">Export Scorecard</a>
            <a href="https://events.duess.com/">Trade Show Map</a>
            <a href="https://ues-checker.duess.com/">UES Checker</a>
            <a href="https://duess.com/ai-policy/#fas">FAS AI Policy</a>
            <a href="https://duess.com/worksheet/">Workflow Worksheet</a>
          </div>
        </div>
        <div class="footer-base">
          <div class="footer-meta">
            <span>&copy; 2026 Duess Strategies Inc.</span>
            <ul class="footer-legal">
              <li><a href="/privacy-policy/">Privacy Policy</a></li>
              <li><a href="/terms/">Terms of Use</a></li>
            </ul>
          </div>
          <span class="footer-help">Help and support: Email <a href="mailto:andreas@duess.com">andreas@duess.com</a>.</span>
        </div>
      </div>
    </footer>
  `;

  bindEvents();
}

function bindEvents() {
  app.querySelectorAll('[data-faq-index]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const idx = Number(el.dataset.faqIndex);
      if (el.open) state.openFaqs.add(idx);
      else state.openFaqs.delete(idx);
    });
  });

  app.querySelector('[data-select="commodity"]')?.addEventListener('change', (e) => {
    loadCommodity(e.currentTarget.value);
  });

  app.querySelector('[data-select="destination"]')?.addEventListener('change', (e) => {
    state.destinationCode = e.currentTarget.value;
    syncUrl();
    render();
  });

  app.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      state.tab = e.currentTarget.dataset.tab;
      syncUrl();
      render();
    });
  });

  app.querySelectorAll('[data-select-dest]').forEach((row) => {
    row.addEventListener('click', (e) => {
      const code = e.currentTarget.dataset.selectDest;
      state.destinationCode = state.destinationCode === code ? '' : code;
      syncUrl();
      render();
    });
  });

  app.querySelector('[data-action="clear-dest"]')?.addEventListener('click', () => {
    state.destinationCode = '';
    syncUrl();
    render();
  });

  app.querySelector('[data-action="toggle-dest-limit"]')?.addEventListener('click', () => {
    state.showAllDestinations = !state.showAllDestinations;
    render();
  });

  app.querySelector('[data-action="copy-scorecard"]')?.addEventListener('click', () => {
    if (!state.data) return;
    const dest = state.destinationCode
      ? state.data.destinations.find((d) => d.code === state.destinationCode) || null
      : null;
    const tsv = buildScorecardTsv(state.data, {
      destination: dest,
      limit: state.showAllDestinations ? 25 : 10,
    });
    copyText(tsv, 'scorecard');
  });

  app.querySelector('[data-action="download-csv"]')?.addEventListener('click', () => {
    if (!state.data) return;
    downloadBlob(buildScorecardCsv(state.data), `us-exports-${state.data.id}-2021-2026.csv`, 'text/csv;charset=utf-8');
  });

  app.querySelector('[data-action="download-svg"]')?.addEventListener('click', () => {
    const svg = document.querySelector('#trend-chart-container svg');
    if (!svg) return;
    downloadBlob(svg.outerHTML, `us-exports-${state.commodityId}-trend.svg`, 'image/svg+xml;charset=utf-8');
  });

  app.querySelector('[data-action="copy-link"]')?.addEventListener('click', () => {
    copyText(window.location.href, 'link');
  });

  // Whitespace tab events
  app.querySelectorAll('[data-xmode]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      state.xMode = e.currentTarget.dataset.xmode;
      render();
    });
  });

  app.querySelector('[data-select="maxUsShare"]')?.addEventListener('change', (e) => {
    state.maxUsShare = Number(e.currentTarget.value);
    selectDefaultWhitespaceMarket();
    render();
  });

  app.querySelector('[data-select="whitespaceMarket"]')?.addEventListener('change', (e) => {
    state.selectedMarketCode = e.currentTarget.value;
    render();
  });

  // Instant hover tooltip on whitespace bubbles
  const wsFrame = app.querySelector('#ws-chart-frame');
  const wsTooltip = app.querySelector('#ws-tooltip');
  if (wsFrame && wsTooltip) {
    wsFrame.querySelectorAll('.bubble-hit').forEach((g) => {
      const showTip = (e) => {
        const { tipName, tipWorld, tipShare, tipGrowth } = g.dataset;
        wsTooltip.innerHTML = `<strong>${esc(tipName)}</strong><span>${esc(tipWorld)} imports · ${esc(tipShare)} U.S. share · ${esc(tipGrowth)} 4-yr</span>`;
        wsTooltip.hidden = false;
        const rect = wsFrame.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const left = Math.min(Math.max(12, x + 14), Math.max(12, rect.width - wsTooltip.offsetWidth - 12));
        const top = y > 64 ? y - wsTooltip.offsetHeight - 12 : y + 16;
        wsTooltip.style.left = `${left}px`;
        wsTooltip.style.top = `${top}px`;
      };
      g.addEventListener('mouseenter', showTip);
      g.addEventListener('mousemove', showTip);
      g.addEventListener('mouseleave', () => {
        wsTooltip.hidden = true;
      });
    });
  }

  app.querySelectorAll('[data-market-code], [data-select-market]').forEach((el) => {
    const pick = () => {
      state.selectedMarketCode = el.dataset.marketCode || el.dataset.selectMarket;
      render();
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  });

  app.querySelector('[data-action="copy-whitespace"]')?.addEventListener('click', () => {
    if (!state.data) return;
    const ranked = rankWhitespaceMarkets(state.data.whitespace?.markets || [], {
      maxUsShare: state.maxUsShare,
      minMarketSize: 5_000_000,
    });
    copyText(buildWhitespaceTsv(state.data, ranked), 'whitespace');
  });

  app.querySelector('[data-action="download-ws-csv"]')?.addEventListener('click', () => {
    if (!state.data) return;
    const ranked = rankWhitespaceMarkets(state.data.whitespace?.markets || [], {
      maxUsShare: state.maxUsShare,
      minMarketSize: 5_000_000,
    });
    downloadBlob(buildWhitespaceCsv(ranked), `us-export-whitespace-${state.data.id}-2024.csv`, 'text/csv;charset=utf-8');
  });
}

readUrlState();
loadCommodity(state.commodityId);
