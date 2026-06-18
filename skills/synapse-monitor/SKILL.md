---
name: synapse-monitor
description: Control the Synapse Monitor visualization — enable/disable, update state, feed live data from translation or other multi-agent tasks.
tags:
  - hermes
  - visualization
  - monitoring
  - synapse
---

# Synapse Monitor

Real-time neuronal synapse visualization showing agents, files, and data flow.

## When to Use

- Multi-agent tasks (translation, batch processing, parallel work)
- When user wants to visually monitor active work
- When user asks to "open synapse", "show synapse", "enable synapse monitor"

## Enable / Disable

The Synapse Monitor is a **dashboard plugin** at `/synapse` in the Hermes web UI.

**To tell the user how to enable it:**
> "Open the Hermes dashboard, go to the Synapse tab in the sidebar. Click Demo to see a live simulation, or Live to see real task data."

**To update state programmatically** (for scripts/cron jobs):
```bash
curl -X POST http://localhost:PORT/api/plugins/synapse/update \
  -H "Content-Type: application/json" \
  -d '{"agents": [...], "files": [...], "pulses": [...], "stats": {...}}'
```

## State File Format

Write to `/data/synapse_state.json` for persistent state:

```json
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
  "stats": {
    "active_agents": 2,
    "files_processing": 1,
    "files_queued": 3,
    "files_complete": 2
  }
}
```

### Agent States
- `active` — bright cyan, pulsing glow, connected to files
- `idle` — dim blue, slow breathing

### File States
- `processing` — orange/amber, connected to an agent
- `queued` — muted purple, waiting
- `complete` — green, finished

## Integrating with Translation Scripts

In `simple_translate.py` or orchestrator, emit state updates:

```python
import json

STATE_FILE = "/data/synapse_state.json"

def update_synapse(agents, files, stats):
    state = {
        "agents": agents,
        "files": files,
        "pulses": [{"from": f["agent"], "to": f["id"], "active": True}
                   for f in files if f.get("agent")],
        "stats": stats,
    }
    with open(STATE_FILE, "w") as fh:
        json.dump(state, fh)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/plugins/synapse/status` | GET | Current state (reads `/data/synapse_state.json`) |
| `/api/plugins/synapse/demo` | GET | Generates demo state for testing |
| `/api/plugins/synapse/update` | POST | Update state from scripts |
| `/api/plugins/synapse/clear` | POST | Clear all state (stop visualization) |

## Deployment

Plugin files live in two places (update BOTH):
- `/data/hermes-agent-template/plugins/synapse/` (repo, synced on deploy)
- `/data/.hermes/plugins/synapse/` (live, loaded by Hermes)

After editing, copy to live:
```bash
cp -r /data/hermes-agent-template/plugins/synapse/dashboard/* /data/.hermes/plugins/synapse/dashboard/
rm -rf /data/.hermes/plugins/synapse/dashboard/__pycache__
```

Then restart the gateway or wait for next request.
