# Hermes Media Plugin

A dashboard plugin for browsing, previewing, uploading, renaming, and managing files stored in `/data/media`.

## Features

- **File Browser** — grid view with typed file icons and metadata
- **Upload** — drag-and-drop zone supporting multiple files (max 50 MB each)
- **Preview** — inline preview for images, video, audio, PDFs, HTML, and text files
- **Rename** — rename files via a dialog with validation
- **Delete** — delete files with confirmation dialog
- **Download** — auth-aware download for any file
- **Dark/Light Theme** — fully theme-aware using CSS variables

## Installation

Copy the `dashboard/` directory into `~/.hermes/plugins/media/`:

```bash
cp -r dashboard/ ~/.hermes/plugins/media/dashboard/
```

Or install via the Hermes CLI:

```bash
hermes plugins install media
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/plugins/media/files` | List all files |
| GET | `/api/plugins/media/file/{path}` | Serve a file |
| GET | `/api/plugins/media/text/{path}` | Serve text content |
| POST | `/api/plugins/media/upload` | Upload a file |
| PATCH | `/api/plugins/media/file/{path}` | Rename a file |
| DELETE | `/api/plugins/media/file/{path}` | Delete a file |

## File Structure

```
media/
├── .gitignore
├── README.md
└── dashboard/
    ├── manifest.json       # Plugin manifest
    ├── plugin_api.py       # Backend API routes
    └── dist/
        ├── index.js        # Frontend (React IIFE)
        └── style.css       # Plugin styles
```

## Version History

See [CHANGELOG.md](CHANGELOG.md) for details.
