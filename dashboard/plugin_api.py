"""Media dashboard plugin — backend API routes.

Mounted at /api/plugins/media/ by the dashboard plugin system.

Provides endpoints to list, serve, upload, move, and delete files/folders
stored under /data/media.  All paths are validated against path traversal.
"""
from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

MEDIA_ROOT = Path("/data/media").resolve()
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

log = logging.getLogger(__name__)

router = APIRouter()


def _safe_path(rel: str) -> Path:
    """Resolve *rel* under MEDIA_ROOT with traversal protection."""
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


def _folder_info(dirpath: Path) -> dict:
    """Build a folder metadata dict."""
    rel = dirpath.relative_to(MEDIA_ROOT)
    # Count children (files + subdirs)
    try:
        children = list(dirpath.iterdir())
        file_count = sum(1 for c in children if c.is_file())
        folder_count = sum(1 for c in children if c.is_dir())
    except OSError:
        file_count = 0
        folder_count = 0
    return {
        "name": dirpath.name,
        "path": str(rel),
        "file_count": file_count,
        "folder_count": folder_count,
        "mtime": dirpath.stat().st_mtime,
    }


# -------------------------------------------------------------------
# List files in a specific folder (non-recursive)
# -------------------------------------------------------------------

@router.get("/files")
def list_files(path: str = Query("", alias="path")):
    """List files in the given subfolder. Empty path = root."""
    base = _safe_path(path) if path else MEDIA_ROOT
    if not base.is_dir():
        return {"files": [], "folders": []}
    files = []
    folders = []
    for entry in sorted(base.iterdir(), key=lambda e: e.name.lower()):
        try:
            if entry.is_file():
                files.append(_file_info(entry))
            elif entry.is_dir():
                folders.append(_folder_info(entry))
        except OSError as exc:
            log.warning("Skipping unreadable entry %s: %s", entry, exc)
    # Sort files by mtime newest first
    files.sort(key=lambda f: f["mtime"], reverse=True)
    # Sort folders alphabetically
    folders.sort(key=lambda f: f["name"].lower())
    return {"files": files, "folders": folders}


# -------------------------------------------------------------------
# List all files (flat, for backward compat)
# -------------------------------------------------------------------

@router.get("/all-files")
def list_all_files():
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
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return files


# -------------------------------------------------------------------
# Serve file / text
# -------------------------------------------------------------------

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


# -------------------------------------------------------------------
# Upload
# -------------------------------------------------------------------

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

    # Optional subfolder path (always a string from form field)
    dest_folder = str(form.get("folder", ""))

    try:
        content = await upload.read()
    except Exception:
        return JSONResponse({"error": "Failed to read file"}, status_code=400)

    if len(content) > MAX_UPLOAD_SIZE:
        max_mb = MAX_UPLOAD_SIZE // 1024 // 1024
        return JSONResponse(
            {"error": f"File too large (max {max_mb}MB)"},
            status_code=400,
        )

    original_name = upload.filename or "unnamed"
    stem = Path(original_name).stem[:64]
    suffix = Path(original_name).suffix[:16]
    file_hash = hashlib.sha256(content).hexdigest()[:12]
    safe_name = f"{stem}_{file_hash}{suffix}"

    # Determine destination directory
    if dest_folder:
        target_dir = _safe_path(dest_folder)
    else:
        target_dir = MEDIA_ROOT

    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / safe_name
    dest.write_bytes(content)

    rel_path = str(dest.relative_to(MEDIA_ROOT))
    log.info("[media upload] %s -> %s (%d bytes)", original_name, dest, len(content))

    return JSONResponse(
        {"ok": True, "path": rel_path, "name": original_name, "size": len(content)}
    )


# -------------------------------------------------------------------
# Rename / move file
# -------------------------------------------------------------------

