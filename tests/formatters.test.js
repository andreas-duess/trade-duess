import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney,
  formatPct,
  rankWhitespaceMarkets,
  buildScorecardTsv,
  buildWhitespaceTsv,
  buildScorecardCsv,
} from '../src/engine/formatters.js';

test('formatMoney formats billions, millions, thousands, and exact dollars cleanly', () => {
  assert.equal(formatMoney(19_450_000_000), '$19.5B');
  assert.equal(formatMoney(4_434_671_252), '$4.43B');
  assert.equal(formatMoney(383_370_001), '$383M');
  assert.equal(formatMoney(42_500_000), '$42.5M');
  assert.equal(formatMoney(850_000), '$850K');
  assert.equal(formatMoney(4_434_671, { compact: false }), '$4,434,671');
});

test('formatPct handles signed positives, negatives, and nulls', () => {
  assert.equal(formatPct(12.34), '+12.3%');
  assert.equal(formatPct(-4.56), '-4.6%');
  assert.equal(formatPct(null), '—');
});

test('rankWhitespaceMarkets filters by U.S. share and ranks by uncaptured demand + growth', () => {
  const markets = [
    { code: '1', name: 'Japan', world2024: 500_000_000, us2024: 350_000_000, usSharePct: 70, growth4yPct: 10 },
    { code: '2', name: 'India', world2024: 400_000_000, us2024: 20_000_000, usSharePct: 5, growth4yPct: 80 },
    { code: '3', name: 'Germany', world2024: 450_000_000, us2024: 45_000_000, usSharePct: 10, growth4yPct: 5 },
    { code: '4', name: 'Tiny Island', world2024: 1_000_000, us2024: 0, usSharePct: 0, growth4yPct: 50 },
  ];

  const ranked = rankWhitespaceMarkets(markets, { maxUsShare: 15, minMarketSize: 10_000_000 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, 'India'); // high growth boost beats Germany
  assert.equal(ranked[1].name, 'Germany');
});

test('buildScorecardTsv and CSV produce clean pasteable tables', () => {
  const sample = {
    name: 'Almonds',
    hsLabel: 'HS 080211 + 080212',
    years: [2021, 2022, 2023, 2024, 2025],
    latestYear: 2025,
    ytdYear: 2026,
    ytdLabel: 'Jan–Sep 2026',
    summary: { totalLatest: 4_500_000_000 },
    destinations: [
      {
        name: 'India',
        byYear: { '2021': 800e6, '2022': 850e6, '2023': 900e6, '2024': 950e6, '2025': 1_050_000_000 },
        shareLatestPct: 23.3,
        yoyPct: 10.5,
        chg5yPct: 31.3,
        ytdCurr: 780e6,
      },
    ],
  };

  const tsv = buildScorecardTsv(sample);
  assert.match(tsv, /Almonds \(HS 080211 \+ 080212\)/);
  assert.match(tsv, /1\tIndia\t\$1,050,000,000\t23\.3%\t\+10\.5%\t\+31\.3%/);

  const csv = buildScorecardCsv(sample);
  assert.match(csv, /^Rank,Destination,2021_USD,2022_USD,2023_USD,2024_USD,2025_USD,Share_2025_Pct,YoY_Pct,Change_5Yr_Pct,YTD_2026_USD\n/);
  assert.match(csv, /1,India,800000000/);

  const wsTsv = buildWhitespaceTsv(sample, [
    { name: 'Vietnam', world2024: 250_000_000, us2024: 12_000_000, usSharePct: 4.8, growth4yPct: 62.4 },
  ]);
  assert.match(wsTsv, /1\tVietnam\t\$250,000,000\t\$12,000,000\t4\.8%\t\+62\.4%/);
});

test('scorecard tables follow the years in the data after a roll-over', () => {
  const sample = {
    name: 'Almonds',
    hsLabel: 'HS 080211 + 080212',
    years: [2022, 2023, 2024, 2025, 2026],
    latestYear: 2026,
    ytdYear: 2027,
    ytdLabel: 'Jan 2027',
    summary: { totalLatest: 5_000_000_000 },
    destinations: [
      {
        name: 'India',
        byYear: { '2022': 850e6, '2023': 900e6, '2024': 950e6, '2025': 1_050_000_000, '2026': 1_100_000_000 },
        shareLatestPct: 22,
        yoyPct: 4.8,
        chg5yPct: 29.4,
        ytdCurr: 90e6,
      },
    ],
  };
  const csv = buildScorecardCsv(sample);
  assert.match(csv, /^Rank,Destination,2022_USD,2023_USD,2024_USD,2025_USD,2026_USD,Share_2026_Pct,YoY_Pct,Change_5Yr_Pct,YTD_2027_USD\n/);
  assert.match(csv, /1,India,850000000,900000000,950000000,1050000000,1100000000,22,4\.8,29\.4,90000000/);
  const tsv = buildScorecardTsv(sample);
  assert.match(tsv, /Top 10 U\.S\. Export Destinations \(2026\)/);
  assert.match(tsv, /YoY \(2025-26\)\t5-Yr \(2022-26\)/);
  assert.match(tsv, /Total 2026 U\.S\. Exports:\t\$5,000,000,000/);
});
