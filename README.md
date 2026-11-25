# trade.duess.com — U.S. Ag Export Scorecard & Whitespace Finder

**Live:** [trade.duess.com](https://trade.duess.com)

Fast, zero-login U.S. agricultural export scorecards (5-year trends, top destinations, U.S. customs districts, and PowerPoint/UES table copy) plus a global export whitespace finder for USDA FAS cooperators and USAEDC members.

## Data Sources

- **U.S. Export Scorecard:** Official U.S. Census Bureau International Trade API (`api.census.gov/data/timeseries/intltrade/exports/hs`, the upstream source for USDA GATS), 2021–2025 full years plus 2026 YTD.
- **Global Export Whitespace:** UN ComTrade annual HS trade data (2020 & 2024 global import totals, U.S. market share, and top competing global exporters).

## Refreshing Data

```bash
npm run fetch-data
```

Reads `CENSUS_API_KEY` and `COMTRADE_API_KEY` from `~/.config/secrets/` (or environment variables) and writes compact static JSON shards to `public/data/`.

## Development & Deploy

```bash
npm install
npm test
npm run dev
npm run build
```

Deploy to Cloudflare Pages (`trade.duess.com`):

```bash
npm run build
CLOUDFLARE_API_TOKEN=$(cat ~/.config/secrets/CLOUDFLARE_DUESS_API_TOKEN) CLOUDFLARE_ACCOUNT_ID=881f712a188eb3e93945c5afbff783e3 npx wrangler@4 pages deploy dist --project-name=trade-duess --branch=main
```

## License

MIT — built by Andreas Duess / Duess Strategies Inc.