@router.patch("/file/{path:path}")
def rename_file(path: str, body: dict):
    """Rename or move a file within the media directory."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    new_name = (body.get("name") or "").strip()
    new_folder = (body.get("folder") or "").strip()

    if not new_name and not new_folder:
        raise HTTPException(status_code=400, detail="Name or folder is required")

    # Determine destination
    if new_folder:
        dest_dir = _safe_path(new_folder)
        dest_dir.mkdir(parents=True, exist_ok=True)
    else:
        dest_dir = target.parent

    final_name = new_name if new_name else target.name
    final_name = Path(final_name).name  # strip any path separators
    if not final_name or final_name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid name")

    dest = dest_dir / final_name
    if dest.exists() and dest != target:
        raise HTTPException(status_code=409, detail="A file with that name already exists")

    target.rename(dest)
    new_rel = str(dest.relative_to(MEDIA_ROOT))
    return {"ok": True, "path": new_rel, "name": final_name}


# -------------------------------------------------------------------
# Delete file
# -------------------------------------------------------------------

@router.delete("/file/{path:path}")
def delete_file(path: str):
    """Delete a file from the media directory."""
    target = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    return {"status": "deleted", "path": path}


# -------------------------------------------------------------------
# Folder management
# -------------------------------------------------------------------

@router.post("/folder")
def create_folder(body: dict):
    """Create a new folder."""
    name = (body.get("name") or "").strip()
    parent_path = (body.get("parent") or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")
    # Only allow simple folder names
    name = Path(name).name
    if not name or name.startswith(".") or "/" in name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    if parent_path:
        parent = _safe_path(parent_path)
    else:
        parent = MEDIA_ROOT

    target = parent / name
    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")

    target.mkdir(parents=True)
    rel = str(target.relative_to(MEDIA_ROOT))
    log.info("[media] Created folder: %s", rel)
    return {"ok": True, "path": rel, "name": name}


@router.delete("/folder/{path:path}")
def delete_folder(path: str):
    """Delete a folder and all its contents."""
    target = _safe_path(path)
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    if target == MEDIA_ROOT:
        raise HTTPException(status_code=400, detail="Cannot delete root folder")
    shutil.rmtree(target)
    log.info("[media] Deleted folder: %s", path)
    return {"status": "deleted", "path": path}


@router.patch("/folder/{path:path}")
def rename_folder(path: str, body: dict):
    """Rename a folder."""
    target = _safe_path(path)
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    if target == MEDIA_ROOT:
        raise HTTPException(status_code=400, detail="Cannot rename root folder")

    new_name = (body.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required")
    new_name = Path(new_name).name
    if not new_name or new_name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid name")

    dest = target.parent / new_name
    if dest.exists() and dest != target:
        raise HTTPException(status_code=409, detail="A folder with that name already exists")

    target.rename(dest)
    new_rel = str(dest.relative_to(MEDIA_ROOT))
    return {"ok": True, "path": new_rel, "name": new_name}


# -------------------------------------------------------------------
# Move files (batch)
# -------------------------------------------------------------------

@router.post("/move")
def move_files(body: dict):
    """Move one or more files to a target folder."""
    paths = body.get("paths", [])
    dest_folder = (body.get("dest") or "").strip()

    if not paths:
        raise HTTPException(status_code=400, detail="No files specified")

    if dest_folder:
        dest_dir = _safe_path(dest_folder)
        dest_dir.mkdir(parents=True, exist_ok=True)
    else:
        dest_dir = MEDIA_ROOT

    moved = []
    errors = []
    for p in paths:
        src = _safe_path(p)
        if not src.is_file():
            errors.append({"path": p, "error": "File not found"})
            continue
        dest = dest_dir / src.name
        if dest.exists():
            errors.append({"path": p, "error": "File already exists at destination"})
            continue
        src.rename(dest)
        moved.append({"from": p, "to": str(dest.relative_to(MEDIA_ROOT))})

    return {"ok": len(errors) == 0, "moved": moved, "errors": errors}
