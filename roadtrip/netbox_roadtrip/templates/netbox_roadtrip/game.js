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

  // Each district is as big as its own buildings need: wider rather than endlessly tall
  for (const dist of districts) {
    const slots = dist.items.length + (dist.hall ? 2 : 0);
    dist.cols = dist.park ? 4 : Math.max(4, Math.ceil(Math.sqrt(slots * 1.3)));
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
    dist.items.forEach(item => place(item, 1));
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
  };

  // ---------------------------------------------------------------- the car
  const START = { x: ROAD / 2, y: ROAD / 2, angle: Math.PI / 2 };   // top-left crossing, facing down
  const car = { x: START.x, y: START.y, angle: START.angle, moveAngle: START.angle, speed: 0, w: 24, l: 44,
                spin: 0, spinRate: 0, flying: false, flightT: 0, flightDur: 0, height: 0 };
  const keys = {};
  const stats = { safe: 0, bumped: 0, jumps: 0 };
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
      if (parkTimer > 0.6) { lastVisit = spot; visit(spot.item); }
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
    if (!force && (!started || paused || car.flying || penguins.length >= 3 || Math.abs(car.speed) < 100)) return null;
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
    if (e.key === "Escape") { leave(); return; }
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
      drawSign(d, `hsl(${d.hue} 45% 32%)`);
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

  function drawCarShape(scale) {
    ctx.scale(scale, scale);
    ctx.fillStyle = "#111827";                              // wheels
    [[-13, -14], [9, -14], [-13, 10], [9, 10]].forEach(([x, y]) => ctx.fillRect(x, y, 10, 4));
    ctx.fillStyle = "#dc2626"; roundRect(-car.l / 2, -car.w / 2, car.l, car.w, 7); ctx.fill();
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

  function drawMinimap() {
    const mw = 190, mh = Math.max(60, Math.min(190, mw * WORLD.h / WORLD.w));
    const s = Math.min(mw / WORLD.w, mh / WORLD.h);
    const x0 = viewW - mw - 12, y0 = viewH - mh - 12;
    ctx.fillStyle = "rgba(15,23,42,.75)"; roundRect(x0 - 6, y0 - 6, mw + 12, mh + 12, 6); ctx.fill();
    ctx.fillStyle = "#3f7d3a"; ctx.fillRect(x0, y0, WORLD.w * s, WORLD.h * s);
    ctx.fillStyle = "#3b3f46";
    for (const r of roads) ctx.fillRect(x0 + r.x * s, y0 + r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
    for (const d of districts) {
      ctx.fillStyle = d.park ? "#f59e0b" : `hsl(${d.hue} 45% 60%)`;
      ctx.fillRect(x0 + d.x * s, y0 + d.y * s, d.w * s, d.h * s);
    }
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(x0 + Math.max(0, Math.min(WORLD.w, car.x)) * s, y0 + Math.max(0, Math.min(WORLD.h, car.y)) * s, 4, 0, Math.PI * 2); ctx.fill();
  }

  const totalStops = stops.length;
  function drawHud() {
    const d = districtAt(car.x, car.y), surface = surfaceAt(car.x, car.y);
    const where = car.flying ? "🛫 In the air!" : car.spin > 0 ? "🌀 Spinning out!" : d ? d.title
      : surface === "road" ? "On the road" : "Off-road 🌾";
    const seen = stops.filter(p => visited.has(p.item.key)).length;
    const parked = parkedAt ? `<div class="mt-1">🅿️ ${escapeHtml(parkedAt.item.name)}${Math.abs(car.speed) < 12 ? "" : " - stop here to visit"}</div>` : "";
    const capped = DATA.total_devices > DATA.devices.length
      ? `<div class="rt-muted">${DATA.devices.length} of ${DATA.total_devices} devices placed</div>` : "";
    hud.innerHTML = `<div class="rt-big">${Math.round(Math.abs(car.speed) / 5)} km/h</div>
      <div>${escapeHtml(where)}</div>${parked}
      <div class="rt-muted mt-1">🚩 Visited ${seen} of ${totalStops} · ${muted ? "🔇 sound off" : "🔊 sound on"} (M)</div>
      <div class="rt-muted">🐧 ${stats.safe} let across · ${stats.bumped} bumped · 🛫 ${plural(stats.jumps, "jump")}</div>${capped}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------------------------------------------------------------- main loop
  let camX = car.x, camY = car.y, zoom = 1, last = performance.now(), hudTimer = 0;
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
    ctx.translate(viewW / 2, viewH / 2); ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
    drawWorld(view);
    drawCarOnGround();
    ctx.restore();
    if (car.flying) drawSky(view, zoom);
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
    spawnPenguin, jumpPark, start,
  };
})();
{% endverbatim %}
