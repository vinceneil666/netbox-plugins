{% verbatim %}
(function () {
  "use strict";

  // ---------------------------------------------------------------- data
  const DATA = JSON.parse(document.getElementById("rt-data").textContent);
  const wrap = document.getElementById("rt-wrap");
  const canvas = document.getElementById("rt-canvas");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("rt-hud");
  const startOverlay = document.getElementById("rt-start");
  const modal = document.getElementById("rt-modal");
  const frame = document.getElementById("rt-frame");

  // ---------------------------------------------------------------- city layout
  const LOT_W = 230, LOT_H = 200;      // one building + its parking spot + a lane below
  const COLS = 4;                       // lots per row inside a district
  const PAD = 40, HEADER = 70;          // district padding and the name sign at its top
  const ROAD = 150;                     // road width between districts

  function hashHue(text) {
    let h = 0;
    for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }

  // Districts: one per tenant (its devices), one for devices without a tenant, one for the sites
  const districts = [];
  const byTenant = new Map(DATA.tenants.map(t => [t.id, []]));
  const noTenant = [];
  for (const d of DATA.devices) (byTenant.get(d.tenant) || noTenant).push(d);
  if (DATA.sites.length) {
    districts.push({
      title: "Sites", subtitle: `${DATA.sites.length} site${DATA.sites.length === 1 ? "" : "s"}`, hue: 205,
      hall: null,
      items: DATA.sites.map(s => ({
        kind: "site", key: `site-${s.id}`, name: s.name, url: s.url, color: "607d8b",
        lines: [s.status_label, s.region].filter(Boolean), status: s.status,
      })),
    });
  }
  for (const t of DATA.tenants) {
    const devs = byTenant.get(t.id);
    districts.push({
      title: t.name, subtitle: `${devs.length} device${devs.length === 1 ? "" : "s"}${t.group ? " · " + t.group : ""}`,
      hue: hashHue(t.name),
      hall: { kind: "tenant", key: `tenant-${t.id}`, name: t.name, url: t.url, lines: ["Tenant town hall"] },
      items: devs.map(deviceItem),
    });
  }
  if (noTenant.length) {
    districts.push({
      title: "No tenant", subtitle: `${noTenant.length} device${noTenant.length === 1 ? "" : "s"}`, hue: 30,
      hall: null, items: noTenant.map(deviceItem),
    });
  }

  function deviceItem(d) {
    return {
      kind: "device", key: `device-${d.id}`, name: d.name, url: d.url, color: d.color || "9e9e9e",
      lines: [d.type, [d.role, d.site].filter(Boolean).join(" · "), d.ip].filter(Boolean),
      status: d.status, statusLabel: d.status_label,
    };
  }

  // Size each district, then place them on a grid of equal cells with roads in between
  for (const dist of districts) {
    const slots = dist.items.length + (dist.hall ? 2 : 0);
    dist.rows = Math.max(1, Math.ceil(slots / COLS));
    dist.w = COLS * LOT_W + 2 * PAD;
    dist.h = HEADER + dist.rows * LOT_H + PAD;
  }
  const cellW = Math.max(...districts.map(d => d.w), COLS * LOT_W + 2 * PAD);
  const cellH = Math.max(...districts.map(d => d.h), HEADER + LOT_H + PAD);
  const gridCols = Math.max(1, Math.ceil(Math.sqrt(districts.length)));
  const gridRows = Math.max(1, Math.ceil(districts.length / gridCols));
  const WORLD = {
    w: gridCols * cellW + (gridCols + 1) * ROAD,
    h: gridRows * cellH + (gridRows + 1) * ROAD,
  };
  const MARGIN = 600;                   // countryside around the city

  const buildings = [];                 // solid rectangles
  const stops = [];                     // parking spots: stop here to visit
  districts.forEach((dist, i) => {
    dist.x = ROAD + (i % gridCols) * (cellW + ROAD);
    dist.y = ROAD + Math.floor(i / gridCols) * (cellH + ROAD);
    dist.w = cellW; dist.h = cellH;
    let slot = 0;
    const place = (item, span) => {
      const col = slot % COLS, row = Math.floor(slot / COLS);
      const lotX = dist.x + PAD + col * LOT_W + (cellW - dist.w) / 2;
      const lotY = dist.y + HEADER + row * LOT_H;
      const bw = span * LOT_W - 30;
      const b = { x: lotX + 15, y: lotY + 10, w: bw, h: 92, item, dist, hall: span > 1 };
      const p = { x: lotX + 15 + bw / 2 - 40, y: lotY + 112, w: 80, h: 46, item, building: b };
      buildings.push(b); stops.push(p);
      slot += span;
    };
    if (dist.hall) place(dist.hall, 2);
    dist.items.forEach(item => place(item, 1));
  });

  // ---------------------------------------------------------------- visited stamps (per browser)
  const VISITED_KEY = "netbox-roadtrip-visited";
  let visited = new Set();
  try { visited = new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || "[]")); } catch (e) { /* no storage */ }
  function markVisited(key) {
    visited.add(key);
    try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visited])); } catch (e) { /* no storage */ }
  }

  // ---------------------------------------------------------------- the car
  const START = { x: ROAD / 2, y: ROAD / 2, angle: Math.PI / 2 };   // top-left crossing, facing down
  const car = { x: START.x, y: START.y, angle: START.angle, speed: 0, w: 24, l: 44, hue: 0 };
  const keys = {};
  let started = false, paused = false;
  let parkedAt = null, parkTimer = 0, lastVisit = null;

  function surfaceAt(x, y) {
    if (x < 0 || y < 0 || x > WORLD.w || y > WORLD.h) return "grass";
    for (const d of districts) if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return "plaza";
    return "road";
  }
  const MAX = { road: 520, plaza: 300, grass: 170 };

  function update(dt) {
    const up = keys.ArrowUp || keys.KeyW, down = keys.ArrowDown || keys.KeyS;
    const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
    const brake = keys.Space;
    const surface = surfaceAt(car.x, car.y);
    const max = MAX[surface];

    if (up) car.speed += (car.speed < 0 ? 900 : 420) * dt;
    else if (down) car.speed -= (car.speed > 0 ? 900 : 300) * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 260 * dt);   // rolling to a stop
    if (brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 1400 * dt);
    if (car.speed > max) car.speed = Math.max(max, car.speed - 700 * dt);                 // slowed down off-road
    car.speed = Math.max(-180, car.speed);

    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const grip = Math.min(1, Math.abs(car.speed) / 120);
    car.angle += steer * 2.8 * grip * dt * Math.sign(car.speed || 1);

    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    car.x = Math.min(WORLD.w + MARGIN - 20, Math.max(-MARGIN + 20, nx));
    car.y = Math.min(WORLD.h + MARGIN - 20, Math.max(-MARGIN + 20, ny));

    // Bump into buildings: push the car out and bounce back a little
    const r = 15;
    for (const b of buildings) {
      const cx = Math.max(b.x, Math.min(car.x, b.x + b.w)), cy = Math.max(b.y, Math.min(car.y, b.y + b.h));
      const dx = car.x - cx, dy = car.y - cy, dist2 = dx * dx + dy * dy;
      if (dist2 < r * r) {
        const dist = Math.sqrt(dist2) || 0.01;
        car.x = cx + (dx / dist) * r; car.y = cy + (dy / dist) * r;
        if (dist2 === 0) car.y = b.y + b.h + r;
        car.speed *= -0.3;
      }
    }

    // Parked on a P? Stand still there for a moment and you're in
    const spot = stops.find(p => car.x >= p.x && car.x <= p.x + p.w && car.y >= p.y && car.y <= p.y + p.h);
    if (spot !== parkedAt) { parkedAt = spot || null; parkTimer = 0; }
    if (!spot) lastVisit = null;
    if (spot && Math.abs(car.speed) < 12 && lastVisit !== spot) {
      parkTimer += dt;
      if (parkTimer > 0.6) { lastVisit = spot; visit(spot.item); }
    }
  }

  // ---------------------------------------------------------------- visiting a building
  function visit(item) {
    markVisited(item.key);
    paused = true;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    car.speed = 0;
    document.getElementById("rt-modal-title").textContent =
      `${{ device: "🖥️ Device", site: "📍 Site", tenant: "🏛️ Tenant" }[item.kind]}: ${item.name}`;
    document.getElementById("rt-modal-open").href = item.url;
    frame.src = item.url;
    modal.classList.add("rt-open");
    document.getElementById("rt-modal-close").focus();
  }
  function leave() {
    if (!modal.classList.contains("rt-open")) return;
    modal.classList.remove("rt-open");
    frame.src = "about:blank";
    paused = false;
    canvas.focus();
  }
  document.getElementById("rt-modal-close").addEventListener("click", leave);
  modal.addEventListener("click", e => { if (e.target === modal) leave(); });
  frame.addEventListener("load", () => {
    // Esc also works while the page inside has the focus (same origin)
    try {
      const doc = frame.contentDocument;
      // Just the object, without NetBox's menu and top bar around it
      const style = doc.createElement("style");
      style.textContent = "aside.navbar-vertical, header.navbar, footer.footer { display: none !important; }"
        + " .page-wrapper { margin-left: 0 !important; padding-top: 0 !important; }";
      doc.head.appendChild(style);
      frame.contentWindow.addEventListener("keydown", e => { if (e.key === "Escape") leave(); });
    } catch (e) { /* not the same origin - show the page as it is */ }
  });

  // ---------------------------------------------------------------- input
  const GAME_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space"];
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") { leave(); return; }
    if (!started || paused) return;
    if (document.activeElement !== canvas) return;
    if (GAME_KEYS.includes(e.code)) { keys[e.code] = true; e.preventDefault(); }
    if (e.code === "KeyR") Object.assign(car, { x: START.x, y: START.y, angle: START.angle, speed: 0 });
  });
  window.addEventListener("keyup", e => { if (GAME_KEYS.includes(e.code)) keys[e.code] = false; });
  canvas.addEventListener("blur", () => Object.keys(keys).forEach(k => { keys[k] = false; }));
  function start() {
    started = true;
    startOverlay.style.display = "none";
    canvas.focus();
  }
  startOverlay.addEventListener("click", start);
  canvas.addEventListener("click", () => { if (!started) start(); canvas.focus(); });

  // ---------------------------------------------------------------- drawing
  let viewW = 0, viewH = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = wrap.clientWidth; viewH = wrap.clientHeight;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  const STATUS_COLORS = { active: "#22c55e", planned: "#3b82f6", staged: "#06b6d4", offline: "#ef4444",
    failed: "#ef4444", inventory: "#a855f7", decommissioning: "#f59e0b", retired: "#94a3b8" };

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fitText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
    return text + "…";
  }

  function drawWorld(camX, camY) {
    // countryside
    ctx.fillStyle = "#3f7d3a";
    ctx.fillRect(-MARGIN, -MARGIN, WORLD.w + 2 * MARGIN, WORLD.h + 2 * MARGIN);
    ctx.fillStyle = "#4a8c43";
    for (let i = 0; i < 160; i++) {          // a few fixed tufts of grass
      const x = ((i * 977) % (WORLD.w + 2 * MARGIN)) - MARGIN, y = ((i * 613) % (WORLD.h + 2 * MARGIN)) - MARGIN;
      if (surfaceAt(x, y) === "grass") { ctx.beginPath(); ctx.arc(x, y, 18 + (i % 5) * 4, 0, Math.PI * 2); ctx.fill(); }
    }
    // asphalt city with lane markings
    ctx.fillStyle = "#3b3f46";
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.strokeStyle = "#e5c34a"; ctx.lineWidth = 4; ctx.setLineDash([28, 22]);
    ctx.beginPath();
    for (let c = 0; c <= gridCols; c++) { const x = c * (cellW + ROAD) + ROAD / 2; ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); }
    for (let r = 0; r <= gridRows; r++) { const y = r * (cellH + ROAD) + ROAD / 2; ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); }
    ctx.stroke(); ctx.setLineDash([]);

    for (const d of districts) {
      ctx.fillStyle = `hsl(${d.hue} 35% 82%)`;
      roundRect(d.x, d.y, d.w, d.h, 18); ctx.fill();
      ctx.strokeStyle = `hsl(${d.hue} 40% 55%)`; ctx.lineWidth = 6; ctx.stroke();
      // name sign
      ctx.fillStyle = `hsl(${d.hue} 45% 32%)`;
      roundRect(d.x + 20, d.y + 14, d.w - 40, 44, 8); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 22px system-ui, sans-serif"; ctx.textBaseline = "middle";
      ctx.fillText(fitText(d.title, d.w - 260), d.x + 34, d.y + 36);
      ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(fitText(d.subtitle, 200), d.x + d.w - 34, d.y + 36);
      ctx.textAlign = "left";
    }

    for (const p of stops) {
      ctx.fillStyle = "rgba(255,255,255,.55)";
      roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.strokeStyle = parkedAt === p ? "#2563eb" : "#ffffff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = parkedAt === p ? "#2563eb" : "#64748b";
      ctx.font = "700 24px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("P", p.x + p.w / 2, p.y + p.h / 2 + 1);
      ctx.textAlign = "left";
    }

    for (const b of buildings) {
      const it = b.item;
      ctx.fillStyle = "rgba(0,0,0,.18)";                 // shadow
      roundRect(b.x + 6, b.y + 6, b.w, b.h, 8); ctx.fill();
      ctx.fillStyle = it.kind === "tenant" ? `hsl(${b.dist.hue} 45% 40%)` : `#${it.color}`;
      roundRect(b.x, b.y, b.w, b.h, 8); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.88)";           // roof label
      roundRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16, 6); ctx.fill();
      ctx.fillStyle = "#0f172a"; ctx.textBaseline = "middle";
      const icon = { device: "🖥️", site: "📍", tenant: "🏛️" }[it.kind];
      ctx.font = `700 ${b.hall ? 18 : 14}px system-ui, sans-serif`;
      ctx.fillText(fitText(`${icon} ${it.name}`, b.w - 32), b.x + 16, b.y + 30);
      ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#334155";
      (it.lines || []).slice(0, 2).forEach((line, i) => ctx.fillText(fitText(line, b.w - 32), b.x + 16, b.y + 52 + i * 15));
      if (it.status) {                                     // status light
        ctx.fillStyle = STATUS_COLORS[it.status] || "#94a3b8";
        ctx.beginPath(); ctx.arc(b.x + b.w - 16, b.y + 16, 6, 0, Math.PI * 2); ctx.fill();
      }
      if (visited.has(it.key)) {                           // visited flag
        ctx.font = "18px system-ui, sans-serif"; ctx.fillText("🚩", b.x + b.w - 26, b.y + b.h - 18);
      }
    }
  }

  function drawCar() {
    ctx.save();
    ctx.translate(car.x, car.y); ctx.rotate(car.angle);
    ctx.fillStyle = "rgba(0,0,0,.3)"; roundRect(-car.l / 2 + 4, -car.w / 2 + 4, car.l, car.w, 7); ctx.fill();
    ctx.fillStyle = "#111827";                              // wheels
    [[-13, -14], [9, -14], [-13, 10], [9, 10]].forEach(([x, y]) => ctx.fillRect(x, y, 10, 4));
    ctx.fillStyle = "#dc2626"; roundRect(-car.l / 2, -car.w / 2, car.l, car.w, 7); ctx.fill();
    ctx.fillStyle = "#bfdbfe"; roundRect(2, -car.w / 2 + 4, 11, car.w - 8, 3); ctx.fill();    // windscreen
    ctx.fillStyle = "#93c5fd"; roundRect(-16, -car.w / 2 + 5, 8, car.w - 10, 3); ctx.fill();  // rear window
    ctx.fillStyle = "#fde68a";                              // headlights
    ctx.fillRect(car.l / 2 - 3, -car.w / 2 + 3, 3, 5); ctx.fillRect(car.l / 2 - 3, car.w / 2 - 8, 3, 5);
    ctx.restore();
  }

  function drawMinimap() {
    const mw = 190, mh = Math.max(60, Math.min(190, mw * WORLD.h / WORLD.w));
    const s = Math.min(mw / WORLD.w, mh / WORLD.h);
    const x0 = viewW - mw - 12, y0 = viewH - mh - 12;
    ctx.fillStyle = "rgba(15,23,42,.75)"; roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 6); ctx.fill();
    ctx.fillStyle = "#3b3f46"; ctx.fillRect(x0, y0, WORLD.w * s, WORLD.h * s);
    for (const d of districts) {
      ctx.fillStyle = `hsl(${d.hue} 45% 60%)`; ctx.fillRect(x0 + d.x * s, y0 + d.y * s, d.w * s, d.h * s);
    }
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(x0 + Math.max(0, Math.min(WORLD.w, car.x)) * s, y0 + Math.max(0, Math.min(WORLD.h, car.y)) * s, 4, 0, Math.PI * 2); ctx.fill();
  }

  function districtAt(x, y) {
    return districts.find(d => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
  }

  const totalStops = stops.length;
  function drawHud() {
    const d = districtAt(car.x, car.y), surface = surfaceAt(car.x, car.y);
    const where = d ? d.title : surface === "road" ? "On the road" : "Off-road 🌾";
    const seen = stops.filter(p => visited.has(p.item.key)).length;
    const parked = parkedAt ? `<div class="mt-1">🅿️ ${escapeHtml(parkedAt.item.name)}${Math.abs(car.speed) < 12 ? "" : " - stop here to visit"}</div>` : "";
    const capped = DATA.total_devices > DATA.devices.length
      ? `<div class="rt-muted">${DATA.devices.length} of ${DATA.total_devices} devices placed</div>` : "";
    hud.innerHTML = `<div class="rt-big">${Math.round(Math.abs(car.speed) / 5)} km/h</div>
      <div>${escapeHtml(where)}</div>${parked}
      <div class="rt-muted mt-1">🚩 Visited ${seen} of ${totalStops}</div>${capped}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------------------------------------------------------------- main loop
  let camX = car.x, camY = car.y, last = performance.now(), hudTimer = 0;
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (started && !paused) update(dt);
    // camera eases after the car and looks a little ahead
    const lookX = car.x + Math.cos(car.angle) * car.speed * 0.35, lookY = car.y + Math.sin(car.angle) * car.speed * 0.35;
    camX += (lookX - camX) * Math.min(1, dt * 4); camY += (lookY - camY) * Math.min(1, dt * 4);
    const zoom = Math.max(0.55, 1 - Math.abs(car.speed) / 1400);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#3f7d3a"; ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(viewW / 2, viewH / 2); ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
    drawWorld(camX, camY);
    drawCar();
    ctx.restore();
    drawMinimap();
    hudTimer -= dt;
    if (hudTimer <= 0) { drawHud(); hudTimer = 0.1; }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  // For automated tests: the state, and a way to put the car somewhere
  window.netboxRoadTrip = {
    car, stops, districts, keys,
    teleport(x, y, angle) { Object.assign(car, { x, y, angle: angle ?? car.angle, speed: 0 }); },
    start,
  };
})();
{% endverbatim %}
