(function () {
  "use strict";
  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;
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

    // Outer glow
    var glowR = n.radius * (3 + n.glowIntensity * 4);
    var glow = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, glowR);
    glow.addColorStop(0, hexToRgba(color, 0.3 * n.glowIntensity));
    glow.addColorStop(0.5, hexToRgba(color, 0.08 * n.glowIntensity));
    glow.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * n.glowIntensity;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner highlight
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

    // Flash ring on pulse arrival
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
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.label, n.x, n.y + n.radius + 13);
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
    var cx = mx + dy * offset * 0.01;
    var cy = my - dx * offset * 0.01;

    ctx.strokeStyle = conn.activity > 0.01
      ? hexToRgba(C.active, 0.05 + conn.activity * 0.3)
      : "rgba(100,255,218,0.06)";
    ctx.lineWidth = 1 + conn.activity * 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
  }

  // ─── Pulse (particle) ────────────────────────────────────────
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

    // Orchestrator at center
    var orch = makeNode("orchestrator", cx, cy, "agent", "Orchestrator", "active", 18);
    nodes.push(orch);
    nodeMap["orchestrator"] = orch;

    // Agents in inner ring
    var agentR = Math.min(W, H) * 0.2;
    var agentOnly = agents.filter(function (a) { return a.id !== "orchestrator"; });
    agentOnly.forEach(function (a, i) {
      var angle = (i / agentOnly.length) * Math.PI * 2 - Math.PI / 2;
      var n = makeNode(a.id, cx + Math.cos(angle) * agentR, cy + Math.sin(angle) * agentR, "agent", a.label, a.state, 12);
      nodes.push(n);
      nodeMap[a.id] = n;
    });

    // Files in outer ring
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

    // Connections: orchestrator → agents
    var connections = [];
    agentOnly.forEach(function (a) {
      if (nodeMap[a.id]) {
        connections.push(makeConnection(orch, nodeMap[a.id]));
      }
    });

    // Connections: agents → assigned files
    files.forEach(function (f) {
      if (f.agent && nodeMap[f.agent] && nodeMap[f.id]) {
        connections.push(makeConnection(nodeMap[f.agent], nodeMap[f.id]));
      }
    });

    // Set activity on connections with pulses
    connections.forEach(function (c) {
      // Will be activated when pulses arrive
    });

    return { nodes: nodes, connections: connections, nodeMap: nodeMap };
  }

  // ─── Canvas Renderer ──────────────────────────────────────────
  function SynapseCanvas(stateData, width, height) {
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

      // Layout from state data
      var layout = layoutNodes(stateData.agents || [], stateData.files || [], width, height);
      sim.nodes = layout.nodes;
      sim.connections = layout.connections;
      sim.nodeMap = layout.nodeMap;
      sim.pulses = [];

      // Activate connections that have pulses
      (stateData.pulses || []).forEach(function (p) {
        var fromNode = layout.nodeMap[p.from];
        var toNode = layout.nodeMap[p.to];
        if (fromNode && toNode) {
          // Find or create connection
          var conn = sim.connections.find(function (c) {
            return c.from.id === p.from && c.to.id === p.to;
          });
          if (!conn) {
            conn = makeConnection(fromNode, toNode);
            sim.connections.push(conn);
          }
          conn.activity = 1;
          // Spawn a pulse
          sim.pulses.push(makePulse(conn));
        }
      });

      function frame() {
        var now = performance.now() / 1000;
        var rawDt = Math.min(now - sim.lastTime, 0.1);
        var dt = rawDt;
        sim.lastTime = now;
        sim.simTime += dt;

        // FPS
        sim.fpsFrames++;
        sim.fpsTime += rawDt;
        if (sim.fpsTime >= 0.5) {
          sim.fps = Math.round(sim.fpsFrames / sim.fpsTime);
          sim.fpsFrames = 0;
          sim.fpsTime = 0;
        }

        // Fade connections
        for (var ci = 0; ci < sim.connections.length; ci++) {
          var c = sim.connections[ci];
          if (c.activity > 0) c.activity = Math.max(0, c.activity - dt * 0.5);
        }

        // Update pulses
        for (var pi = sim.pulses.length - 1; pi >= 0; pi--) {
          updatePulse(sim.pulses[pi], dt, sim.simTime);
          if (!sim.pulses[pi].alive) sim.pulses.splice(pi, 1);
        }

        // Auto-spawn pulses on active connections
        if (Math.random() < 0.02) {
          var activeConns = sim.connections.filter(function (c) { return c.activity > 0.3; });
          if (activeConns.length) {
            sim.pulses.push(makePulse(activeConns[Math.floor(Math.random() * activeConns.length)]));
          }
        }

        // Update nodes
        for (var ni = 0; ni < sim.nodes.length; ni++) {
          updateNode(sim.nodes[ni], sim.simTime, dt);
        }

        // ── Draw ──
        ctx.fillStyle = "rgba(10,14,26,0.25)";
        ctx.fillRect(0, 0, width, height);

        // Grid
        ctx.strokeStyle = "rgba(100,255,218,0.015)";
        ctx.lineWidth = 0.5;
        for (var gx = 0; gx < width; gx += 50) {
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke();
        }
        for (var gy = 0; gy < height; gy += 50) {
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
        }

        // Connections
        for (var ci2 = 0; ci2 < sim.connections.length; ci2++) {
          drawConnection(ctx, sim.connections[ci2], sim.simTime);
        }

        // Pulses
        for (var pi2 = 0; pi2 < sim.pulses.length; pi2++) {
          drawPulse(ctx, sim.pulses[pi2], sim.simTime);
        }

        // Nodes
        for (var ni2 = 0; ni2 < sim.nodes.length; ni2++) {
          drawNode(ctx, sim.nodes[ni2], sim.simTime);
        }

        // FPS badge
        ctx.fillStyle = "rgba(100,255,218,0.5)";
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText(sim.fps + " FPS", width - 8, 14);

        animRef.current = requestAnimationFrame(frame);
      }

      animRef.current = requestAnimationFrame(frame);

      return function () {
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }, [stateData, width, height]);

    return h("canvas", {
      ref: canvasRef,
      style: { display: "block", width: width + "px", height: height + "px" },
    });
  }

  // ─── Main Plugin Component ────────────────────────────────────
  function SynapseMonitor() {
    var _s1 = useState(null);    // stateData
    var stateData = _s1[0]; var setStateData = _s1[1];
    var _s2 = useState(false);   // minimized
    var minimized = _s2[0]; var setMinimized = _s2[1];
    var _s3 = useState(false);   // closed
    var closed = _s3[0]; var setClosed = _s3[1];
    var _s4 = useState("demo");  // mode: demo | live
    var mode = _s4[0]; var setMode = _s4[1];
    var _s5 = useState(0);       // refresh counter
    var refreshCounter = _s5[0]; var setRefreshCounter = _s5[1];
    var containerRef = useRef(null);
    var _s6 = useState({ w: 800, h: 500 });
    var dims = _s6[0]; var setDims = _s6[1];

    // Fetch state from API
    var fetchState = useCallback(function () {
      var url = mode === "demo"
        ? "/api/plugins/synapse/demo"
        : "/api/plugins/synapse/status";
      SDK.fetchJSON(url)
        .then(function (data) { setStateData(data); })
        .catch(function (e) { console.error("Synapse fetch error:", e); });
    }, [mode]);

    // Poll for updates
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
          setDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
        }
      });
      ro.observe(containerRef.current);
      return function () { ro.disconnect(); };
    }, [closed]);

    // Reopen handler
    var handleReopen = useCallback(function () {
      setClosed(false);
      setRefreshCounter(function (c) { return c + 1; });
    }, []);

    // ── Closed state: floating reopen button ──
    if (closed) {
      return h("div", { className: "synapse-closed-badge", onClick: handleReopen },
        h("span", { className: "synapse-closed-icon" }, "\u2B21"),
        h("span", null, "Synapse"),
      );
    }

    // ── Stats bar ──
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
    var toolbar = h("div", { className: "synapse-toolbar" },
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
          className: "synapse-btn",
          onClick: function () { setMinimized(!minimized); },
          title: minimized ? "Expand" : "Minimize",
        }, minimized ? "\u25A1" : "\u2013"),
        h("button", {
          className: "synapse-btn synapse-btn-close",
          onClick: function () { setClosed(true); },
          title: "Close (reopen from sidebar)",
        }, "\u2715"),
      ),
    );

    // ── Canvas (hidden when minimized) ──
    var canvasArea = minimized
      ? null
      : h("div", { ref: containerRef, className: "synapse-canvas-wrap" },
          stateData
            ? SynapseCanvas(stateData, dims.w || 800, dims.h || 450)
            : h("div", { className: "synapse-loading" }, "Loading..."),
        );

    return h("div", { className: "synapse-plugin" },
      toolbar,
      statsBar,
      canvasArea,
    );
  }

  // ─── Register ─────────────────────────────────────────────────
  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("synapse", SynapseMonitor);
  }
})();
