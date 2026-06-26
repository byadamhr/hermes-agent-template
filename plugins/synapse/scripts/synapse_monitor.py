#!/usr/bin/env python3
"""Dynamic synapse monitor — discovers all files, reads checkpoints + logs, writes state."""
import json, time, re, os, glob
from pathlib import Path

STATE_FILE = Path("/data/synapse_state.json")
CHECKPOINT_DIR = Path("/data/media/.checkpoints")
LOG_DIR = "/tmp"
MEDIA_DIR = Path("/data/media")
TRANSLATIONS_DIR = Path("/data/media/translations")
LOGS_DIR = Path("/data/media/translation_logs")

def get_active_workers():
    """Scan /proc for active simple_translate.py workers. Returns dict of pid -> info.
    Only counts the actual python3 processes (not bash wrapper parents)."""
    workers = {}
    for pid_dir in os.listdir("/proc"):
        if not pid_dir.isdigit():
            continue
        try:
            cmdline_raw = open(f"/proc/{pid_dir}/cmdline", "rb").read()
            # Replace null bytes with spaces (proc cmdline uses \x00 as separator)
            cmdline = cmdline_raw.replace(b"\x00", b" ").decode("utf-8", errors="replace")
            # Only match actual python3 processes, not bash wrappers
            if "simple_translate.py" in cmdline and "python3" in cmdline.split("simple_translate.py")[0]:
                # Skip bash wrapper processes (they contain "setsid" or "bash")
                if "setsid" in cmdline or "bash" in cmdline.split("python3")[0]:
                    continue
                # Parse key-index from cmdline
                key_match = re.search(r'--key-index\s+(\d+)', cmdline)
                # Match file path until next --flag or end (handles spaces in filenames)
                file_match = re.search(r'--file\s+(.+?)(?:\s+--\w|\s*$)', cmdline)
                key_idx = int(key_match.group(1)) if key_match else 0
                filepath = file_match.group(1).strip().strip("'\"") if file_match else None
                workers[pid_dir] = {"key_index": key_idx, "file": filepath}
        except (FileNotFoundError, PermissionError):
            pass
    return workers

def get_all_docx_files():
    """Discover all .docx files in media dir (excluding translated/clean)."""
    files = []
    for f in sorted(os.listdir(MEDIA_DIR)):
        if not f.endswith('.docx') or '_translated' in f or '_clean' in f:
            continue
        fpath = MEDIA_DIR / f
        if fpath.is_file():
            files.append(f)
    return files

def get_historical_speed():
    """Calculate average segments/sec from completed translation logs + summaries."""
    speeds = []
    # From /tmp logs
    for log_path in Path(LOG_DIR).glob("translate_*.log"):
        try:
            content = log_path.read_text()
            seg_match = re.search(r'Found (\d+) Chinese segments', content)
            time_match = re.search(r'TIME:\s+([\d.]+)s', content)
            if seg_match and time_match:
                segments = int(seg_match.group(1))
                elapsed = float(time_match.group(1))
                if elapsed > 0 and segments > 0:
                    speeds.append(segments / elapsed)
        except:
            pass
    # From translation_logs summaries
    if LOGS_DIR.exists():
        for summary in LOGS_DIR.glob("*_summary.md"):
            try:
                content = summary.read_text()
                seg_match = re.search(r'(\d+)\s*/\s*\d+\s*\|', content)  # "done / total" format
                if not seg_match:
                    seg_match = re.search(r'(\d+)\s+segments', content)
                time_match = re.search(r'([\d.]+)\s*s\s*\(', content)  # "123.4s (2.1m)"
                if seg_match and time_match:
                    segments = int(seg_match.group(1))
                    elapsed = float(time_match.group(1))
                    if elapsed > 0 and segments > 0:
                        speeds.append(segments / elapsed)
            except:
                pass
    return sum(speeds) / len(speeds) if speeds else 3.0

