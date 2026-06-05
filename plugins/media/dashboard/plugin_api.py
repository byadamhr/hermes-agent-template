"""Media dashboard plugin — backend API routes.

Mounted at /api/plugins/media/ by the dashboard plugin system.

Provides endpoints to list, serve, upload, and delete files stored under
/data/media.  All paths are validated against path traversal to ensure
requests stay within the media root directory.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

MEDIA_ROOT = Path("/data/media").resolve()
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

log = logging.getLogger(__name__)

router = APIRouter()


def _safe_path(rel: str) -> Path:
    """Resolve *rel* under MEDIA_ROOT with traversal protection.

    Returns the resolved absolute path.  Raises HTTPException 400 if the
    resolved path escapes MEDIA_ROOT.
    """
    target = (MEDIA_ROOT / rel).resolve()
    try:
        target.relative_to(MEDIA_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path traversal detected")
    return target


def _file_info(filepath: Path) -> dict:
    """Build a file metadata dict for the given path."""
    rel = filepath.relative_to(MEDIA_ROOT)
    mime, _ = mimetypes.guess_type(str(filepath))
    mime = mime or "application/octet-stream"
    return {
        "name": filepath.name,
        "path": str(rel),
        "size": filepath.stat().st_size,
        "mtime": filepath.stat().st_mtime,
        "mime_type": mime,
        "is_image": mime.startswith("image/") if mime else False,
        "is_video": mime.startswith("video/") if mime else False,
        "is_audio": mime.startswith("audio/") if mime else False,
        "is_text": mime.startswith("text/") or mime == "application/json",
    }


@router.get("/files")
def list_files():
    """Recursively list all files in the media directory."""
    if not MEDIA_ROOT.is_dir():
        return []
    files = []
    for root, _dirs, filenames in os.walk(MEDIA_ROOT):
        for fname in filenames:
            fp = Path(root) / fname
            try:
                files.append(_file_info(fp))
            except OSError as exc:
                log.warning("Skipping unreadable file %s: %s", fp, exc)
    # Sort by modification time, newest first
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return files


@router.get("/file/{path:path}")
def serve_file(path: str):
    """Serve a file for download or preview."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    mime, _ = mimetypes.guess_type(str(target))
    return FileResponse(str(target), media_type=mime)


@router.get("/text/{path:path}")
def serve_text(path: str):
    """Serve a text-readable file as plain text (for preview pane)."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return JSONResponse({"content": content, "name": target.name})


@router.post("/upload")
async def upload_file(request: Request):
    """Accept a multipart file upload and save to /data/media/."""
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        return JSONResponse(
            {"error": "Expected multipart/form-data"}, status_code=400
        )

    try:
        form = await request.form()
    except Exception:
        return JSONResponse(
            {"error": "Failed to parse form data"}, status_code=400
        )

    upload = form.get("file")
    if not upload:
        return JSONResponse({"error": "No file provided"}, status_code=400)

    try:
        content = await upload.read()
    except Exception:
        return JSONResponse(
            {"error": "Failed to read file"}, status_code=400
        )

    if len(content) > MAX_UPLOAD_SIZE:
        max_mb = MAX_UPLOAD_SIZE // 1024 // 1024
        return JSONResponse(
            {"error": f"File too large (max {max_mb}MB)"},
            status_code=400,
        )

    # Sanitize filename: stem + short hash to avoid collisions
    original_name = upload.filename or "unnamed"
    stem = Path(original_name).stem[:64]
    suffix = Path(original_name).suffix[:16]
    file_hash = hashlib.sha256(content).hexdigest()[:12]
    safe_name = f"{stem}_{file_hash}{suffix}"

    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    dest = MEDIA_ROOT / safe_name
    dest.write_bytes(content)

    log.info("[media upload] %s -> %s (%d bytes)", original_name, dest, len(content))

    return JSONResponse(
        {"ok": True, "path": safe_name, "name": original_name, "size": len(content)}
    )


@router.patch("/file/{path:path}")
def rename_file(path: str, body: dict):
    """Rename/move a file within the media directory."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    new_name = (body.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required")

    # Only allow the filename portion — no path separators
    new_name = Path(new_name).name
    if not new_name or new_name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid name")

    dest = target.parent / new_name
    if dest.exists() and dest != target:
        raise HTTPException(status_code=409, detail="A file with that name already exists")

    target.rename(dest)
    new_rel = str(dest.relative_to(MEDIA_ROOT))
    return {"ok": True, "path": new_rel, "name": new_name}


@router.delete("/file/{path:path}")
def delete_file(path: str):
    """Delete a file from the media directory."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    return {"status": "deleted", "path": path}
