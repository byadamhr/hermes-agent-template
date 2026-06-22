(function () {
  "use strict";
  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;
  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useCallback = SDK.hooks.useCallback;
  var useRef = SDK.hooks.useRef;

  // ─── Colors ───────────────────────────────────────────────────
  var C = {
    bg: "#0a0e1a",
    active: "#64ffda",
    idle: "#3a506b",
    processing: "#ffb347",
    queued: "#4a4a6a",
    complete: "#45b764",
    pulse: "#64ffda",
    text: "#8892b0",
  };

  // ─── Helpers ──────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }
  function stateColor(state) {
    switch (state) {
      case "active": return C.active;
      case "processing": return C.processing;
      case "queued": return C.queued;
      case "complete": return C.complete;
      default: return C.idle;
    }
  }
  function fmtEta(sec) {
    if (sec == null || sec <= 0) return "\u2014";
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + "m " + (s > 0 ? s + "s" : "");
  }

  // ─── Cheap state hash (replaces JSON.stringify) ──────────────
  function stateHash(data) {
    if (!data) return "";
    var parts = [];
    var agents = data.agents || [];
    for (var i = 0; i < agents.length; i++) {
      parts.push(agents[i].id + ":" + agents[i].state);
    }
    var files = data.files || [];
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      parts.push(f.id + ":" + f.state + ":" + (f.progress || 0) + ":" + (f.segments_done || 0));
    }
    return parts.join("|");
  }

  // ─── Node ─────────────────────────────────────────────────────
  function makeNode(id, x, y, type, label, state, radius) {
    return {
      id: id, x: x, y: y, tx: x, ty: y,
      type: type, label: label, state: state,
      radius: radius || (type === "agent" ? 14 : 7),
      baseRadius: radius || (type === "agent" ? 14 : 7),
      phase: Math.random() * Math.PI * 2,
      glowIntensity: state === "active" ? 1 : 0.2,
      flashTime: 0,
    };
  }

  function updateNode(n, t, dt) {
    n.x = lerp(n.x, n.tx, 0.04);
    n.y = lerp(n.y, n.ty, 0.04);
    var isActive = n.state === "active" || n.state === "processing";
    var breathSpeed = isActive ? 3 : 1.2;
    var breathAmp = isActive ? 0.15 : 0.06;
    n.radius = n.baseRadius * (1 + Math.sin(t * breathSpeed + n.phase) * breathAmp);
    var targetGlow = isActive ? 1 : 0.2;
    n.glowIntensity = lerp(n.glowIntensity, targetGlow, dt * 3);
  }

  function drawNode(ctx, n, t) {
    var color = n.id === "orchestrator" ? "#ffffff" : stateColor(n.state);
    var isActive = n.state === "active" || n.state === "processing" || n.id === "orchestrator";

    // Glow — only for active/processing nodes
    if (n.glowIntensity > 0.3) {
      var glowR = n.radius * (3 + n.glowIntensity * 4);
      var glow = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, glowR);
      glow.addColorStop(0, hexToRgba(color, 0.3 * n.glowIntensity));
      glow.addColorStop(0.5, hexToRgba(color, 0.08 * n.glowIntensity));
      glow.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Main circle — shadow only for active
    ctx.fillStyle = color;
    if (isActive) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Highlight
    var hl = ctx.createRadialGradient(
      n.x - n.radius * 0.3, n.y - n.radius * 0.3, 0,
      n.x, n.y, n.radius
    );
    hl.addColorStop(0, "rgba(255,255,255,0.25)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fill();

    // Flash ring
    if (n.flashTime > 0) {
      var age = t - n.flashTime;
      if (age < 1) {
        var alpha = (1 - age) * 0.5;
        ctx.strokeStyle = hexToRgba(C.complete, alpha);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + age * 25, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle = hexToRgba(C.text, 0.6 + n.glowIntensity * 0.4);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.label, n.x, n.y + n.radius + 15);
  }

  // ─── Connection ───────────────────────────────────────────────
  function makeConnection(fromNode, toNode) {
    return { from: fromNode, to: toNode, activity: 0 };
  }

  function drawConnection(ctx, conn, simT) {
    var ax = conn.from.x, ay = conn.from.y;
    var bx = conn.to.x, by = conn.to.y;
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    var dx = bx - ax, dy = by - ay;
    var offset = Math.sin(simT * 0.5 + ax * 0.01) * 12;
    var cx2 = mx + dy * offset * 0.01;
    var cy2 = my - dx * offset * 0.01;

    ctx.strokeStyle = conn.activity > 0.01
      ? hexToRgba(C.active, 0.05 + conn.activity * 0.3)
      : "rgba(100,255,218,0.06)";
    ctx.lineWidth = 1 + conn.activity * 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx2, cy2, bx, by);
    ctx.stroke();
  }

  // ─── Pulse ────────────────────────────────────────────────────
  function makePulse(conn) {
    return { conn: conn, t: 0, speed: 0.35 + Math.random() * 0.3, alive: true, size: 2.5 + Math.random() * 1.5, trail: [] };
  }

  function updatePulse(p, dt, simT) {
    p.t += p.speed * dt;
    if (p.t >= 1) {
      p.alive = false;
      p.conn.to.flashTime = simT;
    }
    var pos = bezierPoint(p.conn.from.x, p.conn.from.y, p.conn.to.x, p.conn.to.y, p.t, simT);
    p.trail.push({ x: pos.x, y: pos.y, age: 0 });
    if (p.trail.length > 10) p.trail.shift();
    for (var i = 0; i < p.trail.length; i++) p.trail[i].age += dt * 4;
  }

  function bezierPoint(ax, ay, bx, by, t, simT) {
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    var dx = bx - ax, dy = by - ay;
    var offset = Math.sin(simT * 0.5 + ax * 0.01) * 12;
    var cx2 = mx + dy * offset * 0.01;
    var cy2 = my - dx * offset * 0.01;
    var u = 1 - t;
    return {
      x: u * u * ax + 2 * u * t * cx2 + t * t * bx,
      y: u * u * ay + 2 * u * t * cy2 + t * t * by,
    };
  }

  function drawPulse(ctx, p, simT) {
    for (var i = 0; i < p.trail.length; i++) {
      var pt = p.trail[i];
      var alpha = Math.max(0, 1 - pt.age) * 0.5;
      var sz = p.size * (1 - pt.age * 0.5);
      if (alpha <= 0 || sz <= 0) continue;
      ctx.fillStyle = hexToRgba(C.pulse, alpha);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    var pos = bezierPoint(p.conn.from.x, p.conn.from.y, p.conn.to.x, p.conn.to.y, p.t, simT);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = C.pulse;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ─── Layout engine ────────────────────────────────────────────
  function layoutNodes(agents, files, W, H) {
    var cx = W / 2, cy = H / 2;
    var nodes = [];
    var nodeMap = {};

    var orch = makeNode("orchestrator", cx, cy, "agent", "Orchestrator", "active", 18);
    nodes.push(orch);
    nodeMap["orchestrator"] = orch;

    var agentR = Math.min(W, H) * 0.2;
    var agentOnly = agents.filter(function (a) { return a.id !== "orchestrator"; });
    agentOnly.forEach(function (a, i) {
      var angle = (i / agentOnly.length) * Math.PI * 2 - Math.PI / 2;
      var n = makeNode(a.id, cx + Math.cos(angle) * agentR, cy + Math.sin(angle) * agentR, "agent", a.label, a.state, 12);
      nodes.push(n);
      nodeMap[a.id] = n;
    });

    var fileR = Math.min(W, H) * 0.36;
    files.forEach(function (f, i) {
      var angle = (i / files.length) * Math.PI * 2 + Math.PI / 8;
      var spread = 20;
      var n = makeNode(f.id,
        cx + Math.cos(angle) * fileR + (Math.random() - 0.5) * spread,
        cy + Math.sin(angle) * fileR + (Math.random() - 0.5) * spread,
        "file", f.label, f.state, 6
      );
      nodes.push(n);
      nodeMap[f.id] = n;
    });

    var connections = [];
    agentOnly.forEach(function (a) {
      if (nodeMap[a.id]) connections.push(makeConnection(orch, nodeMap[a.id]));
    });
    files.forEach(function (f) {
      if (f.agent && nodeMap[f.agent] && nodeMap[f.id]) {
        connections.push(makeConnection(nodeMap[f.agent], nodeMap[f.id]));
      }
    });

    return { nodes: nodes, connections: connections, nodeMap: nodeMap };
  }

  // ─── Offscreen grid cache ─────────────────────────────────────
  function createGridCache(W, H) {
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    var ctx = c.getContext("2d");
    ctx.strokeStyle = "rgba(100,255,218,0.015)";
    ctx.lineWidth = 0.5;
    for (var gx = 0; gx < W; gx += 50) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy < H; gy += 50) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    return c;
  }

  // ─── Canvas Renderer (EVENT-DRIVEN — minimal GPU) ────────────
  function SynapseCanvas(props) {
    var canvasRef = useRef(null);
    var animRef = useRef(null);
    var stateRef = useRef(props.stateData);
    var simRef = useRef({ nodes: [], connections: [], pulses: [], simTime: 0, lastTime: 0, fps: 0, fpsFrames: 0, fpsTime: 0, initialized: false });
    var gridCacheRef = useRef(null);
    var runningRef = useRef(false);

    stateRef.current = props.stateData;

    useEffect(function () {
      var canvas = canvasRef.current;
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      var dpr = window.devicePixelRatio || 1;
      var W = props.width, H = props.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.scale(dpr, dpr);

      var sim = simRef.current;
      sim.simTime = performance.now() / 1000;
      sim.lastTime = performance.now() / 1000;

      // Cache the grid (never changes)
      gridCacheRef.current = createGridCache(W, H);

      // Initial layout
      var data = stateRef.current;
      var layout = layoutNodes(data.agents || [], data.files || [], W, H);
      sim.nodes = layout.nodes;
      sim.connections = layout.connections;
      sim.nodeMap = layout.nodeMap;
      sim.pulses = [];
      sim.initialized = true;

      // Activate initial pulses
      (data.pulses || []).forEach(function (p) {
        var fn = sim.nodeMap[p.from], tn = sim.nodeMap[p.to];
        if (fn && tn) {
          var c = sim.connections.find(function (x) { return x.from.id === p.from && x.to.id === p.to; });
          if (!c) { c = makeConnection(fn, tn); sim.connections.push(c); }
          c.activity = 1;
          sim.pulses.push(makePulse(c));
        }
      });

      var lastStateHash = stateHash(data);

      // ─── EVENT-DRIVEN RENDER ────────────────────────────────
      var FRAME_INTERVAL = 1000 / 60; // 60fps — only runs when pulses active
      var lastFrameTime = 0;
      var paused = false;

      function hasActivePulses() {
        return sim.pulses.length > 0;
      }

      // Full animation loop — only runs when pulses are active
      function animLoop(timestamp) {
        if (paused) { runningRef.current = false; return; }

        var elapsed = timestamp - lastFrameTime;
        if (elapsed < FRAME_INTERVAL) {
          animRef.current = requestAnimationFrame(animLoop);
          return;
        }
        lastFrameTime = timestamp - (elapsed % FRAME_INTERVAL);

        var now = performance.now() / 1000;
        var rawDt = Math.min(now - sim.lastTime, 0.1);
        sim.lastTime = now;
        sim.simTime += rawDt;

        sim.fpsFrames++;
        sim.fpsTime += rawDt;
        if (sim.fpsTime >= 0.5) { sim.fps = Math.round(sim.fpsFrames / sim.fpsTime); sim.fpsFrames = 0; sim.fpsTime = 0; }

        // Update simulation
        for (var ci = 0; ci < sim.connections.length; ci++) {
          if (sim.connections[ci].activity > 0) sim.connections[ci].activity = Math.max(0, sim.connections[ci].activity - rawDt * 0.5);
        }
        for (var pi = sim.pulses.length - 1; pi >= 0; pi--) {
          updatePulse(sim.pulses[pi], rawDt, sim.simTime);
          if (!sim.pulses[pi].alive) sim.pulses.splice(pi, 1);
        }
        if (sim.pulses.length > 0 && Math.random() < 0.02) {
          var ac = sim.connections.filter(function (c) { return c.activity > 0.3; });
          if (ac.length) sim.pulses.push(makePulse(ac[Math.floor(Math.random() * ac.length)]));
        }
        for (var ni = 0; ni < sim.nodes.length; ni++) updateNode(sim.nodes[ni], sim.simTime, rawDt);

        // Draw
        ctx.fillStyle = "rgba(10,14,26,0.25)";
        ctx.fillRect(0, 0, W, H);
        if (gridCacheRef.current) ctx.drawImage(gridCacheRef.current, 0, 0);
        for (var ci2 = 0; ci2 < sim.connections.length; ci2++) drawConnection(ctx, sim.connections[ci2], sim.simTime);
        for (var pi2 = 0; pi2 < sim.pulses.length; pi2++) drawPulse(ctx, sim.pulses[pi2], sim.simTime);
        for (var ni2 = 0; ni2 < sim.nodes.length; ni2++) drawNode(ctx, sim.nodes[ni2], sim.simTime);

        ctx.fillStyle = "rgba(100,255,218,0.5)";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText(sim.fps + " FPS", W - 8, 16);

        if (hasActivePulses()) {
          animRef.current = requestAnimationFrame(animLoop);
        } else {
          runningRef.current = false;
        }
      }

      function startLoop() {
        if (runningRef.current || paused) return;
        runningRef.current = true;
        lastFrameTime = performance.now();
        sim.lastTime = performance.now() / 1000;
        animRef.current = requestAnimationFrame(animLoop);
      }

      // Single frame render — no animation loop
      function renderOnce() {
        var now = performance.now() / 1000;
        var rawDt = Math.min(now - sim.lastTime, 0.1);
        sim.lastTime = now;
        sim.simTime += rawDt;

        for (var ci = 0; ci < sim.connections.length; ci++) {
          if (sim.connections[ci].activity > 0) sim.connections[ci].activity = Math.max(0, sim.connections[ci].activity - rawDt * 0.5);
        }
        for (var ni = 0; ni < sim.nodes.length; ni++) updateNode(sim.nodes[ni], sim.simTime, rawDt);

        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);
        if (gridCacheRef.current) ctx.drawImage(gridCacheRef.current, 0, 0);
        for (var ci2 = 0; ci2 < sim.connections.length; ci2++) drawConnection(ctx, sim.connections[ci2], sim.simTime);
        for (var ni2 = 0; ni2 < sim.nodes.length; ni2++) drawNode(ctx, sim.nodes[ni2], sim.simTime);

        ctx.fillStyle = "rgba(100,255,218,0.5)";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText("IDLE", W - 8, 16);
      }

      function onVisibility() {
        paused = document.hidden;
        if (!paused) {
          if (hasActivePulses()) startLoop();
          else renderOnce();
        }
      }
      document.addEventListener("visibilitychange", onVisibility);

      // State update handler — called externally when data changes
      function onStateUpdate() {
        var newData = stateRef.current;
        var newHash = stateHash(newData);
        if (newHash === lastStateHash) return;
        lastStateHash = newHash;

        (newData.agents || []).forEach(function (a) {
          var node = sim.nodeMap[a.id];
          if (node) node.state = a.state;
        });
        (newData.files || []).forEach(function (f) {
          var node = sim.nodeMap[f.id];
          if (node) node.state = f.state;
        });

        // Check for new nodes needing layout
        var needsRelayout = false;
        (newData.agents || []).forEach(function (a) { if (!sim.nodeMap[a.id]) needsRelayout = true; });
        (newData.files || []).forEach(function (f) { if (!sim.nodeMap[f.id]) needsRelayout = true; });
        if (needsRelayout) {
          var newLayout = layoutNodes(newData.agents || [], newData.files || [], W, H);
          sim.nodes = newLayout.nodes;
          sim.connections = newLayout.connections;
          sim.nodeMap = newLayout.nodeMap;
        }

        var hasNewPulses = false;
        (newData.pulses || []).forEach(function (p) {
          var fn = sim.nodeMap[p.from], tn = sim.nodeMap[p.to];
          if (fn && tn) {
            var c = sim.connections.find(function (x) { return x.from.id === p.from && x.to.id === p.to; });
            if (c && c.activity < 0.5) { c.activity = 1; sim.pulses.push(makePulse(c)); hasNewPulses = true; }
          }
        });

        if (hasNewPulses || hasActivePulses()) startLoop();
        else renderOnce();
      }

      sim._onStateUpdate = onStateUpdate;

      // Initial render
      renderOnce();
      if (hasActivePulses()) startLoop();

      return function () {
        document.removeEventListener("visibilitychange", onVisibility);
        runningRef.current = false;
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }, [props.width, props.height]);

    return h("canvas", { ref: canvasRef, style: { display: "block", width: props.width + "px", height: props.height + "px" } });
  }

  // ─── File List Component ──────────────────────────────────────
  function FileListPanel(props) {
    var files = props.files || [];
    if (!files.length) return null;

    var stateOrder = { processing: 0, queued: 1, complete: 2 };
    var sorted = files.slice().sort(function (a, b) {
      var sa = stateOrder[a.state] !== undefined ? stateOrder[a.state] : 1;
      var sb = stateOrder[b.state] !== undefined ? stateOrder[b.state] : 1;
      return sa - sb;
    });

    return h("div", { className: "synapse-filelist" },
      h("div", { className: "synapse-filelist-title" }, "Files"),
      sorted.map(function (f) {
        var pct = Math.round((f.progress || 0) * 100);
        var isComplete = f.state === "complete";
        return h("div", {
          key: f.id,
          className: "synapse-file" + (f.state ? " " + f.state : "") + (isComplete ? " faded" : ""),
          style: isComplete ? { opacity: 0.5 } : {},
        },
          h("div", { className: "synapse-file-header" },
            h("span", { className: "synapse-file-name", title: f.label }, f.label),
            h("span", { className: "synapse-file-status" + (f.state ? " " + f.state : "") },
              f.state === "processing" ? "ACTIVE" : f.state === "complete" ? "DONE" : "WAIT"),
          ),
          h("div", { className: "synapse-progress-track" },
            h("div", { className: "synapse-progress-fill" + (f.state ? " " + f.state : ""), style: { width: pct + "%" } }),
          ),
          h("div", { className: "synapse-file-footer" },
            h("span", { className: "synapse-eta" },
              f.state === "processing" ? (f.segments_done || 0) + "/" + (f.segments_total || 0) + " seg" + (f.eta_seconds ? " | " + fmtEta(f.eta_seconds) : "") :
              f.state === "complete" ? "Complete" : "Queued"),
            h("span", { className: "synapse-progress-pct" }, pct + "%"),
          ),
        );
      }),
    );
  }

  // ─── Main Plugin Component ────────────────────────────────────
  function SynapseMonitor() {
    var _s1 = useState(null);
    var stateData = _s1[0]; var setStateData = _s1[1];
    var _s2 = useState(false);
    var minimized = _s2[0]; var setMinimized = _s2[1];
    var _s3 = useState(false);
    var closed = _s3[0]; var setClosed = _s3[1];
    var _s4 = useState("demo");
    var mode = _s4[0]; var setMode = _s4[1];
    var _s5 = useState({ w: 660, h: 450 });
    var dims = _s5[0]; var setDims = _s5[1];
    var containerRef = useRef(null);
    var simRef = useRef(null);

    var fetchState = useCallback(function () {
      var url = mode === "demo" ? "/api/plugins/synapse/demo" : "/api/plugins/synapse/status";
      SDK.fetchJSON(url)
        .then(function (data) {
          setStateData(data);
          // Trigger canvas update via sim ref
          if (simRef.current && simRef.current._onStateUpdate) {
            simRef.current._onStateUpdate();
          }
        })
        .catch(function (e) { console.error("Synapse fetch error:", e); });
    }, [mode]);

    useEffect(function () {
      if (closed) return;
      fetchState();
      var interval = setInterval(fetchState, mode === "demo" ? 3000 : 5000);
      return function () { clearInterval(interval); }
    }, [fetchState, closed]);

    useEffect(function () {
      if (closed || !containerRef.current) return;
      var ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var rect = entries[i].contentRect;
          if (rect.width > 100 && rect.height > 100) setDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
        }
      });
      ro.observe(containerRef.current);
      return function () { ro.disconnect(); };
    }, [closed]);

    var handleReopen = useCallback(function () { setClosed(false); }, []);

    if (closed) {
      return h("div", { className: "synapse-closed-badge", onClick: handleReopen },
        h("span", { className: "synapse-closed-icon" }, "\u2B21"),
        h("span", null, "Synapse"),
      );
    }

    var stats = (stateData && stateData.stats) || {};
    var statsBar = h("div", { className: "synapse-stats" },
      h("div", { className: "synapse-stat" }, h("span", { className: "synapse-stat-label" }, "Agents"), h("span", { className: "synapse-stat-val" }, stats.active_agents || 0)),
      h("div", { className: "synapse-stat" }, h("span", { className: "synapse-stat-label" }, "Processing"), h("span", { className: "synapse-stat-val synapse-stat-processing" }, stats.files_processing || 0)),
      h("div", { className: "synapse-stat" }, h("span", { className: "synapse-stat-label" }, "Queued"), h("span", { className: "synapse-stat-val synapse-stat-queued" }, stats.files_queued || 0)),
      h("div", { className: "synapse-stat" }, h("span", { className: "synapse-stat-label" }, "Complete"), h("span", { className: "synapse-stat-val synapse-stat-complete" }, stats.files_complete || 0)),
    );

    var toolbar = h("div", { className: "synapse-toolbar" },
      h("div", { className: "synapse-toolbar-left" },
        h("span", { className: "synapse-title" }, "\u2B21 Synapse Monitor"),
        h("button", { className: "synapse-mode-btn" + (mode === "demo" ? " active" : ""), onClick: function () { setMode("demo"); } }, "Demo"),
        h("button", { className: "synapse-mode-btn" + (mode === "live" ? " active" : ""), onClick: function () { setMode("live"); } }, "Live"),
      ),
      h("div", { className: "synapse-toolbar-right" },
        h("button", { className: "synapse-btn", onClick: function () { setMinimized(!minimized); }, title: minimized ? "Expand" : "Minimize" }, minimized ? "\u25A1" : "\u2013"),
        h("button", { className: "synapse-btn synapse-btn-close", onClick: function () { setClosed(true); }, title: "Close" }, "\u2715"),
      ),
    );

    var canvasArea = minimized ? null
      : h("div", { ref: containerRef, className: "synapse-canvas-wrap" },
          stateData ? h(SynapseCanvas, { stateData: stateData, width: dims.w, height: dims.h })
                    : h("div", { className: "synapse-loading" }, "Loading..."));

    var fileList = minimized ? null
      : h(FileListPanel, { files: (stateData && stateData.files) || [] });

    return h("div", { className: "synapse-plugin" },
      toolbar, statsBar,
      h("div", { className: "synapse-body" }, fileList, canvasArea),
    );
  }

  // ─── Register ─────────────────────────────────────────────────
  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("synapse", SynapseMonitor);
  }
})();
