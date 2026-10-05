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
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- city layout
  const LOT_W = 230, LOT_H = 200;      // one building + its parking spot + a lane below
  const PAD = 40, HEADER = 70;          // district padding and the name sign at its top
  const ROAD = 150;                     // road width around the districts
  const MARGIN = 600;                   // countryside around the city

  function hashHue(text) {
    let h = 0;
    for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function deviceItem(d) {
    return {
      kind: "device", key: `device-${d.id}`, name: d.name, url: d.url, color: d.color || "9e9e9e",
      lines: [d.type, [d.role, d.site].filter(Boolean).join(" · "), d.ip].filter(Boolean),
      status: d.status, statusLabel: d.status_label,
    };
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Districts: one per tenant (its devices), one for devices without a tenant, one for the sites
  const districts = [];
  const byTenant = new Map(DATA.tenants.map(t => [t.id, []]));
  const noTenant = [];
  for (const d of DATA.devices) (byTenant.get(d.tenant) || noTenant).push(d);
  if (DATA.sites.length) {
    districts.push({
      title: "Sites", subtitle: plural(DATA.sites.length, "site"), hue: 205, hall: null,
      items: DATA.sites.map(s => ({
        kind: "site", key: `site-${s.id}`, name: s.name, url: s.url, color: "607d8b",
        lines: [s.status_label, s.region].filter(Boolean), status: s.status,
      })),
    });
  }
  for (const t of DATA.tenants) {
    const devs = byTenant.get(t.id);
    districts.push({
      title: t.name, subtitle: plural(devs.length, "device") + (t.group ? " · " + t.group : ""), hue: hashHue(t.name),
      hall: { kind: "tenant", key: `tenant-${t.id}`, name: t.name, url: t.url, lines: ["Tenant town hall"] },
      items: devs.map(deviceItem),
    });
  }
  if (noTenant.length) {
    districts.push({ title: "No tenant", subtitle: plural(noTenant.length, "device"), hue: 30, hall: null,
                     items: noTenant.map(deviceItem) });
  }
  // The jump park with its ramp goes in the middle of the city
  const park = { title: "Jump park", subtitle: "full speed up the ramp ↑", hue: 0, park: true, hall: null, items: [] };
  districts.splice(Math.floor(districts.length / 2), 0, park);

  // 3-4 bars, each its own little lot, dropped in at random places in the city
  const BAR_STYLES = {
    tudor: { hue: 30, sign: "#7c2d12" }, neon: { hue: 280, sign: "#581c87" },
    tiki: { hue: 45, sign: "#854d0e" }, irish: { hue: 140, sign: "#14532d" },
  };
  const BAR_TYPES = [
    { name: "The Packet Loss Pub", style: "tudor" }, { name: "Bar Ping", style: "neon" },
    { name: "The Tiki TTL", style: "tiki" }, { name: "O'Router's Irish Pub", style: "irish" },
  ];
  const bars = [...BAR_TYPES].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 3 : 4).map(b => ({
    title: b.name, subtitle: "🍹", hue: BAR_STYLES[b.style].hue, bar: b, hall: null,
    items: [{ kind: "bar", key: `bar-${b.style}`, name: b.name, style: b.style, lines: [] }],
  }));
  for (const b of bars) districts.splice(Math.floor(Math.random() * (districts.length + 1)), 0, b);

  // Each district is as big as its own buildings need: wider rather than endlessly tall
  for (const dist of districts) {
    const slots = dist.items.length + (dist.hall ? 2 : 0);
    dist.cols = dist.park ? 4 : dist.bar ? 2 : Math.max(4, Math.ceil(Math.sqrt(slots * 1.3)));
    dist.rows = dist.park ? 2 : Math.max(1, Math.ceil(slots / dist.cols));
    dist.w = dist.cols * LOT_W + 2 * PAD;
    dist.h = HEADER + dist.rows * LOT_H + PAD;
  }

  // Shelf packing: districts left to right in rows, roads around every district
  const totalArea = districts.reduce((a, d) => a + (d.w + ROAD) * (d.h + ROAD), 0);
  const rowLimit = Math.max(...districts.map(d => d.w + ROAD), Math.sqrt(totalArea) * 1.3);
  const WORLD = { w: 0, h: 0 };
  let roads = [];                       // asphalt rectangles; anything else outside a district is grass
  function pack() {
    const cityRows = [];
    let cur = null;
    for (const dist of districts) {
      if (!cur || cur.width + dist.w + ROAD > rowLimit + ROAD) { cur = { items: [], width: ROAD, height: 0 }; cityRows.push(cur); }
      cur.items.push(dist);
      cur.width += dist.w + ROAD;
      cur.height = Math.max(cur.height, dist.h);
    }
    WORLD.w = Math.max(...cityRows.map(r => r.width));
    roads = [];
    let rowY = ROAD;
    for (const row of cityRows) {
      roads.push({ x: 0, y: rowY - ROAD, w: WORLD.w, h: ROAD, dir: "h" });      // road above the row
      let x = ROAD;
      for (const dist of row.items) {
        roads.push({ x: x - ROAD, y: rowY - ROAD, w: ROAD, h: row.height + 2 * ROAD, dir: "v" });   // left of it
        dist.x = x; dist.y = rowY;
        x += dist.w + ROAD;
      }
      roads.push({ x: x - ROAD, y: rowY - ROAD, w: ROAD, h: row.height + 2 * ROAD, dir: "v" });     // after the last
      rowY += row.height + ROAD;
    }
    roads.push({ x: 0, y: rowY - ROAD, w: WORLD.w, h: ROAD, dir: "h" });        // bottom road
    WORLD.h = rowY;
  }
  pack();
  // Move the jump park to the district nearest the middle of the map, and lay the city out again
  const centreOf = d => Math.hypot(d.x + d.w / 2 - WORLD.w / 2, d.y + d.h / 2 - WORLD.h / 2);
  const middle = districts.reduce((a, d) => (centreOf(d) < centreOf(a) ? d : a));
  if (middle !== park) {
    const i = districts.indexOf(middle), j = districts.indexOf(park);
    [districts[i], districts[j]] = [districts[j], districts[i]];
    pack();
  }

  const buildings = [];                 // solid rectangles
  const stops = [];                     // parking spots: stop here to visit
  for (const dist of districts) {
    if (dist.park) continue;
    let slot = 0;
    const place = (item, span) => {
      if (span > 1 && slot % dist.cols > dist.cols - span) slot += dist.cols - (slot % dist.cols);
      const col = slot % dist.cols, row = Math.floor(slot / dist.cols);
      const lotX = dist.x + PAD + col * LOT_W, lotY = dist.y + HEADER + row * LOT_H;
      const bw = span * LOT_W - 30;
      const b = { x: lotX + 15, y: lotY + 10, w: bw, h: 92, item, dist, hall: span > 1 };
      const p = { x: lotX + 15 + bw / 2 - 40, y: lotY + 112, w: 80, h: 46, item, building: b };
      buildings.push(b); stops.push(p);
      slot += span;
    };
    if (dist.hall) place(dist.hall, 2);
    dist.items.forEach(item => place(item, dist.bar ? 2 : 1));
  }
  // The ramp: drive up it northwards, fast
  const RAMP = { w: 130, h: 170 };
  RAMP.x = park.x + park.w / 2 - RAMP.w / 2;
  RAMP.y = park.y + HEADER + 60;

  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  function districtAt(px, py) { return districts.find(d => inRect(px, py, d)); }
  function surfaceAt(px, py) {
    const d = districtAt(px, py);
    if (d) return d.park ? "road" : "plaza";
    return roads.some(r => inRect(px, py, r)) ? "road" : "grass";
  }

  // ---------------------------------------------------------------- visited stamps (per browser)
  const VISITED_KEY = "netbox-roadtrip-visited";
  let visited = new Set();
  try { visited = new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || "[]")); } catch (e) { /* no storage */ }
  function markVisited(key) {
    visited.add(key);
    try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visited])); } catch (e) { /* no storage */ }
  }

  // ---------------------------------------------------------------- sound (Web Audio, made on the fly - no files)
  const MUTE_KEY = "netbox-roadtrip-muted";
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* no storage */ }
  let audio = null, noiseBuffer = null;
  const VOLUME = 0.5;

  function initAudio() {   // browsers only allow sound after a click or key press
    if (audio) { audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain(); master.gain.value = muted ? 0 : VOLUME; master.connect(ac.destination);
    // engine: a low sawtooth plus a sub-octave square through a low-pass filter
    const osc = ac.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 40;
    const sub = ac.createOscillator(); sub.type = "square"; sub.frequency.value = 20;
    const filter = ac.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 300; filter.Q.value = 4;
    const engine = ac.createGain(); engine.gain.value = 0;
    osc.connect(filter); sub.connect(filter); filter.connect(engine); engine.connect(master);
    osc.start(); sub.start();
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // wind while flying: looping noise through a band-pass
    const windSrc = ac.createBufferSource(); windSrc.buffer = noiseBuffer; windSrc.loop = true;
    const windFilter = ac.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 600;
    const wind = ac.createGain(); wind.gain.value = 0;
    windSrc.connect(windFilter); windFilter.connect(wind); wind.connect(master); windSrc.start();
    audio = { ctx: ac, master, osc, sub, filter, engine, wind, windFilter };
  }
  function setMuted(value) {
    muted = value;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* no storage */ }
    if (audio) audio.master.gain.setTargetAtTime(muted ? 0 : VOLUME, audio.ctx.currentTime, 0.02);
  }
  function engineSound(throttle) {
    if (!audio) return;
    const t = audio.ctx.currentTime, v = Math.abs(car.speed);
    const running = started && !paused;
    const pitch = 38 + v * 0.17 + (throttle ? 6 : 0) + (car.flying ? 25 : 0);
    audio.osc.frequency.setTargetAtTime(pitch, t, 0.06);
    audio.sub.frequency.setTargetAtTime(pitch / 2, t, 0.06);
    audio.filter.frequency.setTargetAtTime(260 + v * 1.6 + (throttle ? 350 : 0), t, 0.06);
    audio.engine.gain.setTargetAtTime(running ? 0.05 + (throttle ? 0.04 : 0) + Math.min(v, 520) / 520 * 0.05 : 0, t, 0.08);
    audio.wind.gain.setTargetAtTime(running && car.flying ? 0.08 + car.height * 0.18 : 0, t, 0.15);
    audio.windFilter.frequency.setTargetAtTime(400 + car.height * 900, t, 0.2);
  }
  function tone(freq, start, duration, type, volume, endFreq) {
    if (!audio) return;
    const t = audio.ctx.currentTime + start;
    const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + duration + 0.05);
  }
  function noise(duration, filterType, frequency, volume, endFrequency) {
    if (!audio || !noiseBuffer) return;
    const t = audio.ctx.currentTime;
    const src = audio.ctx.createBufferSource(); src.buffer = noiseBuffer;
    const f = audio.ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(frequency, t); f.Q.value = 1.5;
    if (endFrequency) f.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f); f.connect(g); g.connect(audio.master); src.start(t); src.stop(t + duration + 0.05);
  }
  const sfx = {
    bump(strength) { noise(0.25, "lowpass", 380, Math.min(0.9, 0.25 + strength / 500)); tone(70, 0, 0.18, "sine", 0.5); },
    skid() { noise(0.35, "bandpass", 2300, 0.18); },
    horn() { tone(415, 0, 0.38, "square", 0.12); tone(523, 0, 0.38, "square", 0.1); },
    arrive() { [660, 880, 1320].forEach((f, i) => tone(f, i * 0.09, 0.32, "sine", 0.22)); },
    park() { tone(990, 0, 0.07, "triangle", 0.15); },
    peep() { tone(1900, 0, 0.06, "sine", 0.08, 2300); tone(1900, 0.1, 0.06, "sine", 0.08, 2400); },
    squawk() { tone(1300, 0, 0.16, "square", 0.12, 500); tone(1500, 0.18, 0.2, "square", 0.12, 450); },
    spin() { noise(1.2, "bandpass", 2600, 0.22, 900); },
    launch() { noise(0.8, "bandpass", 300, 0.4, 2500); tone(180, 0, 0.5, "sawtooth", 0.1, 420); },
    land() { noise(0.4, "lowpass", 300, 0.9); tone(55, 0, 0.3, "sine", 0.6); },
    tweet() { tone(rand(2500, 3800), 0, 0.08, "sine", 0.05, rand(3000, 4500)); },
    doorbell() { tone(1568, 0, 0.5, "sine", 0.15); tone(1319, 0.15, 0.6, "sine", 0.15); },
    talk(n) { for (let i = 0; i < n; i++) tone(rand(180, 320), i * 0.09, 0.07, "square", 0.05); },
    pour() { noise(1.0, "bandpass", 1400, 0.12, 700); },
    glug() { [0, 0.35, 0.7].forEach(d => tone(140, d, 0.18, "sine", 0.3, 70)); },
    hic() { tone(500, 0, 0.12, "triangle", 0.25, 1100); },
    whistle() { tone(2600, 0, 0.25, "sine", 0.2, 2900); tone(2600, 0.3, 0.6, "sine", 0.2, 2400); },
  };
  let siren = null;
  function sirenOn() {
    if (!audio || siren) return;
    const o = audio.ctx.createOscillator(), g = audio.ctx.createGain(), t = audio.ctx.currentTime;
    o.type = "square"; g.gain.value = 0.045;
    for (let i = 0; i < 60; i++) o.frequency.setValueAtTime(i % 2 ? 960 : 720, t + i * 0.45);
    o.connect(g); g.connect(audio.master); o.start(t);
    siren = { o, g };
  }
  function sirenOff() {
    if (!siren) return;
    const t = audio.ctx.currentTime;
    siren.g.gain.setTargetAtTime(0, t, 0.3); siren.o.stop(t + 1.5);
    siren = null;
  }

  // ---------------------------------------------------------------- the car
  const START = { x: ROAD / 2, y: ROAD / 2, angle: Math.PI / 2 };   // top-left crossing, facing down
  const car = { x: START.x, y: START.y, angle: START.angle, moveAngle: START.angle, speed: 0, w: 24, l: 44,
                spin: 0, spinRate: 0, flying: false, flightT: 0, flightDur: 0, height: 0 };
  const keys = {};
  const stats = { safe: 0, bumped: 0, jumps: 0, drinks: 0 };
  let started = false, paused = false;
  let parkedAt = null, parkTimer = 0, lastVisit = null, skidCooldown = 0, bumpCooldown = 0;
  const MAX = { road: 520, plaza: 300, grass: 170 };

  function resetCar() {
    Object.assign(car, { x: START.x, y: START.y, angle: START.angle, moveAngle: START.angle, speed: 0,
                         spin: 0, flying: false, height: 0 });
  }

  function update(dt) {
    const up = keys.ArrowUp || keys.KeyW, down = keys.ArrowDown || keys.KeyS;
    const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
    const brake = keys.Space;
    skidCooldown -= dt; bumpCooldown -= dt;
    if (police.active) updatePolice(dt);
    if (sobering()) return;

    if (car.flying) {
      // In the air: no grip, a little steering, then land
      car.flightT += dt;
      car.height = Math.sin(Math.PI * Math.min(1, car.flightT / car.flightDur));
      car.angle += ((right ? 1 : 0) - (left ? 1 : 0)) * 0.8 * dt;
      car.moveAngle = car.angle;
      if (car.flightT >= car.flightDur) {
        car.flying = false; car.height = 0; car.speed *= 0.7;
        sfx.land();
      }
    } else if (car.spin > 0) {
      // Spinning out after a penguin: the car slides on, turning, no control
      car.spin -= dt;
      car.angle += car.spinRate * dt;
      car.spinRate *= Math.pow(0.35, dt);
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 330 * dt);
      if (car.spin <= 0) { car.moveAngle = car.angle; car.speed *= 0.5; }
    } else {
      const max = MAX[surfaceAt(car.x, car.y)];
      if (up) car.speed += (car.speed < 0 ? 900 : 420) * dt;
      else if (down) car.speed -= (car.speed > 0 ? 900 : 300) * dt;
      else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 260 * dt);   // rolling to a stop
      if (brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 1400 * dt);
      const hardBrake = brake || (down && car.speed > 0) || (up && car.speed < 0);
      if (hardBrake && Math.abs(car.speed) > 230 && skidCooldown <= 0) { sfx.skid(); skidCooldown = 0.3; }
      if (car.speed > max) car.speed = Math.max(max, car.speed - 700 * dt);             // slowed down off-road
      car.speed = Math.max(-180, car.speed);
      const steer = (right ? 1 : 0) - (left ? 1 : 0);
      const grip = Math.min(1, Math.abs(car.speed) / 120);
      car.angle += steer * 2.8 * grip * dt * Math.sign(car.speed || 1);
      car.moveAngle = car.angle;

      // Up the ramp, fast and northwards: take off
      if (inRect(car.x, car.y, RAMP) && car.speed > 230 && Math.sin(car.angle) < -0.55) takeOff();
    }

    car.x += Math.cos(car.moveAngle) * car.speed * dt;
    car.y += Math.sin(car.moveAngle) * car.speed * dt;
    car.x = Math.min(WORLD.w + MARGIN - 20, Math.max(-MARGIN + 20, car.x));
    car.y = Math.min(WORLD.h + MARGIN - 20, Math.max(-MARGIN + 20, car.y));

    if (!car.flying) collide();
    updatePenguins(dt);
    if (car.flying) updateBirds(dt);

    // Parked on a P? Stand still there for a moment and you're in
    const spot = car.flying ? null : nearby(stops, car.x, car.y, 60).find(p => inRect(car.x, car.y, p));
    if (spot !== parkedAt) { parkedAt = spot || null; parkTimer = 0; if (spot && spot !== lastVisit) sfx.park(); }
    if (!spot) lastVisit = null;
    if (spot && Math.abs(car.speed) < 12 && car.spin <= 0 && lastVisit !== spot) {
      parkTimer += dt;
      if (parkTimer > 0.6) { lastVisit = spot; if (spot.item.kind === "bar") enterBar(spot.item); else visit(spot.item); }
    }
  }

  // Bump into buildings: push the car out and bounce back a little
  function collide() {
    const r = 15;
    for (const b of nearby(buildings, car.x, car.y, 40)) {
      const cx = Math.max(b.x, Math.min(car.x, b.x + b.w)), cy = Math.max(b.y, Math.min(car.y, b.y + b.h));
      const dx = car.x - cx, dy = car.y - cy, dist2 = dx * dx + dy * dy;
      if (dist2 < r * r) {
        const dist = Math.sqrt(dist2) || 0.01;
        car.x = cx + (dx / dist) * r; car.y = cy + (dy / dist) * r;
        if (dist2 === 0) car.y = b.y + b.h + r;
        if (Math.abs(car.speed) > 40 && bumpCooldown <= 0) { sfx.bump(Math.abs(car.speed)); bumpCooldown = 0.25; }
        car.speed *= -0.3;
      }
    }
  }
  // Rectangles within `pad` of a point (cheap pre-filter; the city has at most a few thousand)
  function nearby(rects, px, py, pad) {
    return rects.filter(r => px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad);
  }

  // ---------------------------------------------------------------- penguins
  const penguins = [];
  let penguinTimer = rand(4, 8);
  function updatePenguins(dt) {
    penguinTimer -= dt;
    if (penguinTimer <= 0) {
      penguinTimer = rand(5, 12);
      spawnPenguin();
    }
    for (const p of penguins) {
      p.t += dt;
      if (p.state === "walk") {
        p.x += Math.cos(p.dir) * 38 * dt; p.y += Math.sin(p.dir) * 38 * dt;
        p.walked += 38 * dt;
        const d = Math.hypot(car.x - p.x, car.y - p.y);
        p.closest = Math.min(p.closest, d);
        if (!car.flying && d < 26) {
          if (Math.abs(car.speed) > 60 && car.spin <= 0) hitPenguin(p);
          else if (car.speed > 0) car.speed = 0;               // slow enough: it just blocks the way
        }
        if (p.walked > p.distance) {
          p.state = "gone";
          if (!p.hit && p.closest < 220) stats.safe++;
        }
      } else if (p.state === "tumble") {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= Math.pow(0.2, dt); p.vy *= Math.pow(0.2, dt);
        p.rot += p.vr * dt; p.vr *= Math.pow(0.3, dt);
        if (p.t > 1.6) { p.state = "walk"; p.t = 0; p.rot = 0; p.walked = Math.max(p.walked, p.distance - 80); }
      }
    }
    for (let i = penguins.length - 1; i >= 0; i--) if (penguins[i].state === "gone") penguins.splice(i, 1);
  }
  function spawnPenguin(force) {
    if (!force && (!started || paused || car.flying || sobering() || penguins.length >= 3 || Math.abs(car.speed) < 100)) return null;
    const ahead = force ? 300 : rand(380, 620);
    const fx = car.x + Math.cos(car.moveAngle) * ahead, fy = car.y + Math.sin(car.moveAngle) * ahead;
    if (!force && surfaceAt(fx, fy) !== "road") return null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const dir = car.moveAngle + side * Math.PI / 2;
    const back = 110;
    const p = { x: fx - Math.cos(dir) * back, y: fy - Math.sin(dir) * back, dir, t: 0, walked: 0, distance: back * 2,
                state: "walk", rot: 0, vr: 0, vx: 0, vy: 0, closest: Infinity, hit: false };
    penguins.push(p);
    sfx.peep();
    return p;
  }
  function hitPenguin(p) {
    p.state = "tumble"; p.t = 0; p.hit = true;
    p.vx = Math.cos(car.moveAngle) * car.speed * 0.9 + rand(-60, 60);
    p.vy = Math.sin(car.moveAngle) * car.speed * 0.9 + rand(-60, 60);
    p.vr = rand(-14, 14);
    stats.bumped++;
    car.spin = 1.7; car.spinRate = (Math.random() < 0.5 ? -1 : 1) * rand(9, 12);
    car.moveAngle = car.angle;
    sfx.squawk(); sfx.spin();
  }

  // ---------------------------------------------------------------- the jump and the prefix birds
  const PREFIXES = DATA.prefixes && DATA.prefixes.length ? DATA.prefixes
    : Array.from({ length: 40 }, () => `10.${Math.floor(rand(0, 255))}.${Math.floor(rand(0, 255))}.0/24`);
  let birds = [], tweetTimer = 0;
  function takeOff() {
    car.flying = true; car.flightT = 0; car.height = 0;
    car.flightDur = 2.6 + Math.min(car.speed, 520) / 260;
    car.speed = Math.max(car.speed, 420);
    stats.jumps++;
    sfx.launch();
    const shuffled = [...PREFIXES].sort(() => Math.random() - 0.5);
    birds = Array.from({ length: Math.min(35, Math.max(20, shuffled.length)) }, (_, i) => {
      const fromLeft = Math.random() < 0.5;
      return {
        text: shuffled[i % shuffled.length],
        x: rand(-0.2, 1.2), y: rand(0.05, 0.8), vx: (fromLeft ? 1 : -1) * rand(0.04, 0.13),
        phase: rand(0, Math.PI * 2), flap: rand(7, 12), size: rand(0.7, 1.3), hue: Math.floor(rand(0, 360)),
      };
    });
  }
  function updateBirds(dt) {
    for (const b of birds) {
      b.x += b.vx * dt;
      if (b.x > 1.25) b.x = -0.25; else if (b.x < -0.25) b.x = 1.25;
      b.phase += b.flap * dt;
    }
    tweetTimer -= dt;
    if (tweetTimer <= 0) { sfx.tweet(); tweetTimer = rand(0.15, 0.6); }
  }

  // ---------------------------------------------------------------- the bars: a pixel-art drink
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const DRINKS = [
    { name: "Singapore Ping", color: "#f43f5e" }, { name: "Mai Ping", color: "#f97316" },
    { name: "Ping and Tonic", color: "#d9f99d" }, { name: "Penguin Sunrise", color: "#fb923c", top: "#dc2626" },
    { name: "Ping-a Colada", color: "#fef9c3" }, { name: "Blue Screen Lagoon", color: "#38bdf8" },
    { name: "Long Island Iced TCP", color: "#a16207" }, { name: "Bloody Ping", color: "#b91c1c" },
    { name: "Cosmopoliping", color: "#f472b6" }, { name: "Moscow Packet Mule", color: "#fde68a" },
  ];
  const ORDERS = ["Hey, could I get a {d}?", "Evening! One {d}, please.", "Hmm... a {d}, please!", "I'll have a {d}, thanks!"];
  const REPLIES = ["One {d}, coming right up!", "{d}? Excellent choice.", "A {d} - no packet loss!", "{d}. Shaken, not routed."];
  const PALETTES = {
    tudor: { wall: "#7c4a1e", wall2: "#5c3714", floor: "#3b2410", counter: "#8b5a2b", top: "#c08040", shelf: "#4a2c10",
             lamp: "#fcd34d", tender: "#f5f5f4", apron: "#7f1d1d", title: "#fde68a" },
    neon: { wall: "#1e1b4b", wall2: "#312e81", floor: "#0f0a2a", counter: "#3b0764", top: "#c026d3", shelf: "#4c1d95",
            lamp: "#22d3ee", tender: "#111827", apron: "#ec4899", title: "#f0abfc" },
    tiki: { wall: "#a16207", wall2: "#854d0e", floor: "#fde68a", counter: "#78350f", top: "#b45309", shelf: "#713f12",
            lamp: "#fb923c", tender: "#facc15", apron: "#16a34a", title: "#fef08a" },
    irish: { wall: "#14532d", wall2: "#166534", floor: "#422006", counter: "#3f2a14", top: "#a3772c", shelf: "#2a1a0a",
             lamp: "#fde047", tender: "#f8fafc", apron: "#15803d", title: "#facc15" },
  };
  const barOverlay = document.getElementById("rt-bar"), barCanvas = document.getElementById("rt-bar-canvas");
  const bctx = barCanvas.getContext("2d");
  const pix = document.createElement("canvas"); pix.width = 160; pix.height = 90;
  const px = pix.getContext("2d");
  const BAR_END = 12.5;
  let barScene = null;

  function enterBar(item) {
    paused = true;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    car.speed = 0;
    const drink = pick(DRINKS);
    barScene = {
      item, pal: PALETTES[item.style], style: item.style, t: 0, drink, done: {},
      order: pick(ORDERS).replace("{d}", drink.name), reply: pick(REPLIES).replace("{d}", drink.name),
      bottles: Array.from({ length: 14 }, () => `hsl(${Math.floor(rand(0, 360))} 60% ${Math.floor(rand(35, 60))}%)`),
    };
    barOverlay.classList.add("rt-open");
    sfx.doorbell();
  }
  function closeBar() {
    barOverlay.classList.remove("rt-open");
    barScene = null;
    stats.drinks++;
    paused = false;
    canvas.focus();
    startPolice();          // ...and when he gets back into the car
  }
  function updateBar(dt) {
    const b = barScene;
    b.t += dt;
    const at = (time, key, fn) => { if (b.t >= time && !b.done[key]) { b.done[key] = true; fn(); } };
    at(3.0, "order", () => sfx.talk(7));
    at(5.4, "reply", () => sfx.talk(6));
    at(6.0, "pour", () => sfx.pour());
    at(7.8, "glug", () => sfx.glug());
    at(10.2, "hic", () => sfx.hic());
    drawBarScene(b);
    if (b.t >= BAR_END) closeBar();
  }

  function rect(c, x, y, w, h) { px.fillStyle = c; px.fillRect(x, y, w, h); }
  function person(x, feetY, shirt, frame, hair) {   // 7 px wide, 18 px tall
    rect("#1f2937", x + (frame ? 0 : 1), feetY - 2, 2, 2); rect("#1f2937", x + (frame ? 5 : 4), feetY - 2, 2, 2);  // shoes
    rect("#1e3a8a", x + 1, feetY - 8, 5, 6);                                                     // trousers
    if (frame) { rect("#1e3a8a", x, feetY - 4, 2, 2); rect("#1e3a8a", x + 5, feetY - 4, 2, 2); }   // stride
    rect(shirt, x, feetY - 14, 7, 6);                                                            // shirt
    rect("#fcd7b6", x + 1, feetY - 18, 5, 4);                                                    // head
    rect(hair, x + 1, feetY - 18, 5, 1);
    rect("#111827", x + 4, feetY - 17, 1, 1);                                                    // eye (facing right)
  }
  function drawBarScene(b) {
    const P = b.pal, t = b.t;
    rect(P.wall, 0, 0, 160, 62);
    for (let x = 0; x < 160; x += 8) rect(P.wall2, x, 0, 4, 62);                                 // panelling
    rect(P.floor, 0, 62, 160, 28);
    for (let x = 0; x < 160; x += 16) rect("rgba(0,0,0,.18)", x, 62, 1, 28);
    // style details
    if (b.style === "tudor") { rect("#2a160a", 0, 6, 160, 2); for (let x = 10; x < 90; x += 26) rect("#2a160a", x, 0, 2, 62); }
    if (b.style === "neon") { const on = Math.sin(t * 9) > -0.8; rect(on ? "#f0abfc" : "#581c87", 24, 4, 56, 1); rect(on ? "#f0abfc" : "#581c87", 24, 22, 56, 1); }
    if (b.style === "tiki") { for (let x = 0; x < 160; x += 4) rect(x % 8 ? "#ca8a04" : "#eab308", x, 0, 4, 5 + (x % 12 ? 0 : 2)); rect("#15803d", 6, 20, 10, 3); rect("#78350f", 10, 22, 2, 40); }
    if (b.style === "irish") { rect("#22c55e", 40, 12, 3, 3); rect("#22c55e", 44, 12, 3, 3); rect("#22c55e", 42, 9, 3, 3); rect("#15803d", 43, 15, 1, 3); }
    // door with light, hanging lamp
    rect("#1c1917", 4, 26, 16, 36); rect(P.lamp, 6, 28, 12, 14); rect("rgba(0,0,0,.25)", 6, 42, 12, 1);
    rect("#111827", 88, 0, 1, 10); rect(P.lamp, 85, 10, 7, 3);
    // shelves with bottles
    for (const sy of [16, 30]) {
      rect(P.shelf, 96, sy + 6, 62, 2);
      for (let i = 0; i < 7; i++) {
        const c = b.bottles[(sy === 16 ? 0 : 7) + i];
        rect(c, 99 + i * 8, sy - 1, 3, 7); rect(c, 100 + i * 8, sy - 3, 1, 2);
      }
    }
    // bartender behind the counter
    const tx = 128, wipe = t < 5.4 ? Math.round(Math.sin(t * 6)) : 0;
    rect("#fcd7b6", tx + 1, 32, 5, 4); rect("#3f3f46", tx + 1, 32, 5, 1); rect("#111827", tx + 2, 33, 1, 1);
    rect(P.tender, tx, 36, 7, 12); rect(P.apron, tx + 1, 40, 5, 8);
    rect("#fcd7b6", tx - 2 + wipe, 44, 2, 2);
    // the drink: poured on the counter, then in his hand
    const d = b.drink;
    let gx = 104, gy = 42, level = 0, inHand = false;
    if (t >= 6.0) level = Math.min(1, (t - 6.0) / 1.2);
    if (t >= 7.6) { inHand = true; level = Math.max(0, 1 - (t - 7.8) / 2.2); }
    // the guy walks in from the door, and wobbles a little after the drink
    const walkT = Math.min(1, t / 3.0);
    const gxPos = Math.round(10 + walkT * 74 + (t > 10 ? Math.sin(t * 5) * 2 : 0));
    const frame = walkT < 1 ? Math.floor(t * 8) % 2 : 0;
    // counter in front of everything behind it
    rect(P.top, 92, 47, 68, 3); rect(P.counter, 92, 50, 68, 22); rect("rgba(0,0,0,.2)", 92, 50, 68, 2);
    if (t >= 5.9 && !inHand) drawGlass(gx, gy, d, level);
    person(gxPos, 80, "#dc2626", frame, "#78350f");
    if (inHand) {
      const lift = t < 10 ? 10 : 3;   // up to his mouth while drinking
      drawGlass(gxPos + 6, 80 - 6 - lift, d, level);
    }

    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(pix, 0, 0, barCanvas.width, barCanvas.height);
    const S = barCanvas.width / 160;
    // the bar's name on the wall, the speech bubbles in crisp text
    bctx.font = "700 26px ui-monospace, monospace"; bctx.textAlign = "center"; bctx.textBaseline = "middle";
    bctx.lineWidth = 6; bctx.strokeStyle = "rgba(0,0,0,.6)"; bctx.strokeText(b.item.name, 52 * S, 13 * S);
    bctx.fillStyle = P.title; bctx.fillText(b.item.name, 52 * S, 13 * S);
    if (t >= 3.0 && t < 5.6) bubble(b.order, (gxPos + 3) * S, 58 * S, "left");
    if (t >= 5.4 && t < 7.6) bubble(b.reply, 130 * S, 33 * S, "right");
    if (t >= 8.0 && t < 10.0) bubble("*glug glug glug*", (gxPos + 3) * S, 58 * S, "left");
    if (t >= 10.2 && t < 11.6) bubble("Hic! ...Thanks!", (gxPos + 3) * S, 58 * S, "left");
    if (t > 11.5) { bctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - 11.5) / 1.0)})`; bctx.fillRect(0, 0, barCanvas.width, barCanvas.height); }
    bctx.textAlign = "left";
  }
  function drawGlass(x, y, d, level) {
    rect("rgba(226,232,240,.55)", x, y, 4, 6); rect("#e2e8f0", x - 1, y + 6, 6, 1);   // glass + foot
    const h = Math.round(5 * level);
    if (h > 0) { rect(d.color, x + 1, y + 6 - h, 2, h); if (d.top && h > 2) rect(d.top, x + 1, y + 5, 2, 1); }
  }
  function bubble(text, x, y, side) {
    bctx.font = "700 20px ui-monospace, monospace";
    const w = bctx.measureText(text).width + 28, h = 44;
    let bx = side === "left" ? x - 30 : x - w + 30;
    bx = Math.max(8, Math.min(barCanvas.width - w - 8, bx));
    const by = y - h - 24;
    bctx.fillStyle = "#fff"; bctx.strokeStyle = "#0f172a"; bctx.lineWidth = 4;
    bctx.beginPath(); bctx.roundRect(bx, by, w, h, 10); bctx.fill(); bctx.stroke();
    bctx.beginPath(); bctx.moveTo(x - 10, by + h - 2); bctx.lineTo(x, by + h + 18); bctx.lineTo(x + 10, by + h - 2); bctx.closePath();
    bctx.fill(); bctx.stroke(); bctx.fillRect(x - 8, by + h - 4, 16, 4);
    bctx.fillStyle = "#0f172a"; bctx.textAlign = "left"; bctx.fillText(text, bx + 14, by + h / 2 + 1);
    bctx.textAlign = "center";
  }

  // ---------------------------------------------------------------- the police: no driving after a drink
  const police = { active: false, x: 0, y: 0, angle: 0, phase: "", t: 0 };
  const SOBER_SECONDS = 10;
  let soberLeft = 0;
  function startPolice() {
    const from = car.angle + Math.PI;
    Object.assign(police, {
      active: true, phase: "arrive", t: 0,
      x: car.x + Math.cos(from) * 700, y: car.y + Math.sin(from) * 700,
      tx: car.x + Math.cos(from) * 75 + Math.cos(car.angle + Math.PI / 2) * 34,
      ty: car.y + Math.sin(from) * 75 + Math.sin(car.angle + Math.PI / 2) * 34,
    });
    soberLeft = SOBER_SECONDS;
    car.speed = 0;
    sirenOn();
  }
  function updatePolice(dt) {
    police.t += dt;
    if (police.phase !== "leave") car.speed = 0;      // waiting by the car; driving resumes when they leave
    if (police.phase === "arrive") {
      const dx = police.tx - police.x, dy = police.ty - police.y, d = Math.hypot(dx, dy);
      police.angle = Math.atan2(dy, dx);
      const step = Math.min(d, 560 * dt);
      police.x += dx / d * step || 0; police.y += dy / d * step || 0;
      if (d < 4) { police.phase = "stop"; police.t = 0; police.angle = car.angle; sfx.whistle(); sfx.skid(); }
    } else if (police.phase === "stop") {               // the commotion
      if (police.t > 2.5) { police.phase = "wait"; police.t = 0; }
    } else if (police.phase === "wait") {
      soberLeft = Math.max(0, SOBER_SECONDS - police.t);
      if (soberLeft <= 0) { police.phase = "leave"; police.t = 0; sirenOff(); }
    } else if (police.phase === "leave") {
      police.x += Math.cos(police.angle) * 520 * dt; police.y += Math.sin(police.angle) * 520 * dt;
      if (police.t > 3) police.active = false;
    }
  }
  const sobering = () => police.active && police.phase !== "leave";

  // ---------------------------------------------------------------- visiting a building
  function visit(item) {
    markVisited(item.key);
    sfx.arrive();
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
    if (e.key === "Escape") { if (barScene) barScene.t = Math.max(barScene.t, BAR_END - 1); else leave(); return; }
    if (!started || paused) return;
    if (document.activeElement !== canvas) return;
    if (GAME_KEYS.includes(e.code)) { keys[e.code] = true; e.preventDefault(); }
    if (e.code === "KeyR") resetCar();
    if (e.code === "KeyJ") jumpPark();
    if (e.code === "KeyH" && !e.repeat) sfx.horn();
    if (e.code === "KeyM" && !e.repeat) setMuted(!muted);
  });
  window.addEventListener("keyup", e => { if (GAME_KEYS.includes(e.code)) keys[e.code] = false; });
  canvas.addEventListener("blur", () => Object.keys(keys).forEach(k => { keys[k] = false; }));
  function start() {
    started = true;
    initAudio();
    startOverlay.style.display = "none";
    canvas.focus();
  }
  // J: to the road below the jump park, facing the ramp
  function jumpPark() {
    Object.assign(car, { x: RAMP.x + RAMP.w / 2, y: park.y + park.h + ROAD / 2, angle: -Math.PI / 2,
                         moveAngle: -Math.PI / 2, speed: 0, spin: 0, flying: false, height: 0 });
  }
  startOverlay.addEventListener("click", start);
  canvas.addEventListener("click", () => { if (!started) start(); initAudio(); canvas.focus(); });

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
  const fitCache = new Map();          // shortened labels, so text isn't measured again every frame
  function fitText(text, maxWidth) {
    const key = ctx.font + "|" + maxWidth + "|" + text;
    let out = fitCache.get(key);
    if (out === undefined) {
      out = text;
      if (ctx.measureText(out).width > maxWidth) {
        while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
        out += "…";
      }
      fitCache.set(key, out);
    }
    return out;
  }
  const visible = (r, v) => r.x + r.w > v.x && r.x < v.x + v.w && r.y + r.h > v.y && r.y < v.y + v.h;

  const tufts = Array.from({ length: 220 }, (_, i) => ({
    x: ((i * 977) % (WORLD.w + 2 * MARGIN)) - MARGIN, y: ((i * 613) % (WORLD.h + 2 * MARGIN)) - MARGIN, r: 18 + (i % 5) * 4,
  })).filter(t => surfaceAt(t.x, t.y) === "grass");

  // Only what is on screen is drawn
  function drawWorld(view) {
    ctx.fillStyle = "#3f7d3a";
    ctx.fillRect(view.x, view.y, view.w, view.h);
    ctx.fillStyle = "#4a8c43";
    for (const t of tufts) {
      if (t.x + t.r < view.x || t.x - t.r > view.x + view.w || t.y + t.r < view.y || t.y - t.r > view.y + view.h) continue;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    }
    // roads with lane markings
    ctx.fillStyle = "#3b3f46";
    for (const r of roads) if (visible(r, view)) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#e5c34a"; ctx.lineWidth = 4; ctx.setLineDash([28, 22]);
    ctx.beginPath();
    for (const r of roads) {
      if (!visible(r, view)) continue;
      if (r.dir === "h") { ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); }
      else { ctx.moveTo(r.x + r.w / 2, r.y + ROAD / 2); ctx.lineTo(r.x + r.w / 2, r.y + r.h - ROAD / 2); }
    }
    ctx.stroke(); ctx.setLineDash([]);

    for (const d of districts) {
      if (!visible(d, view)) continue;
      if (d.park) { drawPark(d); continue; }
      ctx.fillStyle = `hsl(${d.hue} 35% 82%)`;
      roundRect(d.x, d.y, d.w, d.h, 18); ctx.fill();
      ctx.strokeStyle = `hsl(${d.hue} 40% 55%)`; ctx.lineWidth = 6; ctx.stroke();
      drawSign(d, d.bar ? BAR_STYLES[d.bar.style].sign : `hsl(${d.hue} 45% 32%)`);
    }

    for (const p of stops) {
      if (!visible(p, view)) continue;
      ctx.fillStyle = "rgba(255,255,255,.55)";
      roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.strokeStyle = parkedAt === p ? "#2563eb" : "#ffffff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = parkedAt === p ? "#2563eb" : "#64748b";
      ctx.font = "700 24px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("P", p.x + p.w / 2, p.y + p.h / 2 + 1);
      ctx.textAlign = "left";
    }

    for (const b of buildings) {
      if (!visible({ x: b.x, y: b.y, w: b.w + 6, h: b.h + 6 }, view)) continue;
      const it = b.item;
      if (it.kind === "bar") { drawBarBuilding(b); continue; }
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
    const around = { x: view.x - 40, y: view.y - 40, w: view.w + 80, h: view.h + 80 };
    for (const p of penguins) if (inRect(p.x, p.y, around)) drawPenguin(p);
    if (police.active) drawPolice();
  }

  // The bars on the map, each in its own style
  function drawBarBuilding(b) {
    const style = b.item.style, now = performance.now() / 1000;
    ctx.fillStyle = "rgba(0,0,0,.2)"; roundRect(b.x + 6, b.y + 6, b.w, b.h, 8); ctx.fill();
    if (style === "tudor") {
      ctx.fillStyle = "#f3e7c9"; roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
      ctx.fillStyle = "#5c3714";
      ctx.fillRect(b.x, b.y, b.w, 14);
      for (let x = b.x + 30; x < b.x + b.w - 20; x += 60) { ctx.fillRect(x, b.y + 14, 6, b.h - 14); }
      ctx.fillRect(b.x, b.y + 50, b.w, 5);
    } else if (style === "neon") {
      ctx.fillStyle = "#1e1b4b"; roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
      ctx.save(); ctx.shadowColor = "#f0abfc"; ctx.shadowBlur = 14 + Math.sin(now * 6) * 6;
      ctx.strokeStyle = "#f472b6"; ctx.lineWidth = 4; roundRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10, 8); ctx.stroke();
      ctx.restore();
    } else if (style === "tiki") {
      ctx.fillStyle = "#a16207"; roundRect(b.x, b.y + 18, b.w, b.h - 18, 6); ctx.fill();
      ctx.fillStyle = "#ca8a04";
      ctx.beginPath(); ctx.moveTo(b.x - 10, b.y + 26); ctx.lineTo(b.x + b.w / 2, b.y - 8); ctx.lineTo(b.x + b.w + 10, b.y + 26); ctx.fill();
      ctx.strokeStyle = "#854d0e"; ctx.lineWidth = 2;
      for (let x = b.x; x < b.x + b.w; x += 12) { ctx.beginPath(); ctx.moveTo(x, b.y + 26); ctx.lineTo(x + 4, b.y + 32); ctx.stroke(); }
      for (const tx of [b.x - 14, b.x + b.w + 8]) {         // torches
        ctx.fillStyle = "#78350f"; ctx.fillRect(tx, b.y + 40, 5, 50);
        ctx.fillStyle = Math.sin(now * 12 + tx) > 0 ? "#f97316" : "#facc15";
        ctx.beginPath(); ctx.ellipse(tx + 2.5, b.y + 36, 5, 8, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else {                                                // irish
      ctx.fillStyle = "#166534"; roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
      ctx.fillStyle = "#14532d"; ctx.fillRect(b.x, b.y, b.w, 26);
      ctx.fillStyle = "#b91c1c"; ctx.fillRect(b.x + b.w / 2 - 14, b.y + b.h - 40, 28, 40);   // red door
    }
    // warm windows
    ctx.fillStyle = style === "neon" ? "#22d3ee" : "#fcd34d";
    for (const wx of [b.x + 18, b.x + b.w - 58]) ctx.fillRect(wx, b.y + 60, 40, 22);
    // the name
    ctx.font = "700 17px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = { tudor: "#fde68a", neon: "#f0abfc", tiki: "#fef3c7", irish: "#facc15" }[style];
    const ny = style === "tiki" ? b.y + 46 : style === "tudor" ? b.y + 32 : b.y + 16;
    if (style === "tudor") { ctx.fillStyle = "#5c3714"; ctx.fillRect(b.x + b.w / 2 - 100, ny - 12, 200, 24); ctx.fillStyle = "#fde68a"; }
    const word = { tudor: "🍺 PUB 🍺", neon: "🍸 COCKTAILS 🍸", tiki: "🌺 ALOHA 🌺", irish: "☘ SLÁINTE ☘" }[style];
    ctx.fillText(word, b.x + b.w / 2, ny);
    ctx.textAlign = "left";
  }

  function drawPolice() {
    ctx.save(); ctx.translate(police.x, police.y); ctx.rotate(police.angle);
    ctx.fillStyle = "rgba(0,0,0,.3)"; roundRect(-22 + 4, -12 + 4, 44, 24, 7); ctx.fill();
    drawCarShape(1, "#f8fafc", true);
    ctx.restore();
    if (police.phase === "stop") {                          // the commotion
      const sx = car.x, sy = car.y - 70;
      ctx.font = "700 16px system-ui, sans-serif";
      const text = "🚨 Whoa there! Sober up first!";
      const w = ctx.measureText(text).width + 20;
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1e3a8a"; ctx.lineWidth = 3;
      roundRect(sx - w / 2, sy - 20, w, 34, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1e3a8a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, sx, sy - 3);
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillText(Math.floor(police.t * 4) % 2 ? "💢" : "❗", car.x + 30, car.y - 18);
      ctx.textAlign = "left";
    }
  }

  function drawSign(d, color) {
    ctx.fillStyle = color;
    roundRect(d.x + 20, d.y + 14, d.w - 40, 44, 8); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 22px system-ui, sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(fitText(d.title, d.w - 280), d.x + 34, d.y + 36);
    ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "right";
    ctx.fillText(fitText(d.subtitle, 220), d.x + d.w - 34, d.y + 36);
    ctx.textAlign = "left";
  }

  function drawPark(d) {
    ctx.fillStyle = "#4b5563";
    roundRect(d.x, d.y, d.w, d.h, 18); ctx.fill();
    ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 6; ctx.stroke();
    drawSign(d, "#b45309");
    // run-up arrows below the ramp
    ctx.fillStyle = "rgba(255,255,255,.35)";
    for (let i = 0; i < 3; i++) {
      const ay = RAMP.y + RAMP.h + 30 + i * 45, ax = RAMP.x + RAMP.w / 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 22, ay + 24); ctx.lineTo(ax - 22, ay + 24); ctx.closePath(); ctx.fill();
    }
    // the ramp: darker at the bottom, light at the top lip, hazard stripes on the sides
    const g = ctx.createLinearGradient(0, RAMP.y + RAMP.h, 0, RAMP.y);
    g.addColorStop(0, "#9ca3af"); g.addColorStop(1, "#f3f4f6");
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(RAMP.x + 10, RAMP.y - 14, RAMP.w, RAMP.h);   // shadow: it stands up
    ctx.fillStyle = g; ctx.fillRect(RAMP.x, RAMP.y, RAMP.w, RAMP.h);
    ctx.save(); ctx.beginPath(); ctx.rect(RAMP.x, RAMP.y, RAMP.w, RAMP.h); ctx.clip();
    for (let i = -1; i < 12; i++) {
      ctx.fillStyle = i % 2 ? "#facc15" : "#111827";
      ctx.fillRect(RAMP.x, RAMP.y + i * 16, 14, 16);
      ctx.fillRect(RAMP.x + RAMP.w - 14, RAMP.y + i * 16, 14, 16);
    }
    ctx.restore();
    ctx.fillStyle = "#dc2626"; ctx.fillRect(RAMP.x, RAMP.y, RAMP.w, 8);            // the lip
    ctx.fillStyle = "#111827"; ctx.font = "700 15px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("JUMP", RAMP.x + RAMP.w / 2, RAMP.y + RAMP.h / 2);
    ctx.textAlign = "left";
  }

  function drawPenguin(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.state === "tumble" ? p.rot : p.dir + Math.PI / 2 + Math.sin(p.t * 12) * 0.18);  // waddle
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(3, 4, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
    const step = Math.sin(p.t * 12) * 3;
    ctx.fillStyle = "#f97316";                                       // feet
    ctx.beginPath(); ctx.ellipse(-5, 11 + step, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, 11 - step, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.ellipse(0, 0, 10, 13, 0, 0, Math.PI * 2); ctx.fill();   // body
    ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.ellipse(0, 2, 6.5, 9, 0, 0, Math.PI * 2); ctx.fill();   // belly
    ctx.fillStyle = "#111827";                                       // flippers
    ctx.beginPath(); ctx.ellipse(-10, 1, 3, 7, 0.3 + Math.sin(p.t * 12) * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10, 1, 3, 7, -0.3 - Math.sin(p.t * 12) * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";                                          // eyes + beak
    ctx.beginPath(); ctx.arc(-3, -7, 2, 0, Math.PI * 2); ctx.arc(3, -7, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.arc(-3, -7, 1, 0, Math.PI * 2); ctx.arc(3, -7, 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f97316"; ctx.beginPath(); ctx.moveTo(-2.5, -4); ctx.lineTo(2.5, -4); ctx.lineTo(0, 0); ctx.fill();
    ctx.restore();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (p.state === "tumble") {
      ctx.font = "16px system-ui, sans-serif"; ctx.fillText("💫", p.x, p.y - 22);
    } else if (Math.hypot(car.x - p.x, car.y - p.y) < 320 && Math.abs(car.speed) > 150) {
      ctx.fillStyle = "#fde047"; ctx.font = "700 22px system-ui, sans-serif"; ctx.fillText("!", p.x, p.y - 24);
    }
    ctx.textAlign = "left";
  }

  function drawCarShape(scale, body = "#dc2626", isPolice = false) {
    ctx.scale(scale, scale);
    ctx.fillStyle = "#111827";                              // wheels
    [[-13, -14], [9, -14], [-13, 10], [9, 10]].forEach(([x, y]) => ctx.fillRect(x, y, 10, 4));
    ctx.fillStyle = body; roundRect(-car.l / 2, -car.w / 2, car.l, car.w, 7); ctx.fill();
    if (isPolice) {                                         // blue stripe and a flashing light bar
      ctx.fillStyle = "#1e3a8a"; ctx.fillRect(-car.l / 2 + 4, -2, car.l - 8, 4);
      const flash = Math.floor(performance.now() / 160) % 2;
      ctx.fillStyle = flash ? "#ef4444" : "#3b82f6"; ctx.fillRect(-6, -car.w / 2 + 3, 5, car.w - 6);
      ctx.fillStyle = flash ? "#3b82f6" : "#ef4444"; ctx.fillRect(-1, -car.w / 2 + 3, 5, car.w - 6);
    }
    ctx.fillStyle = "#bfdbfe"; roundRect(2, -car.w / 2 + 4, 11, car.w - 8, 3); ctx.fill();    // windscreen
    ctx.fillStyle = "#93c5fd"; roundRect(-16, -car.w / 2 + 5, 8, car.w - 10, 3); ctx.fill();  // rear window
    ctx.fillStyle = "#fde68a";                              // headlights
    ctx.fillRect(car.l / 2 - 3, -car.w / 2 + 3, 3, 5); ctx.fillRect(car.l / 2 - 3, car.w / 2 - 8, 3, 5);
  }
  // On the ground the car is drawn in the city; in the air only its shadow is (the car itself flies above the sky)
  function drawCarOnGround() {
    ctx.save();
    ctx.translate(car.x + 4 + car.height * 70, car.y + 4 + car.height * 90); ctx.rotate(car.angle);
    ctx.fillStyle = `rgba(0,0,0,${0.3 - car.height * 0.15})`;
    const s = 1 - car.height * 0.3;
    roundRect(-car.l / 2 * s, -car.w / 2 * s, car.l * s, car.w * s, 7); ctx.fill();
    ctx.restore();
    if (car.flying) return;
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle); drawCarShape(1); ctx.restore();
  }

  function drawSky(view, zoom) {
    const h = car.height;
    // haze and clouds over the city
    ctx.fillStyle = `rgba(147,197,253,${0.55 * h})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = `rgba(255,255,255,${0.7 * h})`;
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 263 + car.flightT * 40 * (i % 3 + 1)) % (viewW + 300)) - 150, cy = 60 + (i * 137) % Math.max(1, viewH - 120);
      ctx.beginPath(); ctx.ellipse(cx, cy, 70, 26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 45, cy - 12, 50, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 40, cy - 8, 44, 20, 0, 0, Math.PI * 2); ctx.fill();
    }
    // the prefix birds
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineCap = "round";
    ctx.globalAlpha = Math.min(1, h * 1.6);
    for (const b of birds) {
      const bx = b.x * viewW, by = b.y * viewH + Math.sin(b.phase * 0.3) * 12, s = b.size;
      const wing = Math.sin(b.phase) * 9 * s;
      ctx.strokeStyle = `hsl(${b.hue} 55% 30%)`; ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(bx - 16 * s, by - wing); ctx.quadraticCurveTo(bx - 7 * s, by - 4 * s - wing * 0.3, bx, by);
      ctx.quadraticCurveTo(bx + 7 * s, by - 4 * s - wing * 0.3, bx + 16 * s, by - wing);
      ctx.stroke();
      ctx.font = `700 ${Math.round(12 * s)}px ui-monospace, monospace`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(15,23,42,.7)"; ctx.strokeText(b.text, bx, by + 5 * s);
      ctx.fillStyle = `hsl(${b.hue} 90% 88%)`; ctx.fillText(b.text, bx, by + 5 * s);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.lineCap = "butt";
    // the car, high up and big
    const sx = (car.x - view.cx) * zoom + viewW / 2, sy = (car.y - view.cy) * zoom + viewH / 2;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(car.angle); drawCarShape(zoom * (1 + h * 1.4)); ctx.restore();
  }

  function drawSoberCountdown() {
    const w = 380, h = 96, x = viewW / 2 - w / 2, y = viewH / 2 - 150;
    ctx.fillStyle = "rgba(15,23,42,.85)"; roundRect(x, y, w, h, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(`😵 Sobering up... ${Math.ceil(soberLeft)}`, viewW / 2, y + 34);
    ctx.fillStyle = "#334155"; roundRect(x + 30, y + 62, w - 60, 12, 6); ctx.fill();
    ctx.fillStyle = "#22c55e"; roundRect(x + 30, y + 62, (w - 60) * (1 - soberLeft / SOBER_SECONDS), 12, 6); ctx.fill();
    ctx.textAlign = "left";
  }

  function drawMinimap() {
    const mw = 190, mh = Math.max(60, Math.min(190, mw * WORLD.h / WORLD.w));
    const s = Math.min(mw / WORLD.w, mh / WORLD.h);
    const x0 = viewW - mw - 12, y0 = viewH - mh - 12;
    ctx.fillStyle = "rgba(15,23,42,.75)"; roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 6); ctx.fill();
    ctx.fillStyle = "#3f7d3a"; ctx.fillRect(x0, y0, WORLD.w * s, WORLD.h * s);
    ctx.fillStyle = "#3b3f46";
    for (const r of roads) ctx.fillRect(x0 + r.x * s, y0 + r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
    for (const d of districts) {
      ctx.fillStyle = d.park ? "#f59e0b" : d.bar ? "#ec4899" : `hsl(${d.hue} 45% 60%)`;
      ctx.fillRect(x0 + d.x * s, y0 + d.y * s, d.w * s, d.h * s);
    }
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(x0 + Math.max(0, Math.min(WORLD.w, car.x)) * s, y0 + Math.max(0, Math.min(WORLD.h, car.y)) * s, 4, 0, Math.PI * 2); ctx.fill();
  }

  const totalStops = stops.filter(p => p.item.kind !== "bar").length;
  function drawHud() {
    const d = districtAt(car.x, car.y), surface = surfaceAt(car.x, car.y);
    const where = sobering() ? "🚓 Sobering up..." : car.flying ? "🛫 In the air!" : car.spin > 0 ? "🌀 Spinning out!" : d ? d.title
      : surface === "road" ? "On the road" : "Off-road 🌾";
    const seen = stops.filter(p => p.item.kind !== "bar" && visited.has(p.item.key)).length;
    const parked = parkedAt ? `<div class="mt-1">🅿️ ${escapeHtml(parkedAt.item.name)}${Math.abs(car.speed) < 12 ? "" : " - stop here to visit"}</div>` : "";
    const capped = DATA.total_devices > DATA.devices.length
      ? `<div class="rt-muted">${DATA.devices.length} of ${DATA.total_devices} devices placed</div>` : "";
    hud.innerHTML = `<div class="rt-big">${Math.round(Math.abs(car.speed) / 5)} km/h</div>
      <div>${escapeHtml(where)}</div>${parked}
      <div class="rt-muted mt-1">🚩 Visited ${seen} of ${totalStops} · ${muted ? "🔇 sound off" : "🔊 sound on"} (M)</div>
      <div class="rt-muted">🐧 ${stats.safe} let across · ${stats.bumped} bumped · 🛫 ${plural(stats.jumps, "jump")} · 🍹 ${plural(stats.drinks, "drink")}</div>${capped}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------------------------------------------------------------- main loop
  let camX = car.x, camY = car.y, zoom = 1, last = performance.now(), hudTimer = 0;
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (barScene) updateBar(dt);
    if (started && !paused) update(dt);
    engineSound(started && !paused && (keys.ArrowUp || keys.KeyW || keys.ArrowDown || keys.KeyS));
    // camera eases after the car, looks a little ahead, and pulls far back during a jump
    const look = car.flying ? 0.6 : 0.35;
    const lookX = car.x + Math.cos(car.moveAngle) * car.speed * look, lookY = car.y + Math.sin(car.moveAngle) * car.speed * look;
    camX += (lookX - camX) * Math.min(1, dt * 4); camY += (lookY - camY) * Math.min(1, dt * 4);
    const targetZoom = car.flying ? Math.max(0.22, 1 - car.height * 0.8) : Math.max(0.55, 1 - Math.abs(car.speed) / 1400);
    zoom += (targetZoom - zoom) * Math.min(1, dt * 3);

    const view = { x: camX - viewW / 2 / zoom, y: camY - viewH / 2 / zoom, w: viewW / zoom, h: viewH / zoom, cx: camX, cy: camY };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#3f7d3a"; ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    if (sobering()) ctx.rotate(Math.sin(now / 400) * 0.05 * (0.3 + soberLeft / SOBER_SECONDS));   // the world sways a bit
    ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
    drawWorld(view);
    drawCarOnGround();
    ctx.restore();
    if (car.flying) drawSky(view, zoom);
    if (police.active && police.phase === "wait") drawSoberCountdown();
    drawMinimap();
    hudTimer -= dt;
    if (hudTimer <= 0) { drawHud(); hudTimer = 0.1; }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  // For automated tests: the state, and a way to put the car somewhere
  window.netboxRoadTrip = {
    car, stops, districts, roads, keys, sfx, penguins, stats, ramp: RAMP, world: WORLD,
    isMuted: () => muted, hasAudio: () => !!audio, birds: () => birds,
    teleport(x, y, angle) { Object.assign(car, { x, y, angle: angle ?? car.angle, moveAngle: angle ?? car.angle, speed: 0 }); },
    spawnPenguin, jumpPark, start, enterBar, police, bars,
    barScene: () => barScene, sobering, soberLeft: () => soberLeft,
  };
})();
{% endverbatim %}
