---
name: mangools-seo-keyword-research
description: "SEO/GEO/AI keyword research — two-phase workflow. Phase 1: seed expansion → filter → bulk keyword-imports → HTML report (8 API calls). Phase 2: targeted SERP lookups for selected keywords → update report. Always specify location."
version: 6.0.0
tags: [seo, keywords, mangools, kwfinder, serpchecker, serp, geo, ai-search, research, marketing]
---

# Mangools SEO/GEO/AI Keyword Research

End-to-end keyword research workflow using the Mangools REST API. Takes seed keywords, expands them with search volume/difficulty/CPC/trend data, enriches via bulk keyword-imports for KD/intent/content, clusters results, and produces an interactive HTML report.

## Prerequisites

- Mangools API token (get from https://mangools.com/api-token)
- Store in env as `MANGOOLS_API_TOKEN` or pass directly
- Python 3.10+ with `requests` library

## API Basics

**Base URL:** `https://api.mangools.com/v3`

**Authentication:** `X-Access-Token` header (NOT `x-api-key`):
```bash
curl -H "X-Access-Token: $MANGOOLS_API_TOKEN" "https://api.mangools.com/v3/kwfinder/related-keywords?kw=seo&location_id=2642"
```

**Deduplication:** Identical requests within 24 hours are reused from cache — the lookup is NOT counted again. Re-running the same seed expansion is free within 24h.

**Cost model (from Mangools FAQ):** 1 API request = 10 lookups deducted from daily quota. So a keyword-imports POST with 150 keywords = 1 API request = 10 lookups. A related-keywords GET = 1 API request = 10 lookups. Plan limits are in lookups/day, so effective requests/day = limit / 10.

## Rate Limits

| Plan | KWFinder Lookups/Day | Effective Requests | Import Keywords/Request |
|------|---------------------|--------------------|------------------------|
| Basic | 100 | ~10 | 200 |
| Premium | 500 | ~50 | 700 |
| Agency | 1,200 | ~120 | 700 |

**Check remaining quota:** `GET /v3/kwfinder/limits` — returns `limit`, `remaining`, `reset` for every resource type.

**Strategy:** related-keywords for seed expansion (1 request per seed = hundreds of results). keyword-imports POST for bulk KD/intent enrichment (1 request for up to 700 keywords). Always specify `location_id`. Omit `language_id` unless verified — some combos cause 500 errors.

## KWFinder Endpoints

### 1. Related Keywords (Seed Expansion)
```
GET /v3/kwfinder/related-keywords
```
**Parameters:**
- `kw` (required) — seed keyword
- `location_id` (optional) — location ID, default 0 (global)
- `language_id` (optional) — **omit unless verified** (see pitfall #5)

**Returns:** Up to 10,000 related keywords sorted by relevancy. Each keyword includes:
- `kw` — keyword text
- `sv` — average monthly search volume (last 12 months)
- `msv` — monthly search volume history (array of `[year, month, volume]`)
- `cpc` — cost per click (USD)
- `ppc` — pay per click (0-100 scale)
- `seo` — cached keyword difficulty (1-100, may be `null`)
- `_id` — unique keyword ID

### 2. Keyword Import (Bulk Enrichment — Primary SERP Endpoint)
```
POST /v3/kwfinder/keyword-imports
```
**Body (JSON):**
```json
{
  "keywords": ["keyword1", "keyword2", "..."],
  "location_id": 2642
}
```
- Up to 700 keywords per request (Premium/Agency), 200 (Basic)
- Returns: `sv`, `cpc`, `ppc`, `seo` (KD), `msv` (monthly history) for each keyword
- Also returns `countKeywordsBeforeLimit` — how many lookups you had before this request
- **Counts as 1 API request regardless of keyword count** (10 lookups from quota)
- This is the correct endpoint for bulk KD/intent enrichment — NOT individual serps calls

### 3. Keyword SERP Details (Per-Keyword — Use Sparingly)
```
GET /v3/kwfinder/serps
```
**Parameters:**
- `kw` (required) — keyword
- `location_id` (optional) — default 2840 (USA)
- `platform_id` (optional) — 1=desktop (default), 2=mobile

**Returns:** Full SERP with per-result metrics (items, Moz DA/PA, Majestic CF/TF, CTR, SERP features). Each call = 10 lookups from quota. Use only when you need granular per-keyword SERP analysis, NOT for bulk enrichment.

### 4. Competitor Domains
```
GET /v3/kwfinder/competitor-domain
```
**Parameters:** `url` (required), `location_id` (required)

### 5. Gap Analysis (Competitor Keywords)
```
POST /v3/kwfinder/gap-analysis
```
**Body:** `{ "domain": "yoursite.com", "competitors": ["c1.com", "c2.com"], "location_id": 2840 }`
- 1-5 competitors. Pagination Premium/Agency only.

### 6. Export Keywords to CSV
```
POST /v3/kwfinder/keywords
```
**Body:** Pass `_id` values from other endpoints. Fields: `kw`, `sv`, `lid`, `cpc`, `ppc`, `seo`, `msv`.

### 7. Keyword Lists
- `POST /v3/kwfinder/lists` — create list (name + keyword_ids)
- `POST /v3/kwfinder/lists/{list_id}/keyword` — add keywords
- `GET /v3/kwfinder/lists/{list_id}?fields=...` — get list (CSV via `Accept: text/csv`)

### 8. Lookup History
```
GET /v3/kwfinder/requests?limit=25
```

### 9. Current Limits
```
GET /v3/kwfinder/limits
```

### 10. Trends (DEPRECATED)
**⚠️ Deprecated since January 2025.** Use `msv` monthly history from keyword-imports.

## SERPChecker Endpoints

### SERP Results with All Metrics
```
GET /v3/serpchecker/serps
```
**Parameters:** `location_id` (required), `kw` (required), `platform_id` (optional)
**Returns:** 50+ SEO metrics per result (Moz, Majestic, Facebook), SERP features, CTR, snapshot link.

### URL Metrics
```
GET /v3/serpchecker/url-metrics?url=https://example.com
```

### SERP Snapshot Image
```
GET /v3/serpchecker/serps/{serp_id}/snapshot
```

## Shared Endpoints

### Locations
- `GET /v3/mangools/locations?query=New+York` — search locations
- `GET /v3/mangools/locations/{location_id}` — get location detail

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

## Two-Phase Workflow

### Phase 1: Bulk Expansion → Report (~8 API calls)
1. **Check limits** — `GET /kwfinder/limits`
2. **Expand seeds** — 1× `related-keywords` per seed (N calls for N seeds). Returns hundreds of keywords with sv/cpc/kd/msv per seed. Dedup across seeds (keep highest-sv entry).
3. **Filter** — exclude sv < 150, sort descending. Include ALL qualifying keywords — no cap. If the filtered list exceeds 700, split into chunks of 700 for the next step.
4. **Bulk import** — 1× `keyword-imports` POST per chunk of up to 700 keywords. Returns updated KD, CPC, SV, MSV for all keywords. If >700 keywords, make multiple calls (each costs 10 lookups).
5. **Classify & cluster** — infer intent from keyword patterns + CPC. Derive trend from MSV history. Group into thematic clusters.
6. **Generate HTML report** — using `templates/keyword-report.html`. Output to `/data/media/kw-research-skill-{YYYYMMDD_HHMMSS}.html`. Mark intent/content as inferred (not SERP-verified).

**Total cost:** N seeds + 1 import = N+1 API requests (e.g. 7 seeds = 8 requests = 80 lookups).

### Phase 2: Targeted SERP Enrichment (on demand, per selected keyword)
After the user reviews the Phase 1 report and selects target keywords:
1. **Individual SERP lookups** — `GET /kwfinder/serps?kw={keyword}&location_id={loc}` for each selected keyword. Each call covers 1 keyword and costs 10 lookups from daily quota. Returns:
   - `searchIntent` — dict mapping keyword ID to intent array (e.g. `["informational"]`, `["transactional", "commercial"]`)
   - `contentTypes` — array (e.g. `["MEDIA_BLOGS", "HOMEPAGES", "PRODUCT_SERVICE_PAGES"]`)
   - `serpFeatures` — array (e.g. `["KNO_GRAPH", "SHOP_RESULTS", "VIDEO_PANEL"]`)
   - Full SERP items with DA/PA, backlinks, CTR per position
2. **Update the report** — replace inferred intent/content with actual SERP data
3. **Cost:** 1 call = 1 keyword = 10 lookups. 20 selected keywords = 200 lookups (40% of Premium daily budget of 500).

**When to use Phase 2:** Only after the user has reviewed the bulk report and identified specific keywords to pursue. Never do SERP lookups for the entire list in Phase 1. Daily limits reset, so Phase 2 can happen anytime.

### Seed Strategy (Critical)

When a user provides a list of categories with brand variants (e.g. "PAMPERS SENI, TENA, MOFFY, KANZ"), extract the **BROAD category term** as the seed, NOT each brand+category combo.

| User provides | Wrong approach | Correct approach |
|---------------|---------------|------------------|
| "PAMPERS SENI, TENA, MOFFY, KANZ" | seeds: "pampers seni", "tena seni", "moffy seni", "kanz seni" | seed: "pampers" → returns 595 results including all brands |
| "SCUTECE ADULTI, TENA, MOFFY" | seeds: "scutece adulti", "tena scutece", "moffy scutece" | seed: "scutece" → returns 105 results |

The related-keywords endpoint discovers brand variants naturally. One broad seed per cluster is sufficient. Specific combos return 5-10 results; broad terms return 100-600+.

### Seed Deduplication

Some categories overlap (e.g. "pardoseli" and "gresie" both cover floor cleaning). Use the broadest term that uniquely represents each cluster. If two seeds would return 80%+ overlapping results, keep only the broader one.

## HTML Report Template

Self-contained HTML file with:
- **Header:** Title "Keyword Research - [Location] (Phase 1)", subtitle with seeds/sv threshold/language/timestamp, time budget stats
- **Controls:** Cluster filter, KD filter, text search, Reset, Select All, None, Sort by Selected, Print Selected
- **Selection bar:** Live counter showing selected keyword count, total volume, est. time, cluster count (hidden when 0 selected)
- **Legend:** Intent badges (C=Commercial pink, T=Transactional gold, N=Navigational blue, I=Informational purple), Content icons (📰 Media, 🏠 Homepages, 🛍️ Product Pages, ❓ Unknown/pending Phase 2)
- **Table:** Checkbox, Keyword (with cluster tag), Volume, CPC, Intent, KD, Content, Trend, Time, Detail button
- **Detail Modal:** Full keyword info + optimization roadmap
- **Print Selected:** Opens clean printable view of only selected keywords (for Phase 2 targeting)
- **Print CSS:** Hides controls/checkboxes, keeps selected rows highlighted
- **Responsive:** Desktop grid → tablet → mobile card layout
- **Filename:** `kw-research-skill-{YYYYMMDD_HHMMSS}.html`

**CRITICAL: Every entry in the cluster array MUST have a trailing comma.** The JS array separator is `,` not newline. Without commas, the entire clusterData object fails to parse and the table renders empty. Pattern:

```javascript
const clusterData = {
    'Cluster': [
        {name:'kw1', search:100, ...},   // <-- comma here
        {name:'kw2', search:200, ...},   // <-- comma here
        {name:'kw3', search:300, ...},   // <-- comma here too (before ])
    ],
};
```

**JavaScript data format:**
```javascript
const clusterData = {
    'Cluster Name': [
        {
            name: 'keyword',
            search: 17800,
            cpc: 0.80,
            intent: ['C', 'T'],
            kd: 11,
            content: ['MB'],
            time: 3.5,
            trend: '+7%'
        }
    ]
};
```

**Color scheme (CSS variables):**
```css
--color-primary: #FE4C1C;
--color-primary-hover: #1A7A8A;
--color-success: #22C55E;
--color-warning: #F59E0B;
--color-danger: #EF4444;
--color-intent-c: #FF6B9D;
--color-intent-t: #FFB700;
--color-intent-n: #50A5FF;
--color-intent-i: #9D4EDD;
```

## Python Script Pattern

```python
import os, requests, json, time
from collections import defaultdict

API_KEY = os.environ["MANGOOLS_API_TOKEN"]
BASE_URL = "https://api.mangools.com/v3"
HEADERS = {"X-Access-Token": API_KEY}

def related_keywords(kw, location_id):
    """Seed expansion — 1 request per seed, returns hundreds of results."""
    resp = requests.get(f"{BASE_URL}/kwfinder/related-keywords",
        headers=HEADERS, params={"kw": kw, "location_id": location_id})
    resp.raise_for_status()
    return resp.json()

def keyword_imports(keywords, location_id):
    """Bulk enrichment — 1 request for up to 700 keywords. Returns KD, CPC, SV, MSV.
    Includes retry on 429 with Retry-After backoff."""
    resp = requests.post(f"{BASE_URL}/kwfinder/keyword-imports",
        headers=HEADERS, json={"keywords": keywords, "location_id": location_id})
    if resp.status_code == 429:
        wait = int(resp.headers.get("Retry-After", 15))
        print(f"  429 — waiting {wait}s...")
        time.sleep(wait)
        resp = requests.post(f"{BASE_URL}/kwfinder/keyword-imports",
            headers=HEADERS, json={"keywords": keywords, "location_id": location_id})
    resp.raise_for_status()
    return resp.json()

def check_limits():
    """Check remaining API quota."""
    resp = requests.get(f"{BASE_URL}/kwfinder/limits", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def filter_keywords(all_keywords, min_sv=150):
    """Filter sv >= min_sv, sort descending. No cap — returns all qualifying.
    Uses (kw.get('sv') or 0) to handle None sv values safely."""
    filtered = [k for k in all_keywords if (k.get('sv') or 0) >= min_sv]
    filtered.sort(key=lambda x: x.get('sv') or 0, reverse=True)
    return filtered

def derive_trend(msv):
    """Positive/Negative/Neutral from monthly history (last 6mo vs prior 6mo)."""
    if not msv or len(msv) < 4:
        return 'N/A'
    recent = msv[-6:]
    older = msv[-12:-6] if len(msv) >= 12 else msv[:len(msv)//2]
    if not recent or not older:
        return 'N/A'
    avg_r = sum(v for _, _, v in recent) / len(recent)
    avg_o = sum(v for _, _, v in older) / len(older)
    if avg_o == 0:
        return 'N/A'
    pct = ((avg_r - avg_o) / avg_o) * 100
    if pct > 5: return f'+{pct:.0f}%'
    elif pct < -5: return f'{pct:.0f}%'
    return '0%'

def estimate_time(kd):
    """Estimate optimization hours based on KD."""
    if kd is None: return 3.5
    if kd <= 10: return 3.25
    if kd <= 15: return 4.0
    return 5.0

# ── Example workflow ──
SEEDS = ["pampers", "scutece", "detergent", "curatenie"]  # BROAD terms, not "pampers seni"
LOCATION_ID = 2642  # Romania
MIN_SV = 150

# 1. Expand seeds (N requests, one per seed)
all_kw = {}
for seed in SEEDS:
    data = related_keywords(seed, LOCATION_ID)
    for kw in data.get("keywords", []):
        text = kw.get("kw", "")
        sv = kw.get("sv") or 0  # None-safe: use 'or 0' not ', 0'
        if text not in all_kw or sv > (all_kw[text].get("sv") or 0):
            all_kw[text] = kw
            all_kw[text]["_seed"] = seed
    time.sleep(0.3)

# 2. Filter (no API calls, no cap)
filtered = filter_keywords(all_kw.values(), min_sv=MIN_SV)

# 3. Bulk enrichment (1 request for all keywords)
kw_list = [k["kw"] for k in filtered]
import_data = keyword_imports(kw_list, LOCATION_ID)
import_lookup = {item["kw"]: item for item in import_data.get("keywords", [])}

# 4. Merge enriched data
final = []
for kw in filtered:
    enriched = import_lookup.get(kw["kw"], kw)
    final.append({
        "kw": kw["kw"], "seed": kw.get("_seed", ""),
        "sv": enriched.get("sv") or kw.get("sv") or 0,
        "cpc": enriched.get("cpc") or kw.get("cpc") or 0,
        "seo": enriched.get("seo"),
        "msv": enriched.get("msv") or kw.get("msv") or [],
    })
```

## Response Field Reference

**Keyword object fields (from related-keywords / keyword-imports):**
| Field | Description |
|-------|-------------|
| `_id` | Unique keyword ID |
| `kw` | Keyword text |
| `sv` | Average monthly search volume |
| `cpc` | Cost per click (USD) |
| `ppc` | Pay per click (0-100) |
| `seo` | Keyword difficulty (1-100, may be null) |
| `seo_ts` | KD cache timestamp |
| `msv` | Monthly history — `[[year, month, volume], ...]` |
| `lid` | Location ID |

## Pitfalls

1. **Auth header is `X-Access-Token`** (not `x-api-key`). Case-sensitive.
2. **API is v3** (not v1). Base URL: `https://api.mangools.com/v3`
3. **Parameter is `kw`** (not `keyword`). Location is `location_id`.
4. **KD field is `seo`** (not `keyword_difficulty`). Scale 1-100. May be `null`.
5. **`language_id` causes 500 errors** for some location/language combos (e.g. Romania=2642 + Romanian=47). Always omit `language_id` and let the API auto-detect from location. This is the safest approach — tested and confirmed.
6. **Deduplication within 24h** — identical requests are free. Re-running the same seed expansion doesn't cost lookups.
7. **Phase 1 vs Phase 2** — Phase 1 uses keyword-imports (bulk) for the initial report. Phase 2 uses kwfinder/serps (per-keyword) only for selected keywords AFTER the user reviews the report. Never do individual SERP lookups in Phase 1 — it burns quota at 10 lookups per keyword.
8. **1 API request = 10 lookups** from daily quota. A keyword-imports POST with 150 keywords still only costs 10 lookups (1 request). A related-keywords GET also costs 10 lookups (1 request). Plan your budget accordingly.
9. **Location IDs are numeric** (not country codes). Romania=2642, USA=2840, UK=2826, Germany=2276, France=2250.
10. **CPC is in USD.** Format as `$X.XX` in reports.
11. **`msv` array format:** `[year, month, volume]` — e.g., `[2024, 1, 9900]`. Use for trend analysis (compare last 6mo vs prior 6mo).
12. **No cap on filtered keywords** — after sv ≥ 150 filter, include ALL qualifying keywords. If >700, split into chunks of 700 for keyword-imports. The 700 limit is per-request, not per-day.
13. **Phase 2 cost model** — `kwfinder/serps` is per-keyword only (GET with single `kw`). 1 call = 1 keyword = 10 lookups from daily quota. There is NO bulk SERP endpoint. Plan Phase 2 budget accordingly: 20 keywords = 200 lookups.
14. **Report filename** — save to `/data/media/kw-research-skill-{YYYYMMDD_HHMMSS}.html`. All outputs go to `/data/media/` alongside uploads.
15. **Use BROAD category seeds, not brand+category combos.** This is the most expensive mistake. "pampers" returns 595 related keywords; "pampers seni" returns only 6. The related-keywords endpoint discovers brand variants naturally — "pampers" will return "pampers seni", "pampers premium care", "tena seni", "huggies", etc. When a user provides a list like "PAMPERS SENI, TENA, MOFFY, KANZ", extract the BROAD category term ("pampers") as the seed, NOT each brand+category combo. Brands show up as related keywords. One broad seed per cluster is sufficient.
16. **Handle None `sv` values safely.** Some keywords from the API have `sv: None` (not 0). Use `(kw.get("sv") or 0)` for comparisons, NOT `kw.get("sv", 0)` — the latter returns None when sv is explicitly None, causing `>` comparison errors with int. Always guard: `filtered = [kw for kw in all_kw.values() if (kw.get("sv") or 0) >= MIN_SV]`.
17. **Rate-limit retry on keyword-imports.** The bulk import endpoint can return 429 even within daily quota (per-minute limits). Add retry with `Retry-After` header backoff: check `r.headers.get("Retry-After", 15)` and sleep before retrying. Don't treat 429 as fatal.

## HTML Generation Pitfalls (CRITICAL)

These bugs were discovered the hard way. Follow the script pattern below exactly.

### Bug 1: Missing commas between array entries
Every `{name:...}` object in the clusterData array MUST have a trailing comma:
```javascript
// CORRECT:
const clusterData = {
    'Cluster': [
        {name:'kw1', search:100},  // <-- comma
        {name:'kw2', search:200},  // <-- comma
        {name:'kw3', search:300},  // <-- comma (before ] too)
    ],
};
// WRONG (causes empty table):
const clusterData = {
    'Cluster': [
        {name:'kw1', search:100}
        {name:'kw2', search:200}   // <-- missing comma = JS syntax error = empty table
    ]
};
```

### Bug 2: Regex replacement destroys HTML structure
NEVER do `content = prefix + fixed + suffix` after regex extraction — this strips the HTML wrapper. Always replace within the full content:
```python
# CORRECT:
content = content.replace(full_match, new_block)

# WRONG (destroys HTML — leaves only raw JS):
m = re.search(r'(prefix)(.*?)(suffix)', content, re.DOTALL)
content = m.group(1) + fixed + m.group(2)  # <-- loses DOCTYPE, head, body, CSS!
```

### Bug 3: Seeds too specific return too few results
Use BROAD category terms for seed expansion, not brand+category combos:
```python
# CORRECT (returns 595 results):
seed = "pampers"

# WRONG (returns 6 results):
seed = "pampers seni"
```
Brand variants (tena, moffy, kanz, etc.) appear naturally as related keywords from the broad seed.

### Verification checklist after generating HTML:
1. File starts with `<!DOCTYPE html>`
2. File ends with `</html>`
3. Every `{name:...}` entry ends with `},` (comma)
4. No `}\n` followed by `{name:` without a comma between them
5. Entry count matches expected keyword count

### Self-contained HTML generation script:
```python
import json, re
from datetime import datetime
from pathlib import Path

TS = datetime.now().strftime("%Y%m%d_%H%M%S")
template = Path("templates/keyword-report.html").read_text()
clusters = json.loads(Path("clusters.json").read_text())

PLACEHOLDER = """const clusterData = {
    'Cluster Name': [
        { name: 'keyword', search: 17800, cpc: 0.80,
          intent: ['C', 'T'], kd: 11, content: ['MB'],
          time: 3.5, trend: '+7%' }
    ]
};"""

js_lines = ["const clusterData = {"]
for cluster_name, keywords in clusters.items():
    js_lines.append(f"    '{cluster_name}': [")
    for kw in keywords:
        nm = kw["name"].replace("'", "\\'")
        kd_val = "null" if kw["kd"] is None else str(kw["kd"])
        entry = (
            f"        {{name:'{nm}',search:{kw['search']},cpc:{kw['cpc']},"
            f"intent:{json.dumps(kw['intent'])},kd:{kd_val},"
            f"content:{json.dumps(kw['content'])},"
            f"features:{json.dumps(kw['features'])},"
            f"time:{kw['time']},trend:'{kw['trend']}'}}"
        )
        js_lines.append(entry + ",")  # COMMA AFTER EVERY ENTRY
    js_lines.append("    ],")
js_lines.append("};")
js_block = "\n".join(js_lines)

report = template.replace(PLACEHOLDER, js_block)
# Update title/subtitle
report = report.replace("<title>Keyword Research Report</title>",
                        f"<title>kw-research-skill-{TS}</title>")
Path("/data/media").mkdir(parents=True, exist_ok=True)
Path(f"/data/media/kw-research-skill-{TS}.html").write_text(report)
```

## Verification

After generating a report:
1. Open HTML in browser — verify all filters work (cluster, KD, text search)
2. Check time budget = sum(keyword times) × 1.15
3. Verify all keywords have sv ≥ 150
4. Confirm intent badges display correctly
5. Test detail modal opens/closes
6. Check responsive layout on mobile
7. Validate no duplicate keywords across clusters
