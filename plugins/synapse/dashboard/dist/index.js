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
    var breathSpeed = n.state === "active" ? 3 : 1.2;
    var breathAmp = n.state === "active" ? 0.15 : 0.06;
    n.radius = n.baseRadius * (1 + Math.sin(t * breathSpeed + n.phase) * breathAmp);
    var targetGlow = (n.state === "active" || n.state === "processing") ? 1 : 0.2;
    n.glowIntensity = lerp(n.glowIntensity, targetGlow, dt * 3);
  }

  function drawNode(ctx, n, t) {
    var color = stateColor(n.state);
    var glowR = n.radius * (3 + n.glowIntensity * 4);
    var glow = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, glowR);
    glow.addColorStop(0, hexToRgba(color, 0.3 * n.glowIntensity));
    glow.addColorStop(0.5, hexToRgba(color, 0.08 * n.glowIntensity));
    glow.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * n.glowIntensity;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

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

    ctx.fillStyle = hexToRgba(C.text, 0.6 + n.glowIntensity * 0.4);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.label, n.x, n.y + n.radius + 15);
  }

  // ─── Connection ───────────────────────────────────────────────
  function makeConnection(fromNode, toNode) {
    return { from: fromNode, to: toNode, activity: 0 };
  }

  function bezierPoint(ax, ay, bx, by, t, simT) {
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    var dx = bx - ax, dy = by - ay;
    var offset = Math.sin(simT * 0.5 + ax * 0.01) * 12;
    var cx = mx + dy * offset * 0.01;
    var cy = my - dx * offset * 0.01;
    var u = 1 - t;
    return {
      x: u * u * ax + 2 * u * t * cx + t * t * bx,
      y: u * u * ay + 2 * u * t * cy + t * t * by,
    };
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
      if (nodeMap[a.id]) {
        connections.push(makeConnection(orch, nodeMap[a.id]));
      }
    });
    files.forEach(function (f) {
      if (f.agent && nodeMap[f.agent] && nodeMap[f.id]) {
        connections.push(makeConnection(nodeMap[f.agent], nodeMap[f.id]));
      }
    });

    return { nodes: nodes, connections: connections, nodeMap: nodeMap };
  }

  // ─── Canvas Renderer ──────────────────────────────────────────
  function SynapseCanvas(props) {
    var stateData = props.stateData;
    var width = props.width;
    var height = props.height;
    var canvasRef = useRef(null);
    var animRef = useRef(null);
    var simRef = useRef({ nodes: [], connections: [], pulses: [], simTime: 0, lastTime: 0, fps: 0, fpsFrames: 0, fpsTime: 0 });

    useEffect(function () {
      var canvas = canvasRef.current;
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      var dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.scale(dpr, dpr);

      var sim = simRef.current;
      sim.simTime = performance.now() / 1000;
      sim.lastTime = performance.now() / 1000;

      var layout = layoutNodes(stateData.agents || [], stateData.files || [], width, height);
      sim.nodes = layout.nodes;
      sim.connections = layout.connections;
      sim.nodeMap = layout.nodeMap;
      sim.pulses = [];

      (stateData.pulses || []).forEach(function (p) {
        var fromNode = layout.nodeMap[p.from];
        var toNode = layout.nodeMap[p.to];
        if (fromNode && toNode) {
          var conn = sim.connections.find(function (c) {
            return c.from.id === p.from && c.to.id === p.to;
          });
          if (!conn) {
            conn = makeConnection(fromNode, toNode);
            sim.connections.push(conn);
          }
          conn.activity = 1;
          sim.pulses.push(makePulse(conn));
        }
      });

      function frame() {
        var now = performance.now() / 1000;
        var rawDt = Math.min(now - sim.lastTime, 0.1);
        var dt = rawDt;
        sim.lastTime = now;
        sim.simTime += dt;

        sim.fpsFrames++;
        sim.fpsTime += rawDt;
        if (sim.fpsTime >= 0.5) {
          sim.fps = Math.round(sim.fpsFrames / sim.fpsTime);
          sim.fpsFrames = 0;
          sim.fpsTime = 0;
        }

        for (var ci = 0; ci < sim.connections.length; ci++) {
          var c = sim.connections[ci];
          if (c.activity > 0) c.activity = Math.max(0, c.activity - dt * 0.5);
        }

        for (var pi = sim.pulses.length - 1; pi >= 0; pi--) {
          updatePulse(sim.pulses[pi], dt, sim.simTime);
          if (!sim.pulses[pi].alive) sim.pulses.splice(pi, 1);
        }

        if (Math.random() < 0.02) {
          var activeConns = sim.connections.filter(function (c) { return c.activity > 0.3; });
          if (activeConns.length) {
            sim.pulses.push(makePulse(activeConns[Math.floor(Math.random() * activeConns.length)]));
          }
        }

        for (var ni = 0; ni < sim.nodes.length; ni++) {
          updateNode(sim.nodes[ni], sim.simTime, dt);
        }

        ctx.fillStyle = "rgba(10,14,26,0.25)";
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = "rgba(100,255,218,0.015)";
        ctx.lineWidth = 0.5;
        for (var gx = 0; gx < width; gx += 50) {
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke();
        }
        for (var gy = 0; gy < height; gy += 50) {
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
        }

        for (var ci2 = 0; ci2 < sim.connections.length; ci2++) {
          drawConnection(ctx, sim.connections[ci2], sim.simTime);
        }
        for (var pi2 = 0; pi2 < sim.pulses.length; pi2++) {
          drawPulse(ctx, sim.pulses[pi2], sim.simTime);
        }
        for (var ni2 = 0; ni2 < sim.nodes.length; ni2++) {
          drawNode(ctx, sim.nodes[ni2], sim.simTime);
        }

        ctx.fillStyle = "rgba(100,255,218,0.5)";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText(sim.fps + " FPS", width - 8, 16);

        animRef.current = requestAnimationFrame(frame);
      }

      animRef.current = requestAnimationFrame(frame);
      return function () { if (animRef.current) cancelAnimationFrame(animRef.current); };
    }, [stateData, width, height]);

    return h("canvas", {
      ref: canvasRef,
      style: { display: "block", width: width + "px", height: height + "px" },
    });
  }

  // ─── File List Component ──────────────────────────────────────
  function FileListPanel(props) {
    var files = props.files || [];
    if (!files.length) return null;

    return h("div", { className: "synapse-filelist" },
      h("div", { className: "synapse-filelist-title" }, "Files"),
      files.map(function (f) {
        var pct = Math.round((f.progress || 0) * 100);
        var cls = "synapse-file" + (f.state ? " " + f.state : "");
        return h("div", { key: f.id, className: cls },
          h("div", { className: "synapse-file-header" },
            h("span", { className: "synapse-file-name", title: f.label }, f.label),
            h("span", { className: "synapse-file-status" + (f.state ? " " + f.state : "") },
              f.state === "processing" ? "ACTIVE" : f.state === "complete" ? "DONE" : "WAIT"
            ),
          ),
          h("div", { className: "synapse-progress-track" },
            h("div", {
              className: "synapse-progress-fill" + (f.state ? " " + f.state : ""),
              style: { width: pct + "%" },
            }),
          ),
          h("div", { className: "synapse-file-footer" },
            h("span", { className: "synapse-eta" },
              f.state === "processing" ? "ETA " + fmtEta(f.eta_seconds) :
              f.state === "complete" ? "Complete" :
              f.state === "queued" ? "Queued" : "\u2014"
            ),
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
    var _s5 = useState(0);
    var refreshCounter = _s5[0]; var setRefreshCounter = _s5[1];
    var _s6 = useState(false);
    var poppedOut = _s6[0]; var setPoppedOut = _s6[1];
    var _s7 = useState({ w: 660, h: 450 });
    var dims = _s7[0]; var setDims = _s7[1];
    var containerRef = useRef(null);
    var dragRef = useRef({ dragging: false, startX: 0, startY: 0 });

    // Fetch state
    var fetchState = useCallback(function () {
      var url = mode === "demo"
        ? "/api/plugins/synapse/demo"
        : "/api/plugins/synapse/status";
      SDK.fetchJSON(url)
        .then(function (data) { setStateData(data); })
        .catch(function (e) { console.error("Synapse fetch error:", e); });
    }, [mode]);

    useEffect(function () {
      if (closed) return;
      fetchState();
      var interval = setInterval(fetchState, 3000);
      return function () { clearInterval(interval); };
    }, [fetchState, closed]);

    // Track container size
    useEffect(function () {
      if (closed || !containerRef.current) return;
      var ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var rect = entries[i].contentRect;
          if (rect.width > 100 && rect.height > 100) {
            setDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
          }
        }
      });
      ro.observe(containerRef.current);
      return function () { ro.disconnect(); };
    }, [closed, poppedOut]);

    // Drag handlers (for pop-out mode)
    var onDragStart = useCallback(function (e) {
      if (!poppedOut) return;
      dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY };
      var onMove = function (ev) {
        if (!dragRef.current.dragging) return;
        var el = containerRef.current;
        if (!el) return;
        var dx = ev.clientX - dragRef.current.startX;
        var dy = ev.clientY - dragRef.current.startY;
        dragRef.current.startX = ev.clientX;
        dragRef.current.startY = ev.clientY;
        el.style.left = (el.offsetLeft + dx) + "px";
        el.style.top = (el.offsetTop + dy) + "px";
        el.style.right = "auto";
      };
      var onUp = function () {
        dragRef.current.dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, [poppedOut]);

    var handleReopen = useCallback(function () {
      setClosed(false);
      setRefreshCounter(function (c) { return c + 1; });
    }, []);

    // ── Closed state ──
    if (closed) {
      return h("div", { className: "synapse-closed-badge", onClick: handleReopen },
        h("span", { className: "synapse-closed-icon" }, "\u2B21"),
        h("span", null, "Synapse"),
      );
    }

    // ── Stats ──
    var stats = (stateData && stateData.stats) || {};
    var statsBar = h("div", { className: "synapse-stats" },
      h("div", { className: "synapse-stat" },
        h("span", { className: "synapse-stat-label" }, "Agents"),
        h("span", { className: "synapse-stat-val" }, stats.active_agents || 0),
      ),
      h("div", { className: "synapse-stat" },
        h("span", { className: "synapse-stat-label" }, "Processing"),
        h("span", { className: "synapse-stat-val synapse-stat-processing" }, stats.files_processing || 0),
      ),
      h("div", { className: "synapse-stat" },
        h("span", { className: "synapse-stat-label" }, "Queued"),
        h("span", { className: "synapse-stat-val synapse-stat-queued" }, stats.files_queued || 0),
      ),
      h("div", { className: "synapse-stat" },
        h("span", { className: "synapse-stat-label" }, "Complete"),
        h("span", { className: "synapse-stat-val synapse-stat-complete" }, stats.files_complete || 0),
      ),
    );

    // ── Toolbar ──
    var toolbar = h("div", {
      className: "synapse-toolbar",
      onMouseDown: poppedOut ? onDragStart : undefined,
    },
      h("div", { className: "synapse-toolbar-left" },
        h("span", { className: "synapse-title" }, "\u2B21 Synapse Monitor"),
        h("button", {
          className: "synapse-mode-btn" + (mode === "demo" ? " active" : ""),
          onClick: function () { setMode("demo"); },
        }, "Demo"),
        h("button", {
          className: "synapse-mode-btn" + (mode === "live" ? " active" : ""),
          onClick: function () { setMode("live"); },
        }, "Live"),
      ),
      h("div", { className: "synapse-toolbar-right" },
        h("button", {
          className: "synapse-btn synapse-btn-popout",
          onClick: function () { setPoppedOut(!poppedOut); },
          title: poppedOut ? "Dock back" : "Pop out (float on top)",
        }, poppedOut ? "\u21A4" : "\u2B1A"),
        h("button", {
          className: "synapse-btn",
          onClick: function () { setMinimized(!minimized); },
          title: minimized ? "Expand" : "Minimize",
        }, minimized ? "\u25A1" : "\u2013"),
        h("button", {
          className: "synapse-btn synapse-btn-close",
          onClick: function () { setClosed(true); },
          title: "Close",
        }, "\u2715"),
      ),
    );

    // ── Canvas ──
    var canvasArea = minimized
      ? null
      : h("div", { ref: containerRef, className: "synapse-canvas-wrap" },
          stateData
            ? h(SynapseCanvas, { stateData: stateData, width: dims.w, height: dims.h })
            : h("div", { className: "synapse-loading" }, "Loading..."),
        );

    // ── File list ──
    var fileList = minimized
      ? null
      : h(FileListPanel, { files: (stateData && stateData.files) || [] });

    var pluginCls = "synapse-plugin" + (poppedOut ? " popped-out" : "");

    return h("div", { className: pluginCls },
      toolbar,
      statsBar,
      h("div", { className: "synapse-body" },
        fileList,
        canvasArea,
      ),
    );
  }

  // ─── Register ─────────────────────────────────────────────────
  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("synapse", SynapseMonitor);
  }
})();
