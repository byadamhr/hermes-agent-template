---
name: change-tracking
description: Auto-backup files before editing, log changes with context, and revert when needed. Use whenever modifying files outside version control (deployed configs, server scripts, infra files).
tags: [backup, revert, versioning, change-tracking, safety]
---

# Change Tracking Skill

## When to Use

Any time you modify files **outside of git** — deployed server configs, Railway files, infrastructure scripts, Dockerfiles, or any file that lacks its own version history. This is your safety net.

## Directory Structure

```
~/.hermes/backups/
├── changelog.jsonl          # append-only log of every change
├── <timestamp>_<filename>/  # one dir per edit event
│   ├── original             # pre-edit snapshot
│   ├── modified             # post-edit snapshot (if applied)
│   └── meta.json            # {file, reason, session, timestamp}
```

## Step 1: Backup Before Editing

Before ANY `patch()` or `write_file()` on a tracked file:

```python
from hermes_tools import terminal, read_file, write_file
import json, time, os

BACKUP_DIR = os.path.expanduser("~/.hermes/backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

file_path = "/app/server.py"
reason = "Reverting API proxy forwarding that broke TUI display"
timestamp = time.strftime("%Y%m%d_%H%M%S")
safe_name = file_path.replace("/", "_").strip("_")
event_dir = f"{BACKUP_DIR}/{timestamp}_{safe_name}"

os.makedirs(event_dir, exist_ok=True)

# Read original
original = read_file(file_path)
with open(f"{event_dir}/original", "w") as f:
    f.write(original["content"])

# Save metadata
meta = {
    "file": file_path,
    "reason": reason,
    "timestamp": time.time(),
    "session_id": "current"
}
with open(f"{event_dir}/meta.json", "w") as f:
    json.dump(meta, f, indent=2)
```

Then apply the edit normally.

After editing, save the modified version too:

```python
modified = read_file(file_path)
with open(f"{event_dir}/modified", "w") as f:
    f.write(modified["content"])
```

## Step 2: Log to Changelog

After every edit, append to `~/.hermes/backups/changelog.jsonl`:

```python
import json, os, time

entry = {
    "timestamp": time.time(),
    "file": file_path,
    "action": "revert",       # "edit", "revert", "create", "delete"
    "reason": reason,
    "backup_dir": event_dir
}
with open(os.path.expanduser("~/.hermes/backups/changelog.jsonl"), "a") as f:
    f.write(json.dumps(entry) + "\n")
```

## Step 3: List Recent Changes

```bash
# Last 10 changes
tail -10 ~/.hermes/backups/changelog.jsonl | python3 -c "
import sys, json
from datetime import datetime
for line in sys.stdin:
    e = json.loads(line)
    ts = datetime.fromtimestamp(e['timestamp']).strftime('%Y-%m-%d %H:%M')
    print(f'{ts}  {e[\"action\"]:8s}  {e[\"file\"]}  — {e[\"reason\"][:60]}')
"
```

## Step 4: Revert a File

To revert a specific file to its pre-edit state:

```bash
# Find the backup
ls ~/.hermes/backups/ | grep server_py

# Copy original back
cp ~/.hermes/backups/<timestamp>_app_server.py/original /app/server.py
```

Or via Python:

```python
from hermes_tools import read_file, write_file

backup_original = read_file(f"{event_dir}/original")
write_file(file_path, backup_original["content"])

# Log the revert
entry = {
    "timestamp": time.time(),
    "file": file_path,
    "action": "revert",
    "reason": f"Reverted change from {event_dir}",
    "backup_dir": event_dir
}
with open(os.path.expanduser("~/.hermes/backups/changelog.jsonl"), "a") as f:
    f.write(json.dumps(entry) + "\n")
```

## Step 5: Revert Last Change to a File

Find the most recent edit for a given file and revert it:

```bash
# Find last backup for a file
grep '"server.py"' ~/.hermes/backups/changelog.jsonl | tail -1 | python3 -c "
import sys, json
e = json.loads(sys.stdin.read())
print(e['backup_dir'])
"
```

## Quick Reference — Full Backup+Edit+Log Script

Copy this into `execute_code` before any risky edit:

```python
import json, os, time
from hermes_tools import read_file, write_file, terminal

BACKUP_DIR = os.path.expanduser("~/.hermes/backups")
CHANGELOG = os.path.join(BACKUP_DIR, "changelog.jsonl")
os.makedirs(BACKUP_DIR, exist_ok=True)

def backup_and_edit(file_path, reason, new_content=None, patch_fn=None):
    """Backup a file, apply changes, log everything."""
    ts = time.strftime("%Y%m%d_%H%M%S")
    safe = file_path.replace("/", "_").strip("_")
    event_dir = os.path.join(BACKUP_DIR, f"{ts}_{safe}")
    os.makedirs(event_dir, exist_ok=True)

    # Save original
    orig = read_file(file_path)
    with open(os.path.join(event_dir, "original"), "w") as f:
        f.write(orig["content"])

    # Apply changes
    if new_content:
        write_file(file_path, new_content)
    elif patch_fn:
        patch_fn()

    # Save modified
    mod = read_file(file_path)
    with open(os.path.join(event_dir, "modified"), "w") as f:
        f.write(mod["content"])

    # Save metadata + log
    meta = {"file": file_path, "reason": reason, "timestamp": time.time()}
    with open(os.path.join(event_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    entry = {"timestamp": time.time(), "file": file_path, "action": "edit",
             "reason": reason, "backup_dir": event_dir}
    with open(CHANGELOG, "a") as f:
        f.write(json.dumps(entry) + "\n")

    return event_dir

# Usage:
# backup_and_edit("/app/server.py", "Added proxy routes for API server")
```

## Pitfalls

- **Large files**: `read_file` caps at 100K chars. For bigger files, use `terminal("cp ...")` directly.
- **Binary files**: This skill tracks text only. For binaries, use `terminal("cp")` for backup.
- **Stale backups**: Old backups pile up. Periodically prune `~/.hermes/backups/` — keep last 30 days.
- **Non-atomic**: The backup happens in the same session as the edit. If the session dies mid-edit, you have the original but not the modified version (which is usually what you want — the original is safe).
