---
name: mangools-seo-keyword-research
description: "SEO/GEO/AI keyword research using Mangools API (KWFinder + SERPChecker). Seed keyword → expand → cluster → HTML report workflow with rate-limit awareness."
version: 2.0.0
tags: [seo, keywords, mangools, kwfinder, serpchecker, serp, geo, ai-search, research, marketing]
---

# Mangools SEO/GEO/AI Keyword Research

End-to-end keyword research workflow using the Mangools REST API (KWFinder + SERPChecker). Takes seed keywords, expands them with search volume/difficulty/CPC/trend data, clusters results, and produces an interactive HTML report.

## Prerequisites

- Mangools API token (get from https://mangools.com/api-token)
- Store in env as `MANGOOLS_API_TOKEN` or pass directly
- Python 3.10+ with `requests` library

## API Basics

**Base URL:** `https://api.mangools.com/v3`

**Authentication:** `X-Access-Token` header (NOT `x-api-key`):
```bash
curl -H "X-Access-Token: $MANGOOLS_API_TOKEN" "https://api.mangools.com/v3/kwfinder/related-keywords?kw=seo"
```

**Deduplication:** Identical requests within 24 hours are reused from cache — the lookup is NOT counted again. This is critical for budget management.

## Rate Limits

| Plan | KWFinder Lookups/Day | SERP Lookups/Day | Import Keywords/Request |
|------|---------------------|-------------------|------------------------|
| Basic | 100 | 10 | 200 |
| Premium | 500 | 50 | 700 |
| Agency | 1,200 | 12 | 700 |

**Check remaining quota:** `GET /v3/kwfinder/limits` — returns `limit`, `remaining`, `reset` (seconds) for every resource type.

**Strategy:** related-keywords endpoint is most efficient (1 request = hundreds of results with sv/cpc/kd already included). Always specify location_id + language_id. Cap at 100 keywords per run. Do SERP lookups for actual KD/intent/content data.

## KWFinder Endpoints

### 1. Related Keywords (Seed Expansion)
```
GET /v3/kwfinder/related-keywords
```
**Parameters:**
- `kw` (required) — seed keyword
- `location_id` (optional) — location ID, default 0 (global)
- `language_id` (optional) — language ID, default 0

**Returns:** Up to 10,000 related keywords sorted by relevancy. Each keyword includes:
- `kw` — keyword text
- `sv` — average monthly search volume (last 12 months)
- `msv` — monthly search volume history (array of `[year, month, volume]`, back to 2015)
- `cpc` — cost per click (USD)
- `ppc` — pay per click (0-100 scale)
- `seo` — cached keyword difficulty (1-100, may be `null`)
- `seo_ts` — KD timestamp
- `_id` — unique keyword ID (reusable across other endpoints)

### 2. Keyword Import (Bulk Details — Most Efficient)
```
POST /v3/kwfinder/keyword-imports
```
**Body (JSON):**
```json
{
  "keywords": ["keyword1", "keyword2", "..."],
  "location_id": 2534,
  "language_id": 47
}
```
- Up to 700 keywords per request (Premium/Agency), 200 (Basic)
- Returns: `sv`, `cpc`, `ppc`, `seo` (KD), `msv` (monthly history) for each keyword
- Also returns `countKeywordsBeforeLimit` — how many lookups you had before this request

### 3. Keyword SERP Details
```
GET /v3/kwfinder/serps
```
**Parameters:**
- `kw` (required) — keyword
- `location_id` (optional) — default 2840 (USA)
- `language_id` (optional)
- `platform_id` (optional) — 1=desktop (default), 2=mobile
- `page` (optional) — default 0

**Returns:** Full SERP with per-result metrics:
- `items[]` — SERP features and organic results
  - `type` — result type: `ORGANIC`, `FEATURED_SNIPPET`, `LOCAL_PACK`, `SHOP_RESULTS`, `VIDEO_PANEL`, `NEWS_PACK`, `IMG_PACK`, `SIMILAR_QUESTIONS`, `TOP_STORIES`, `KNOWLEDGE_PANEL`, etc.
  - For `ORGANIC` items: `url`, `title`, `desc`, `domain`, `topRank`
  - `m` — metrics object with sub-objects:
    - `moz` — DA/PA: `pda` (Page DA), `upa` (URL PA), plus 40+ Moz metrics
    - `majestic` — `ExtBackLinks`, `RefDomains`, `CitationFlow`, `TrustFlow`
    - `fb` — Facebook social data
  - `screenCoverage` — % of screen the result occupies (above-the-fold visibility)
  - `visPart` — % of visible viewport
- `results` — total number of results in SERP
- `ctr[]` — click-through rates per organic position
- `serpFeaturesImpact` — impact score of SERP features
- `serp_snapshot_id` — ID for snapshot retrieval
- `serp_source_url` — link to cached SERP page (stored 60 days)

### 4. Competitor Domains
```
GET /v3/kwfinder/competitor-domain
```
**Parameters:** `url` (required), `location_id` (required)
**Returns:** List of domains competing for organic keywords with the target URL.

### 5. Gap Analysis (Competitor Keywords)
```
POST /v3/kwfinder/gap-analysis
```
**Body (JSON):**
```json
{
  "domain": "yourdomain.com",
  "competitors": ["competitor1.com", "competitor2.com"],
  "location_id": 2840,
  "page": 1
}
```
- `competitors`: 1-5 domains
- `page`: pagination (Premium/Agency only)
- **Returns:** Keywords competitors rank for that you don't, sorted by opportunity
- Each item: `keyword`, `search_volume`, `cpc`, `competition`, `competitor_position`, `your_position`

### 6. Export Keywords to CSV
```
POST /v3/kwfinder/keywords
```
**Body:** Pass `_id` values from other endpoints (related-keywords, keyword-imports, etc.)
**Fields:** `kw`, `sv`, `lid`, `cpc`, `ppc`, `seo`, `msv`

### 7. Keyword Lists
- `POST /v3/kwfinder/lists` — create list (name + keyword_ids)
- `POST /v3/kwfinder/lists/{list_id}/keyword` — add keywords to list
- `GET /v3/kwfinder/lists/{list_id}?fields=...` — get list with full keyword data (supports CSV export via `Accept: text/csv`)

### 8. Lookup History
```
GET /v3/kwfinder/requests?limit=25
```
Returns recent lookups with keyword, language, location, rank.

### 9. Current Limits
```
GET /v3/kwfinder/limits
```
Returns remaining quota for all resources. Check before expensive requests.

### 10. Trends (DEPRECATED)
```
GET /v3/kwfinder/trends
```
**⚠️ Deprecated since January 2025.** No fresh data. Use `msv` (monthly search volume history) from `keyword-imports` instead.

## SERPChecker Endpoints

### 1. SERP Results with All Metrics
```
GET /v3/serpchecker/serps
```
**Parameters:**
- `location_id` (required) — 0 for any
- `kw` (required) — keyword
- `platform_id` (optional) — 1=desktop (default), 2=mobile

**Returns:** Same rich structure as kwfinder/serps — items with 50+ SEO metrics (Moz, Majestic, Facebook), SERP features, above-the-fold visibility, CTR, snapshot link.

**SERP Feature Types Detected:**
`SPELL_ERROR`, `SUGGESTION`, `KNO_GRAPH`, `TOP_CAROUSEL`, `TOP_STORIES`, `ADV_TOP`, `ADV_BOTTOM`, `NEWS_CAROUSEL`, `NEWS_PACK`, `IMG_PACK`, `VIDEO_PACK`, `FLIGHTS`, `VIDEO_PANEL`, `INSTALL_APP`, `LOCAL_PACK`, `PROGRAM_OVERVIEW`, `ORGANIC`, `SIMILAR_QUERIES`, `SIMILAR_QUESTIONS`, `SPECIFY_QUERY`, `POPULAR_LIST`, `QUANTITY_ANSWER`, `CURRENCY`, `TIME`, `FEATURED_SNIPPET`, `WEATHER`, `TRANSLATOR`, `DICTIONARY`, `TOP_SIGHTS`, `TRAVEL_BOX`, `INDEPTH_ARTICLE`, `SHOP_RESULTS`, `JOB_POSTING`, `SPORTS`

### 2. Reset Cached SERP
```
GET /v3/serpchecker/serps/reset
```
Same parameters as `/serps`. Forces a fresh SERP fetch when you need up-to-date results.

### 3. URL Metrics
```
GET /v3/serpchecker/url-metrics?url=https://example.com
```
Returns Moz DA/PA and Majestic CF/TF for a specific URL. Counts toward keyword lookups; cached within 24h.

### 4. SERP Snapshot Image
```
GET /v3/serpchecker/serps/{serp_id}/snapshot
```
Returns `{ "image": "url" }` — rendered screenshot of the SERP. Requires prior call to `/serpchecker/serps`.

### 5. Lookup History
```
GET /v3/serpchecker/requests?limit=25
```

## Shared Endpoints

### Locations
- `GET /v3/mangools/locations?query=New+York` — search locations (returns up to 100 matches)
- `GET /v3/mangools/locations/{location_id}` — get location detail

Location object includes: `_id`, `name`, `country_code`, `canonical_name`, `label`, `google_domain`, `target_type` (Country/State/City), `parent_id`.

## Common Location IDs

| Location | ID | Language | ID |
|----------|-----|----------|-----|
| Romania | 2642 | Romanian | 47 |
| USA | 2840 | English | 1000 |
| UK | 2826 | English | 1000 |
| Germany | 2276 | German | — |
| France | 2250 | French | — |
| Global | 0 | — | 0 |

**Always verify IDs** using `/mangools/locations?query=...` before making requests.

## Workflow: Seed → Expand → Filter → SERP → Report

**IMPORTANT:** Always specify `location_id` and `language_id` on every request for optimal output.

### Step 1: Check Limits
Always check `/v3/kwfinder/limits` first. Budget: max 100 keywords per run.

### Step 2: Seed Expansion (1 request per seed)
Call `GET /v3/kwfinder/related-keywords?kw={seed}&location_id={loc}&language_id={lang}` for each seed keyword.
- Returns hundreds of related keywords with `sv`, `cpc`, `ppc`, `seo` (KD), `msv` already included
- Each seed is ONE API request — this is the most efficient endpoint

### Step 3: Filter & Cap (no API calls)
From the combined results across all seeds:
1. **Exclude** keywords with `sv` < 150
2. **Keep** keywords with `sv` ≥ 100 (but < 150 are excluded per rule above)
3. **Sort** by `sv` descending
4. **Cap** at 100 total keywords. If N seeds, each seed gets `floor(100/N)` slots (minimum 10 per seed)
5. **Deduplicate** — if same keyword appears from multiple seeds, keep the highest-sv entry

### Step 4: SERP Lookups for Full List (bulk)
For EACH keyword in the filtered list, call `GET /v3/kwfinder/serps?kw={keyword}&location_id={loc}&language_id={lang}` to get:
- Actual KD (the `seo` field from related-keywords is cached and may be stale/null)
- SERP features present (determines intent classification)
- Content types ranking (determines content type classification)
- DA/PA/CF/TF of top results
- CTR per position

**Budget tip:** SERP lookups are separate quota from keyword lookups. Check limits. If quota is tight, prioritize top-volume keywords.

### Step 5: Classify & Cluster
Group keywords into thematic clusters. Classify each keyword by:
- **Search Intent:** C (Commercial), T (Transactional), N (Navigational), I (Informational) — infer from SERP features and content types
- **KD Level:** Easy (seo ≤10), Medium (11-15), Hard (16+)
- **Content Type in SERPs:** MB (Media/Blogs), H (Homepages), PSP (Product/Service Pages) — infer from `items[].type` and `items[].domain`
- **Trend:** Positive (+%), Negative (-%), Neutral (0% or N/A) — derive from `msv` monthly history

### Step 6: Time Estimate
Estimate optimization time per keyword based on KD:
- Easy (KD ≤10): 3-3.5 hours
- Medium (KD 11-15): 3.5-4.5 hours
- Hard (KD 16+): 4.5-5+ hours

Add 15% buffer to total.

### Step 7: Generate HTML Report
Produce an interactive HTML file (see template below).

## HTML Report Template

Self-contained HTML file with:

**Header:**
- Title: "Target Keyword Optimization Strategy - [Client/Project Name]"
- Company branding/logo
- Time budget box: total hours (with 15% buffer), base estimate, keyword count, avg per keyword

**Controls:**
- Cluster filter dropdown
- KD filter (All / Easy ≤10 / Medium 11-15 / Hard 16+)
- Text search filter
- Reset button

**Legend:**
- Intent: C (Commercial, pink), T (Transactional, gold), N (Navigational, blue), I (Informational, purple)
- Content: 📰 Media & Blogs, 🏠 Homepages, 🛍️ Product Pages

**Table columns:**
- Keyword (with cluster tag)
- Search Volume (`sv`)
- CPC (`$cpc`)
- Intent (badges)
- KD (color-coded: green ≤10, yellow 11-15, red 16+)
- Content Types (icons)
- Trend (+/-% or N/A — derived from `msv`)
- Time estimate (hours)
- Action (→ detail modal)

**Detail Modal:**
- Cluster name, Search Volume, CPC, KD with label, Optimization Time
- Intent Types, Content Types in SERPs
- Optimization Roadmap: Content & Copy, Schema & Semantics, Technical, Q&A & Content
- Trend visualization

**JavaScript data format:**
```javascript
const clusterData = {
    'Cluster Name': [
        {
            name: 'keyword',       // kw
            search: 17800,         // sv
            cpc: 0.80,             // cpc
            intent: ['C', 'T'],    // classified from SERP data
            kd: 11,                // seo
            content: ['MB'],       // inferred from SERP items
            time: 3.5,             // estimated hours
            trend: '+7%'           // derived from msv
        }
    ]
};
```

**Responsive:** Desktop grid → tablet compressed → mobile card layout (2-col with labels).

**Color scheme (CSS variables):**
```css
--color-primary: #FE4C1C;
--color-primary-hover: #1A7A8A;
--color-success: #22C55E;   /* KD easy, positive trend */
--color-warning: #F59E0B;   /* KD medium */
--color-danger: #EF4444;    /* KD hard, negative trend */
--color-intent-c: #FF6B9D;  /* Commercial */
--color-intent-t: #FFB700;  /* Transactional */
--color-intent-n: #50A5FF;  /* Navigational */
--color-intent-i: #9D4EDD;  /* Informational */
```

## Python Script Pattern

```python
import os, requests, json

API_KEY = os.environ["MANGOOLS_API_TOKEN"]
BASE_URL = "https://api.mangools.com/v3"
HEADERS = {"X-Access-Token": API_KEY}

def related_keywords(kw, location_id, language_id):
    """Get related keywords from a seed. Returns hundreds with sv/cpc/kd."""
    resp = requests.get(f"{BASE_URL}/kwfinder/related-keywords",
        headers=HEADERS, params={"kw": kw, "location_id": location_id, "language_id": language_id})
    resp.raise_for_status()
    return resp.json()

def kwfinder_serps(kw, location_id, language_id, platform_id=1):
    """Get SERP with actual KD, intent, content type data."""
    resp = requests.get(f"{BASE_URL}/kwfinder/serps",
        headers=HEADERS, params={"kw": kw, "location_id": location_id,
                                  "language_id": language_id, "platform_id": platform_id})
    resp.raise_for_status()
    return resp.json()

def serpchecker_serps(kw, location_id, language_id, platform_id=1):
    """Get SERP with 50+ SEO metrics per result."""
    resp = requests.get(f"{BASE_URL}/serpchecker/serps",
        headers=HEADERS, params={"kw": kw, "location_id": location_id,
                                  "language_id": language_id, "platform_id": platform_id})
    resp.raise_for_status()
    return resp.json()

def check_limits():
    """Check remaining API quota."""
    resp = requests.get(f"{BASE_URL}/kwfinder/limits", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def search_locations(query):
    """Find location IDs by name."""
    resp = requests.get(f"{BASE_URL}/mangools/locations",
        headers=HEADERS, params={"query": query})
    resp.raise_for_status()
    return resp.json()

def filter_and_cap(keywords, max_total=100, min_sv=150):
    """Filter keywords: sv >= 100, exclude sv < 150, cap at max_total."""
    # Exclude sv < 150
    filtered = [k for k in keywords if k.get('sv', 0) >= min_sv]
    # Sort by sv descending
    filtered.sort(key=lambda x: x.get('sv', 0), reverse=True)
    # Cap
    return filtered[:max_total]

def classify_intent(kw, serp_data):
    """Classify search intent from SERP features."""
    intents = []
    items = serp_data.get('items', [])
    types = [i.get('type', '') for i in items]
    if 'SHOP_RESULTS' in types:
        intents.append('T')
    if any(t in types for t in ['VIDEO_PANEL', 'NEWS_PACK', 'IMG_PACK']):
        intents.append('I')
    if 'LOCAL_PACK' in types:
        intents.append('N')
    if not intents:
        intents.append('C')
    return intents

def estimate_time(kd):
    """Estimate optimization hours based on KD."""
    if kd is None: return 3.5
    if kd <= 10: return 3.25
    if kd <= 15: return 4.0
    return 5.0
```

## Response Field Reference

**Keyword object fields (from related-keywords / keyword-imports):**
| Field | Description |
|-------|-------------|
| `_id` | Unique keyword ID (reusable across endpoints) |
| `kw` | Keyword text |
| `sv` | Average monthly search volume (last 12 months) |
| `svs` | Search volume (seasonally adjusted?) |
| `svn` | Search volume (next period forecast?) |
| `cpc` | Cost per click (USD) |
| `ppc` | Pay per click (0-100 scale) |
| `seo` | Cached keyword difficulty (1-100, may be null) |
| `seo_ts` | KD cache timestamp |
| `msv` | Monthly search volume history — array of `[year, month, volume]` |
| `ts` | Data timestamp |
| `lid` | Location ID |

**SERP item fields (from kwfinder/serps or serpchecker/serps):**
| Field | Description |
|-------|-------------|
| `type` | Result type (ORGANIC, FEATURED_SNIPPET, LOCAL_PACK, etc.) |
| `url` | Result URL |
| `title` | Result title |
| `desc` | Result description/snippet |
| `domain` | Root domain |
| `topRank` | Historical top rank |
| `m.moz.v.pda` | Page Domain Authority |
| `m.moz.v.upa` | URL Page Authority |
| `m.majestic.v.ExtBackLinks` | External backlinks count |
| `m.majestic.v.RefDomains` | Referring domains count |
| `m.majestic.v.CitationFlow` | Majestic Citation Flow |
| `m.majestic.v.TrustFlow` | Majestic Trust Flow |
| `screenCoverage` | % of screen the result occupies |
| `visPart` | % of visible viewport |

## Pitfalls

1. **Auth header is `X-Access-Token`** (not `x-api-key`). Case-sensitive.
2. **API is v3** (not v1). Base URL: `https://api.mangools.com/v3`
3. **Parameter is `kw`** (not `keyword`). Location is `location_id`, language is `language_id`.
4. **KD field is `seo`** (not `keyword_difficulty`). Scale is 1-100. May be `null` for new/low-volume keywords.
5. **Trends endpoint is deprecated** since Jan 2025. Use `msv` monthly history from keyword-imports.
6. **Deduplication within 24h** — identical requests don't count as new lookups. Use this to your advantage.
7. **related-keywords is the primary endpoint** — returns hundreds of results with sv/cpc/kd in ONE request. Never use keyword-imports unless you have raw keyword lists from external sources.
8. **SERP lookups are separate quota** from keyword lookups. Check `/v3/kwfinder/limits` before expensive requests.
9. **Location IDs are numeric** (not country codes). Always verify with `/mangools/locations?query=...`. Romania=2642, USA=2840, UK=2826, Germany=2276, France=2250.
10. **CPC is in USD.** Format as `$X.XX` in reports.
11. **`msv` array format:** `[year, month, volume]` — e.g., `[2015, 8, 590]`. Parse carefully for trend analysis.
12. **SERP snapshot stored 60 days.** Use `serp_snapshot_id` to retrieve via `/serpchecker/serps/{id}/snapshot`.
13. **Gap analysis `competitors` array:** 1-5 domains only. `page` parameter is Premium/Agency only.
14. **Keywords endpoint for CSV export** requires `_id` values from previous lookups — not raw keyword strings.
15. **Always specify location_id and language_id** on related-keywords requests for accurate, localized results.
16. **Filtering rules:** Include keywords with sv ≥ 100. Exclude keywords with sv < 150. Cap total at 100 keywords per run.
17. **SERP lookups for full list** — the `seo` (KD) field from related-keywords is cached and may be null. Do SERP lookups to get actual KD, intent, and content type data.

## Verification

After generating a report:
1. Open HTML in browser — verify all filters work (cluster, KD, text search)
2. Check time budget = sum(keyword times) × 1.15
3. Verify all keywords have sv ≥ threshold
4. Confirm intent badges display correctly
5. Test detail modal opens/closes
6. Check responsive layout on mobile
7. Validate no duplicate keywords across clusters
