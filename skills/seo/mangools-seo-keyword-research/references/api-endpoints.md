# Mangools API v3 — Raw Endpoint Reference

Sourced from https://apidocs.mangools.com/ (paste verified June 2026).

## Authentication
- Header: `X-Access-Token: {API_KEY}`
- Get key: https://mangools.com/api-token

## Base URL
`https://api.mangools.com/v3`

---

## KWFinder Endpoints

### GET /kwfinder/related-keywords
Seed keyword expansion. Up to 10,000 results sorted by relevancy.
- `kw` (required, string) — seed keyword
- `location_id` (optional, int, default 0) — 0 = global
- `language_id` (optional, int, default 0)
- Dedup: identical request within 24h free

Response:
```json
{
  "keywords": [{
    "_id": "...", "kw": "seo agency", "lid": 21167,
    "sv": 21167, "svs": 21167, "cpc": 21167, "ppc": 21167,
    "svn": 530, "msv": [[2015, 8, 590]],
    "ts": 1617710810, "seo": null, "seo_ts": null
  }],
  "language": {"code": "en", "label": "English", "_id": 1000},
  "location": {"_id": 1000, "name": "...", "label": "New York,United States", ...},
  "countKeywordsBeforeLimit": 0, "_id": "..."
}
```

### POST /kwfinder/keyword-imports
Bulk keyword details. Up to 700 keywords/request.
- Body: `{"keywords": ["kw1", "kw2"], "location_id": 21167, "language_id": 1000}`
- Returns: sv, cpc, ppc, seo (cached KD), msv (history), organic SERP + CTRs
- Dedup: identical request within 24h free

### GET /kwfinder/serps
Per-keyword SERP with Moz/Majestic/FB metrics.
- `kw` (required), `location_id` (default 2840=USA), `language_id`, `platform_id`, `page`
- Items: `{type: "ORGANIC", url, title, desc, domain, topRank, m: {moz: {...}, majestic: {...}, fb: {...}}}`
- Moz key fields: `pda` (Page DA), `upa` (URL PA), `umrp`, `pmrp`
- Majestic key fields: `ExtBackLinks`, `RefDomains`, `CitationFlow`, `TrustFlow`, `ACRank`
- Response: `ctr[]`, `results` (total count), `serpFeaturesImpact`

### GET /kwfinder/competitor-domain
Domains competing for organic keywords.
- `url` (required), `location_id` (required)

### POST /kwfinder/gap-analysis
Keywords competitors rank for that you don't.
- Body: `{"domain": "yoursite.com", "competitors": ["c1.com", "c2.com"], "location_id": 2840, "page": 1}`
- 1-5 competitors. Pagination Premium/Agency only.
- Response: `results[].items[].{keyword, search_volume, cpc, competition, competitor_position, your_position}`

### POST /kwfinder/keywords
Export to CSV. Pass `_id` values from other endpoints.
- Fields: `kw`, `sv`, `lid`, `cpc`, `ppc`, `seo`, `msv`

### GET /kwfinder/requests
Lookup history. Max 25.
- `limit` (required)

### GET /kwfinder/limits
Remaining quota for all resources.
- Returns: `{resources: {"related-keywords": {limit, remaining, reset}, "serps": {...}, "links": {...}, ...}}`

### GET /kwfinder/trends
**DEPRECATED** — no data since Jan 2025. Use `msv` from keyword-imports.

---

## SERPChecker / LinkMiner / SiteProfiler / SERPWatcher / AI Search Watcher
*(Awaiting paste from user — will append here)*