def get_file_progress(filename, avg_speed):
    """Determine progress for a single file. Returns dict with state info."""
    base = filename.replace(".docx", "")
    
    # Check if translation is complete
    translated = TRANSLATIONS_DIR / f"{base}_translated.docx"
    if translated.exists():
        # Get segment count from summary if available
        summary = LOGS_DIR / f"{base}_summary.md"
        segments = 0
        if summary.exists():
            try:
                content = summary.read_text()
                m = re.search(r'(\d+)\s*/\s*(\d+)', content)
                if m:
                    segments = int(m.group(2))
            except:
                pass
        return {"state": "complete", "progress": 1.0, "segments_total": segments, 
                "segments_done": segments, "eta_seconds": 0, "agent": None}
    
    # Check checkpoint
    ckpt_path = CHECKPOINT_DIR / f"{base}.json"
    if ckpt_path.exists():
        try:
            ckpt = json.loads(ckpt_path.read_text())
            total = ckpt.get("total_items", 0)
            done = len(ckpt.get("translations", {}))
            phase = ckpt.get("phase", "")
            
            if phase in ("translated", "complete"):
                return {"state": "complete", "progress": 1.0, "segments_total": total,
                        "segments_done": total, "eta_seconds": 0, "agent": None}
            
            if done > 0 and total > 0:
                progress = done / total
                # ETA from checkpoint update speed
                try:
                    ckpt_mtime = ckpt_path.stat().st_mtime
                    elapsed = time.time() - ckpt_mtime + (done * 0.5)  # rough estimate
                    speed = done / elapsed if elapsed > 0 else avg_speed
                    remaining = total - done
                    eta = int(remaining / speed) if speed > 0 else None
                except:
                    eta = int((total - done) / avg_speed) if avg_speed > 0 else None
                
                return {"state": "processing", "progress": progress, "segments_total": total,
                        "segments_done": done, "eta_seconds": eta, "agent": None}
        except:
            pass
    
    # Check log file for this file
    log_patterns = [
        f"translate_{base}.log",
        f"translate_{filename.replace(' ', '_').replace('.docx', '')}.log",
    ]
    for pattern in log_patterns:
        log_path = Path(LOG_DIR) / pattern
        if log_path.exists():
            try:
                content = log_path.read_text()
                seg_match = re.search(r'Found (\d+) Chinese segments', content)
                total = int(seg_match.group(1)) if seg_match else 0
                
                if "Summary:" in content or "SUMMARY:" in content:
                    return {"state": "complete", "progress": 1.0, "segments_total": total,
                            "segments_done": total, "eta_seconds": 0, "agent": None}
                elif "ERROR" in content:
                    return {"state": "error", "progress": 0, "segments_total": total,
                            "segments_done": 0, "eta_seconds": None, "agent": None}
                elif "Sending" in content or total > 0:
                    eta = int(total / avg_speed) if total > 0 and avg_speed > 0 else 120
                    return {"state": "processing", "progress": 0, "segments_total": total,
                            "segments_done": 0, "eta_seconds": eta, "agent": None}
            except:
                pass
    
    # Not started
    estimated = 300
    eta = int(estimated / avg_speed) if avg_speed > 0 else None
    return {"state": "queued", "progress": 0, "segments_total": 0,
            "segments_done": 0, "eta_seconds": eta, "agent": None}

def build_agents(active_workers):
    """Build agent list with orchestrator + 6 workers."""
    agents = [{"id": "orchestrator", "label": "Orchestrator", "state": "active"}]
    # Map active worker PIDs to worker-1..N sequentially
    active_pids = list(active_workers.keys())
    active_worker_ids = set()
    for i, pid in enumerate(active_pids[:6]):
        active_worker_ids.add(f"worker-{i+1}")
    for i in range(1, 7):
        wid = f"worker-{i}"
        agents.append({
            "id": wid,
            "label": wid,
            "state": "active" if wid in active_worker_ids else "idle"
        })
    return agents

def update_state():
    """Full state rebuild — discover files, check progress, write state."""
    avg_speed = get_historical_speed()
    active_workers = get_active_workers()
    all_files = get_all_docx_files()
    
    # Build file states
    files_state = []
    worker_file_map = {}  # filename -> worker index (1-based)
    
    # Map active workers to their files by worker order
    active_pids = list(active_workers.keys())
    for i, pid in enumerate(active_pids[:6]):
        info = active_workers[pid]
        if info["file"]:
            fname = os.path.basename(info["file"])
            worker_file_map[fname] = i + 1  # worker-1, worker-2, ...
    
    for i, filename in enumerate(all_files):
        progress = get_file_progress(filename, avg_speed)
        
        # Assign agent if this file is being processed by a worker
        assigned_worker = None
        if filename in worker_file_map:
            assigned_worker = f"worker-{worker_file_map[filename]}"
        
        # Only mark as processing if we actually have an active worker for it
        if assigned_worker and progress["state"] != "complete":
            progress["state"] = "processing"
            progress["agent"] = assigned_worker
        
        label = filename.replace(".docx", "")[:25]
        files_state.append({
            "id": f"f{i+1}",
            "label": label,
            "state": progress["state"],
            "agent": progress["agent"],
            "progress": round(progress["progress"], 3),
            "segments_total": progress["segments_total"],
            "segments_done": progress["segments_done"],
            "eta_seconds": progress["eta_seconds"],
            "avg_speed": round(avg_speed, 1),
        })
    
    agents = build_agents(active_workers)
    
    # Build pulses (active worker -> file connections)
    pulses = []
    for f in files_state:
        if f["state"] == "processing" and f.get("agent"):
            pulses.append({"from": f["agent"], "to": f["id"], "active": True})
    
    stats = {
        "active_agents": sum(1 for a in agents if a["state"] == "active") + 1,
        "files_processing": sum(1 for f in files_state if f["state"] == "processing"),
        "files_queued": sum(1 for f in files_state if f["state"] == "queued"),
        "files_complete": sum(1 for f in files_state if f["state"] == "complete"),
        "files_error": sum(1 for f in files_state if f["state"] == "error"),
        "total_files": len(files_state),
        "avg_speed": round(avg_speed, 1),
        "active_workers": len(active_workers),
    }
    
    state = {
        "agents": agents,
        "files": files_state,
        "pulses": pulses,
        "stats": stats,
        "last_update": time.time(),
    }
    
    STATE_FILE.write_text(json.dumps(state, indent=2))
    return state

if __name__ == "__main__":
    print("Synapse Monitor — dynamic file discovery")
    print(f"Media: {MEDIA_DIR} | State: {STATE_FILE}")
    while True:
        try:
            state = update_state()
            s = state["stats"]
            print(f"[{time.strftime('%H:%M:%S')}] Workers: {s['active_workers']} | "
                  f"Processing: {s['files_processing']} | Queued: {s['files_queued']} | "
                  f"Done: {s['files_complete']}/{s['total_files']}")
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(5)
