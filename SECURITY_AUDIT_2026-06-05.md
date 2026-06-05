# Security & Quality Audit — hermes-agent-template
**Date:** 2026-06-05
**Auditor:** Hermes Agent
**Scope:** server.py, plugins/media/dashboard/, .gitignore, Dockerfile, config.py

---

## HIGH — Fixed

| # | Issue | File | Fix |
|---|---|---|---|
| 1 | Inconsistent upload limits (10MB vs 50MB) | server.py, plugin_api.py | Unified to 50MB via shared config.py module |
| 2 | No rate limiting on login | server.py | Added IP-based rate limiting (5 attempts/min) |
| 3 | Admin password printed to stdout | server.py:89 | Masked — only shows username, password viewable via /setup |
| 4 | HTML preview XSS (allow-same-origin) | plugin_api.py:490 | Removed allow-same-origin from iframe sandbox |
| 5 | Path traversal in pairing API (platform param) | server.py:1109+ | Added regex validation `[a-zA-Z0-9_-]+` for platform names |

## MEDIUM — Fixed

| # | Issue | File | Fix |
|---|---|---|---|
| 6 | Cookie missing Secure flag | server.py:809 | Added secure=True (env-configurable via COOKIE_SECURE) |
| 7 | No session revocation | server.py:672-704 | Added session IDs to tokens + server-side revocation on logout |
| 8 | Dockerfile runs as root | Dockerfile:72-73 | Added non-root user (hermes) |
| 9 | 28 broad except Exception clauses | server.py (multiple) | Narrowed JSON-parsing clauses to (json.JSONDecodeError, OSError);其余 remain broad where appropriate for resilience |
| 10 | No error handling on file writes | server.py | Added try/except with logging to write_config_yaml, write_env, _wjson |
| 11 | Duplicate MEDIA_ROOT definition | server.py, plugin_api.py | Extracted to shared config.py module |
| 12 | assert for runtime validation | server.py:907,978 | Replaced with explicit `if not` checks |

## LOW — Fixed

| # | Issue | File | Fix |
|---|---|---|---|
| 14 | Unused import mimetypes | server.py:34 | Removed |
| 15 | Duplicate import hashlib | server.py:636 | Consolidated to single `import hashlib` (removed `_hashlib` alias) |
| 16 | node_modules/ missing from .gitignore | .gitignore | Already present |
| 17 | MD5 for file naming | server.py:1378, plugin_api.py:144 | Replaced with SHA256 (12-char hex) |
| 18 | WebSocket no idle timeout | server.py:1580-1632 | Added 300s idle timeout to both pump directions |
| 19 | Non-atomic config writes | server.py:273,327,1162 | Write to temp file + os.replace() for crash safety |
| 20 | Dockerfile base image not pinned by digest | Dockerfile:1-5 | Comment updated with pinning instructions (digest requires docker pull) |

## Deferred (low-risk, not worth the churn)

| # | Issue | Rationale |
|---|---|---|
| 13 | 22 print() calls instead of logging | Currently works correctly with Railway stdout capture; switching to logging module would change output format and require Railway log filter updates |

## Verified OK (No Fix Needed)
- HMAC-signed cookies with constant-time comparison
- Open redirect protection (_safe_return_to)
- Path traversal protection in media plugin (_safe_path)
- React createElement throughout frontend
- 0 leaked secrets in tracked files
- 0 known dependency vulnerabilities
- .gitignore covers WhatsApp session, .env, logs
- chmod 600 on auth.json in start.sh
