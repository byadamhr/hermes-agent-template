"""Synapse Monitor dashboard plugin — backend API routes.

Mounted at /api/plugins/synapse/ by the dashboard plugin system.

Provides live status data for the neuronal synapse visualization.
Scripts write state updates to /data/synapse_state.json, and this
API serves them to the frontend.

State file format:
{
  "agents": [
    {"id": "orchestrator", "label": "Orchestrator", "state": "active"},
    {"id": "worker-1", "label": "Worker-1", "state": "active"}
  ],
  "files": [
    {"id": "f1", "label": "GB_T_4501.docx", "state": "processing", "agent": "worker-1"},
    {"id": "f2", "label": "GB_T_4502.docx", "state": "queued"}
  ],
  "pulses": [
    {"from": "worker-1", "to": "f1", "active": true}
  ],
  "stats": {"active_agents": 2, "files_processing": 1, "files_queued": 3, "files_complete": 2}
}
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)
router = APIRouter()

STATE_FILE = Path("/data/synapse_state.json")
DEMO_STATE = Path("/data/hermes-agent-template/plugins/synapse/demo_state.json")


def _read_state() -> dict:
    """Read current state from file, or return demo/mock state."""
    # Try live state first
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Failed to read synapse state: %s", e)

    # Fall back to demo state
    if DEMO_STATE.exists():
        try:
            return json.loads(DEMO_STATE.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    # Return empty state
    return {
        "agents": [],
        "files": [],
        "pulses": [],
        "stats": {"active_agents": 0, "files_processing": 0, "files_queued": 0, "files_complete": 0},
        "last_update": 0,
    }


@router.get("/status")
def get_status():
    """Get current synapse visualization state."""
    state = _read_state()
    state["last_update"] = time.time()
    return JSONResponse(state)


@router.post("/update")
def update_state(body: dict):
    """Update synapse state (called by translation scripts)."""
    # Validate required fields
    if "agents" not in body and "files" not in body:
        raise HTTPException(status_code=400, detail="Must provide 'agents' or 'files'")

    # Merge with existing state
    current = _read_state()

    if "agents" in body:
        current["agents"] = body["agents"]
    if "files" in body:
        current["files"] = body["files"]
    if "pulses" in body:
        current["pulses"] = body["pulses"]
    if "stats" in body:
        current["stats"] = body["stats"]

    current["last_update"] = time.time()

    # Write to live state file
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(current, indent=2))

    return {"ok": True, "state": current}


@router.post("/clear")
def clear_state():
    """Clear synapse state (stop visualization)."""
    empty = {
        "agents": [],
        "files": [],
        "pulses": [],
        "stats": {"active_agents": 0, "files_processing": 0, "files_queued": 0, "files_complete": 0},
        "last_update": time.time(),
    }
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(empty, indent=2))
    return {"ok": True}


@router.get("/demo")
def get_demo_state():
    """Generate a demo state for testing the visualization."""
    import random

    agents = [
        {"id": "orchestrator", "label": "Orchestrator", "state": "active"},
    ]
    worker_states = ["active", "active", "idle", "idle"]
    for i, s in enumerate(worker_states, 1):
        agents.append({"id": f"worker-{i}", "label": f"Worker-{i}", "state": s})

    file_names = [
        "File-001", "File-002", "File-003", "File-004",
        "File-005", "File-006", "File-007", "File-008",
    ]
    file_states = ["processing", "processing", "processing", "queued",
                   "queued", "complete", "complete", "queued"]
    files = []
    for i, (name, state) in enumerate(zip(file_names, file_states)):
        agent = f"worker-{(i // 2) + 1}" if state != "complete" else None
        files.append({"id": f"f{i+1}", "label": f"{name}.docx", "state": state, "agent": agent})

    pulses = []
    for f in files:
        if f["state"] == "processing" and f.get("agent"):
            pulses.append({"from": f["agent"], "to": f["id"], "active": True})

    stats = {
        "active_agents": sum(1 for a in agents if a["state"] == "active"),
        "files_processing": sum(1 for f in files if f["state"] == "processing"),
        "files_queued": sum(1 for f in files if f["state"] == "queued"),
        "files_complete": sum(1 for f in files if f["state"] == "complete"),
    }

    return JSONResponse({
        "agents": agents,
        "files": files,
        "pulses": pulses,
        "stats": stats,
        "last_update": time.time(),
    })


# -------------------------------------------------------------------
# Standalone full-screen page (for secondary monitor)
# -------------------------------------------------------------------

_STANDALONE_HTML = (Path(__file__).parent / "standalone.html").resolve()


@router.get("/standalone")
def serve_standalone():
    """Serve the standalone full-screen synapse visualization."""
    if not _STANDALONE_HTML.exists():
        raise HTTPException(status_code=404, detail="Standalone page not found")
    from fastapi.responses import HTMLResponse
    return HTMLResponse(_STANDALONE_HTML.read_text(encoding="utf-8"))
