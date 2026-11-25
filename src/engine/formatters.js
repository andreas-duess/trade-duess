/**
 * Formatting, whitespace ranking, and PowerPoint/UES/CSV export helpers.
 * Pure functions — tested directly in Node.
 */

export function formatMoney(value, { compact = true } = {}) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (!compact) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }
  if (abs >= 1e9) {
    const digits = abs >= 10e9 ? 1 : 2;
    const factor = 10 ** digits;
    return `${sign}$${(Math.round((abs / 1e9) * factor) / factor).toFixed(digits)}B`;
  }
  if (abs >= 1e6) {
    const digits = abs >= 100e6 ? 0 : 1;
    const factor = 10 ** digits;
    return `${sign}$${(Math.round((abs / 1e6) * factor) / factor).toFixed(digits)}M`;
  }
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatPct(value, { signed = true } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function pctClass(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'num-flat';
  if (value > 0.4) return 'num-up';
  if (value < -0.4) return 'num-down';
  return 'num-flat';
}

/**
 * Ranks global import markets where the U.S. has low share despite meaningful
 * import demand (the bottom-right "Whitespace Opportunity" quadrant).
 */
export function rankWhitespaceMarkets(markets, { maxUsShare = 15, minMarketSize = 10_000_000 } = {}) {
  if (!Array.isArray(markets)) return [];
  return markets
    .filter((m) => m.world2024 >= minMarketSize && m.usSharePct <= maxUsShare)
    .map((m) => {
      // Uncaptured import value = non-US imports in 2024
      const nonUsValue = Math.max(0, m.world2024 - m.us2024);
      const growthBoost = m.growth4yPct != null && m.growth4yPct > 0 ? 1 + Math.min(m.growth4yPct, 150) / 100 : 1;
      return {
        ...m,
        nonUsValue,
        opportunityScore: Math.round(nonUsValue * growthBoost),
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

/**
 * Builds a clean tab-separated (TSV) table that pastes directly into PowerPoint,
 * Excel, Google Slides, or Word without broken columns.
 */
export function buildScorecardTsv(data, { destination = null, limit = 10 } = {}) {
  const lines = [];
  if (destination) {
    lines.push(`${data.name} (${data.hsLabel}) — U.S. Exports to ${destination.name}`);
    lines.push('Year\tExports (USD)');
    for (const yr of ['2021', '2022', '2023', '2024', '2025']) {
      lines.push(`${yr}\t${formatMoney(destination.byYear[yr], { compact: false })}`);
    }
    lines.push(`${data.ytdLabel}\t${formatMoney(destination.ytdCurr, { compact: false })}`);
    lines.push('');
    lines.push('Source: U.S. Census Bureau International Trade (via trade.duess.com)');
    return lines.join('\n');
  }

  lines.push(`${data.name} (${data.hsLabel}) — Top ${limit} U.S. Export Destinations (2025)`);
  lines.push('Rank\tDestination\t2025 Exports (USD)\tShare of Total\tYoY (2024-25)\t5-Yr (2021-25)');
  data.destinations.slice(0, limit).forEach((d, idx) => {
    lines.push(
      [
        idx + 1,
        d.name,
        formatMoney(d.byYear['2025'], { compact: false }),
        `${d.share2025Pct.toFixed(1)}%`,
        formatPct(d.yoyPct),
        formatPct(d.chg5yPct),
      ].join('\t')
    );
  });
  lines.push('');
  lines.push(`Total 2025 U.S. Exports:\t${formatMoney(data.summary.total2025, { compact: false })}`);
  lines.push('Source: U.S. Census Bureau International Trade (via trade.duess.com)');
  return lines.join('\n');
}

export function buildWhitespaceTsv(data, markets) {
  const lines = [];
  lines.push(`${data.name} (${data.hsLabel}) — Global Export Whitespace Markets (2024)`);
  lines.push('Rank\tImporting Market\tTotal 2024 Imports (USD)\tU.S. Exports (USD)\tU.S. Share\t4-Yr Market Growth (2020-24)');
  markets.slice(0, 15).forEach((m, idx) => {
    lines.push(
      [
        idx + 1,
        m.name,
        formatMoney(m.world2024, { compact: false }),
        formatMoney(m.us2024, { compact: false }),
        `${m.usSharePct.toFixed(1)}%`,
        formatPct(m.growth4yPct),
      ].join('\t')
    );
  });
  lines.push('');
  lines.push('Source: UN ComTrade (2020 & 2024) via trade.duess.com');
  return lines.join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildScorecardCsv(data) {
  const header = ['Rank', 'Destination', '2021_USD', '2022_USD', '2023_USD', '2024_USD', '2025_USD', 'Share_2025_Pct', 'YoY_Pct', 'Change_5Yr_Pct', 'YTD_2026_USD'];
  const rows = data.destinations.map((d, idx) => [
    idx + 1,
    d.name,
    d.byYear['2021'],
    d.byYear['2022'],
    d.byYear['2023'],
    d.byYear['2024'],
    d.byYear['2025'],
    d.share2025Pct,
    d.yoyPct ?? '',
    d.chg5yPct ?? '',
    d.ytdCurr,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function buildWhitespaceCsv(markets) {
  const header = ['Rank', 'Market', 'World_Imports_2024_USD', 'World_Imports_2020_USD', 'US_Imports_2024_USD', 'US_Share_Pct', 'Growth_4Yr_Pct'];
  const rows = markets.map((m, idx) => [
    idx + 1,
    m.name,
    m.world2024,
    m.world2020,
    m.us2024,
    m.usSharePct,
    m.growth4yPct ?? '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
