/**
 * Pure SVG editorial charts (zero external charting libraries, crisp print & SVG download).
 */

import { formatMoney, formatPct } from './formatters.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 5-year bar chart (2021–2025) plus 2026 YTD column.
 */
export function renderTrendChartSvg({ byYear, ytdCurr, ytdLabel, title }) {
  const items = [
    { label: '2021', value: Number(byYear['2021'] || 0), kind: 'past' },
    { label: '2022', value: Number(byYear['2022'] || 0), kind: 'past' },
    { label: '2023', value: Number(byYear['2023'] || 0), kind: 'past' },
    { label: '2024', value: Number(byYear['2024'] || 0), kind: 'past' },
    { label: '2025', value: Number(byYear['2025'] || 0), kind: 'latest' },
    { label: ytdLabel || '2026 YTD', value: Number(ytdCurr || 0), kind: 'ytd' },
  ];

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const W = 760;
  const H = 290;
  const pad = { top: 44, right: 24, bottom: 48, left: 24 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const colW = plotW / items.length;
  const barW = Math.min(72, colW * 0.56);

  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = pad.top + plotH * (1 - frac);
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="#dfd9cc" stroke-dasharray="3 4" />`;
  });

  const bars = items
    .map((item, idx) => {
      const cx = pad.left + colW * idx + colW / 2;
      const h = Math.max(3, (item.value / maxVal) * plotH);
      const x = cx - barW / 2;
      const y = pad.top + plotH - h;

      let fill = '#151b2e';
      let stroke = 'none';
      let dash = '';
      if (item.kind === 'latest') {
        fill = '#e0982c';
      } else if (item.kind === 'ytd') {
        fill = '#f7e9cf';
        stroke = '#e0982c';
        dash = 'stroke-dasharray="5 3" stroke-width="2"';
      }

      const valLabel = formatMoney(item.value);
      const labelColor = item.kind === 'latest' ? '#935a08' : '#151b2e';

      return `
        <g>
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${fill}" stroke="${stroke}" ${dash}>
            <title>${esc(item.label)}: ${esc(formatMoney(item.value, { compact: false }))}</title>
          </rect>
          <text x="${cx.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" font-weight="500" fill="${labelColor}">${esc(valLabel)}</text>
          <text x="${cx.toFixed(1)}" y="${(H - 18).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12.5" font-weight="${item.kind === 'latest' ? '600' : '500'}" fill="#4a5470">${esc(item.label)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="${esc(title || '5-year U.S. export trend')}">
      <rect width="${W}" height="${H}" fill="#ffffff" rx="8" />
      ${gridLines.join('')}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${W - pad.right}" y2="${pad.top + plotH}" stroke="#c8c0af" stroke-width="1.2" />
      ${bars}
    </svg>
  `;
}

/**
 * Interactive 2x2 Whitespace Bubble Scatter Plot.
 * X-axis: Market Size (log10 2024 imports) OR 4-Year Growth (%).
 * Y-axis: U.S. Market Share (0% to 100%).
 */
export function renderWhitespaceSvg({
  markets,
  xMode = 'size', // 'size' | 'growth'
  maxUsShare = 15,
  selectedCode = null,
}) {
  const W = 760;
  const H = 430;
  const pad = { top: 44, right: 36, bottom: 54, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const usable = (markets || [])
    .filter((m) => m.world2024 >= 2_000_000)
    .filter((m) => (xMode === 'growth' ? m.growth4yPct !== null && m.growth4yPct >= -60 && m.growth4yPct <= 250 : true))
    .slice(0, 45);

  if (!usable.length) {
    return `<div class="chart-empty">Not enough global import records for this view.</div>`;
  }

  const maxWorld = Math.max(...usable.map((m) => m.world2024), 10_000_000);
  const minWorld = Math.max(2_000_000, Math.min(...usable.map((m) => m.world2024)));

  const logMin = Math.log10(minWorld);
  const logMax = Math.log10(maxWorld * 1.15);

  const minGrowth = -40;
  const maxGrowth = Math.max(100, Math.min(220, Math.ceil(Math.max(...usable.map((m) => m.growth4yPct || 0)) / 25) * 25));

  const xScale = (m) => {
    if (xMode === 'growth') {
      const clamped = Math.max(minGrowth, Math.min(maxGrowth, m.growth4yPct ?? 0));
      return pad.left + ((clamped - minGrowth) / Math.max(1, maxGrowth - minGrowth)) * plotW;
    }
    const lv = Math.log10(Math.max(minWorld, m.world2024));
    return pad.left + ((lv - logMin) / Math.max(0.1, logMax - logMin)) * plotW;
  };

  const yScale = (sharePct) => {
    const clamped = Math.max(0, Math.min(100, sharePct));
    return pad.top + plotH * (1 - clamped / 100);
  };

  const rScale = (world2024) => {
    const ratio = Math.sqrt(world2024 / maxWorld);
    return Math.max(5.5, Math.min(23, 5 + ratio * 19));
  };

  // Shaded Whitespace Opportunity zone (bottom-right: U.S. share <= maxUsShare)
  const zoneY = yScale(maxUsShare);
  const zoneX = xMode === 'growth' ? xScale({ growth4yPct: 10 }) : pad.left + plotW * 0.35;
  const zoneW = Math.max(0, W - pad.right - zoneX);
  const zoneH = Math.max(0, pad.top + plotH - zoneY);

  // Grid ticks
  const yTicks = [0, 25, 50, 75, 100];
  const yGrid = yTicks
    .map((t) => {
      const y = yScale(t);
      return `
        <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="#dfd9cc" stroke-dasharray="${t === 0 ? '' : '3 4'}" />
        <text x="${pad.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="#626b83">${t}%</text>
      `;
    })
    .join('');

  let xTicksHtml = '';
  if (xMode === 'growth') {
    const ticks = [-25, 0, 25, 50, 75, 100, 150, 200].filter((t) => t >= minGrowth && t <= maxGrowth);
    xTicksHtml = ticks
      .map((t) => {
        const x = xScale({ growth4yPct: t });
        return `
          <line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="${t === 0 ? '#c8c0af' : '#eee9de'}" />
          <text x="${x.toFixed(1)}" y="${H - 28}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#626b83">${t > 0 ? '+' : ''}${t}%</text>
        `;
      })
      .join('');
  } else {
    const candidates = [5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9, 5e9, 10e9, 50e9].filter(
      (v) => v >= minWorld * 0.9 && v <= maxWorld * 1.15
    );
    xTicksHtml = candidates
      .map((v) => {
        const x = xScale({ world2024: v });
        return `
          <line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" stroke="#eee9de" />
          <text x="${x.toFixed(1)}" y="${H - 28}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#626b83">${formatMoney(v)}</text>
        `;
      })
      .join('');
  }

  // Greedy bounding-box collision avoidance for crisp, non-overlapping labels
  const placedBoxes = [];
  const labelPriority = [...usable].sort((a, b) => {
    if (a.code === selectedCode) return -1;
    if (b.code === selectedCode) return 1;
    return b.world2024 - a.world2024;
  });
  const visibleLabels = new Set();

  const labelPos = new Map();
  for (const m of labelPriority) {
    if (visibleLabels.size >= 12 && m.code !== selectedCode) continue;
    const cx = xScale(m);
    const cy = yScale(m.usSharePct);
    const r = rScale(m.world2024);
    const w = Math.max(36, m.name.length * 6.4);
    const h = 14;
    const placeBelow = cy - r - h - 4 < 8;
    const bx = Math.max(pad.left, Math.min(W - pad.right - w, cx - w / 2));
    const by = placeBelow ? cy + r + 3 : cy - r - h - 3;

    const collides = placedBoxes.some(
      (p) => !(bx + w + 4 < p.x || bx > p.x + p.w + 4 || by + h + 2 < p.y || by > p.y + p.h + 2)
    );
    if (!collides || m.code === selectedCode) {
      visibleLabels.add(m.code);
      labelPos.set(m.code, { x: bx + w / 2, y: placeBelow ? cy + r + 14 : cy - r - 5 });
      placedBoxes.push({ x: bx, y: by, w, h });
    }
  }

  const bubbles = usable
    .map((m) => {
      const cx = xScale(m);
      const cy = yScale(m.usSharePct);
      const r = rScale(m.world2024);
      const isWhitespace = m.usSharePct <= maxUsShare;
      const isSelected = m.code === selectedCode;

      const fill = isWhitespace ? 'rgba(224, 152, 44, 0.78)' : 'rgba(21, 27, 46, 0.55)';
      const stroke = isSelected ? '#0b1226' : isWhitespace ? '#935a08' : '#151b2e';
      const strokeW = isSelected ? 2.8 : 1.25;

      const pos = labelPos.get(m.code);
      const labelHtml = pos
        ? `<text x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" font-weight="${isSelected ? '600' : '500'}" fill="#151b2e" stroke="#ffffff" stroke-width="3" paint-order="stroke" pointer-events="none">${esc(m.name)}</text>`
        : '';

      return `
        <g class="bubble-hit" data-market-code="${esc(m.code)}" data-tip-name="${esc(m.name)}" data-tip-world="${esc(formatMoney(m.world2024))}" data-tip-share="${m.usSharePct.toFixed(1)}%" data-tip-growth="${esc(formatPct(m.growth4yPct))}" role="button" tabindex="0">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />
          ${labelHtml}
        </g>
      `;
    })
    .join('');

  const xAxisTitle =
    xMode === 'growth'
      ? '4-Year Import Market Growth (2020 to 2024)'
      : 'Total Global Imports in 2024 (USD, log scale)';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="whitespace-svg" role="img" aria-label="Export whitespace bubble chart">
      <rect width="${W}" height="${H}" fill="#ffffff" rx="8" />
      <rect x="${zoneX.toFixed(1)}" y="${zoneY.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${zoneH.toFixed(1)}" fill="#f7e9cf" opacity="0.58" />
      <line x1="${pad.left}" y1="${zoneY.toFixed(1)}" x2="${W - pad.right}" y2="${zoneY.toFixed(1)}" stroke="#e0982c" stroke-width="1.3" stroke-dasharray="5 4" />
      <text x="${(pad.left + 8).toFixed(1)}" y="${(zoneY - 6).toFixed(1)}" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="500" fill="#935a08">WHITESPACE CEILING (U.S. SHARE ≤ ${maxUsShare}%)</text>
      ${xTicksHtml}
      ${yGrid}
      <text x="${(pad.left + plotW / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="#4a5470">${esc(xAxisTitle)}</text>
      <text x="16" y="${(pad.top + plotH / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 16 ${(pad.top + plotH / 2).toFixed(1)})" font-family="JetBrains Mono, monospace" font-size="11" fill="#4a5470">U.S. MARKET SHARE (%)</text>
      ${bubbles}
    </svg>
  `;
}
