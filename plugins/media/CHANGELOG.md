# Changelog

All notable changes to the Hermes Media plugin.

## [1.0.0] — 2026-06-04

### Initial Release

#### Core Features
- **File Browser** — grid view of all files in `/data/media` with typed icons, size, and relative timestamps
- **Upload** — drag-and-drop zone supporting multiple files with progress counter, max 50 MB each
- **Preview Modal** — click any file to open a full preview:
  - Images: full-size view via auth-fetched blob URLs
  - Video: inline player with controls and auto-play
  - Audio: native player with playback controls
  - PDF: rendered in sandboxed iframe
  - HTML: rendered in iframe with scripts enabled (shows actual page, not source)
  - Text/Code/JSON/CSV: monospace preformatted viewer
  - Binary (zip, doc, etc.): clean placeholder with download button
- **Rename** — dialog with auto-focus, extension-aware selection, validation, and conflict detection
- **Delete** — floating ✕ button on card hover with confirmation dialog
- **Download** — auth-aware download for any file type

#### Backend API (`plugin_api.py`)
- `GET /files` — recursive file listing with metadata
- `GET /file/{path}` — serve file for preview/download
- `GET /text/{path}` — serve text content for preview
- `POST /upload` — multipart file upload with filename sanitization
- `PATCH /file/{path}` — rename file with validation
- `DELETE /file/{path}` — delete file

#### Auth & Security
- All API calls use `X-Hermes-Session-Token` header (matching dashboard auth middleware)
- Path traversal protection on all file operations
- Filename sanitization on upload (stem + hash to avoid collisions)
- Max upload size enforcement (50 MB)

#### UI/UX
- Theme-aware CSS using `--color-card-foreground` and `--color-card` variables
- Floating delete button (top-right, appears on hover)
- Loading spinners during async operations
- Error states with retry buttons
- Empty state with helpful guidance

### Bug Fixes
- Fixed 401 error on file listing by using `SDK.fetchJSON()` instead of raw `fetch()`
- Fixed plugin registration to use `window.__HERMES_PLUGINS__.register()` instead of non-existent `SDK.registerTab()`
- Fixed broken image previews by using correct auth header `X-Hermes-Session-Token` (was `Hermes-Session-Token`)
- Fixed upload not working (same header name fix)
- Fixed PDF preview crashing UI by rendering in iframe instead of trying to parse as text
- Fixed HTML preview showing source code by rendering in iframe with `allow-scripts`
- Fixed invisible filename text by using `--color-card-foreground` instead of `--color-foreground`
- Fixed invisible "Media Files" header (same CSS variable fix)
- Fixed sidebar nav text opacity by overriding `text-text-secondary` and `text-text-tertiary` globally

### Dependencies
- React (via `window.__HERMES_PLUGIN_SDK__`)
- Hermes Plugin SDK (`window.__HERMES_PLUGINS__`)
- FastAPI (backend)
