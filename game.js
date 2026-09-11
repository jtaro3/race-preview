const canvas = document.querySelector('#game'),
  ctx = canvas.getContext('2d');
const $ = s => document.querySelector(s),
  keys = {};
let state = 'menu',
  startAt = 0,
  last = performance.now(),
  countValue = 3,
  sound = true;
const touchInput = {
  up: false,
  down: false,
  left: false,
  right: false
};
let touchPointer = null,
  touchOrigin = null;
const touchPad = $('#touchPad');
const gameFrame = $('.game-frame');

// Course data lives in world space. Changing these points reshapes both views.
const trackPoints = [{
  x: -520,
  y: -650,
  width: 255
}, {
  x: -80,
  y: -735,
  width: 260
}, {
  x: 420,
  y: -720,
  width: 260
}, {
  x: 760,
  y: -560,
  width: 250
}, {
  x: 900,
  y: -230,
  width: 245
}, {
  x: 855,
  y: 120,
  width: 250
}, {
  x: 680,
  y: 390,
  width: 255
}, {
  x: 410,
  y: 540,
  width: 265
}, {
  x: 135,
  y: 485,
  width: 260
}, {
  x: -95,
  y: 325,
  width: 250
}, {
  x: -440,
  y: 350,
  width: 265
}, {
  x: -735,
  y: 205,
  width: 255
}, {
  x: -865,
  y: -80,
  width: 250
}, {
  x: -770,
  y: -390,
  width: 250
}];
const ROAD_LIMIT = .8,
  TRACK_SAMPLES = 160,
  GRASS_CRAWL_SPEED = 44,
  PLAYER_RADIUS = 26;
const wrap = n => ((n % 1) + 1) % 1,
  pointAt = i => trackPoints[(i + trackPoints.length) % trackPoints.length];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function catmull(a, b, c, d, t) {
  const t2 = t * t,
    t3 = t2 * t;
  return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
}

function trackPosition(t) {
  const n = trackPoints.length,
    u = wrap(t) * n,
    i = Math.floor(u),
    f = u - i,
    a = pointAt(i - 1),
    b = pointAt(i),
    c = pointAt(i + 1),
    d = pointAt(i + 2);
  return {
    x: catmull(a.x, b.x, c.x, d.x, f),
    y: catmull(a.y, b.y, c.y, d.y, f),
    width: (b.width + (c.width - b.width) * f) * 1.35
  }
}

function sampleTrack(t) {
  const p = trackPosition(t),
    a = trackPosition(t - .0008),
    b = trackPosition(t + .0008),
    dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy) || 1;
  return {
    ...p,
    t: wrap(t),
    dirX: dx / len,
    dirY: dy / len,
    rightX: -dy / len,
    rightY: dx / len,
    angle: Math.atan2(dx, -dy)
  }
}
const trackSamples = Array.from({
  length: TRACK_SAMPLES
}, (_, i) => sampleTrack(i / TRACK_SAMPLES));

function nearestTrack(x, y) {
  let best;
  for (let i = 0; i < trackSamples.length; i++) {
    const a = trackSamples[i],
      b = trackSamples[(i + 1) % trackSamples.length],
      vx = b.x - a.x,
      vy = b.y - a.y,
      len2 = vx * vx + vy * vy,
      u = clamp(((x - a.x) * vx + (y - a.y) * vy) / (len2 || 1), 0, 1),
      px = a.x + vx * u,
      py = a.y + vy * u,
      dx = x - px,
      dy = y - py,
      d2 = dx * dx + dy * dy;
    if (!best || d2 < best.d2) {
      const len = Math.sqrt(len2) || 1,
        dirX = vx / len,
        dirY = vy / len,
        rightX = -dirY,
        rightY = dirX,
        width = a.width + (b.width - a.width) * u,
        p = {
          x: px,
          y: py,
          width,
          dirX,
          dirY,
          rightX,
          rightY,
          angle: Math.atan2(dirX, -dirY),
          t: wrap((i + u) / trackSamples.length)
        };
      best = {
        p,
        d2,
        lateral: dx * rightX + dy * rightY
      }
    }
  }
  const distance = Math.sqrt(best.d2);
  return {
    ...best,
    distance,
    onRoad: distance <= best.p.width * ROAD_LIMIT
  }
}

// Simulation state is deliberately separate from screen and camera state.
const player = {
  x: 0,
  y: 0,
  angle: 0,
  speed: 0,
  maxSpeed: 205,
  reverseSpeed: 68,
  acceleration: 112,
  brakePower: 240,
  friction: 40,
  turnSpeed: 2.9,
  steer: 0,
  lap: 1,
  trackT: .018,
  lastTrackT: .018,
  onRoad: true,
  boost: 0,
  best: null,
  lapStart: 0,
  hitFlash: 0,
  boundaryFlash: 0,
  collisionCooldown: 0
};
const camera = {
  x: 0,
  y: 0,
  angle: 0
};

function snapCamera() {
  camera.x = player.x;
  camera.y = player.y;
  camera.angle = player.angle
}

function setPlayerStart() {
  const p = sampleTrack(.018);
  Object.assign(player, {
    x: p.x,
    y: p.y,
    angle: p.angle,
    speed: 0,
    steer: 0,
    lap: 1,
    trackT: p.t,
    lastTrackT: p.t,
    onRoad: true,
    boost: 0,
    best: null,
    lapStart: 0,
    hitFlash: 0,
    boundaryFlash: 0,
    collisionCooldown: 0
  });
  snapCamera()
}
setPlayerStart();

// Objects remain world-coordinate records; image frames can replace the placeholder karts later.
const spriteCatalog = visualDesign.sprites;
const boostPads = [.17, .47, .76].map((t, i) => ({
  ...sampleTrack(t),
  t,
  radius: 78,
  armed: true,
  color: i === 1 ? '#ff8b35' : '#ffe45c'
}));
const obstacles = [.29, .58, .88].map((t, i) => {
  const p = sampleTrack(t),
    side = i % 2 ? -1.22 : 1.22;
  return {
    x: p.x + p.rightX * p.width * side,
    y: p.y + p.rightY * p.width * side,
    radius: 34,
    color: i % 2 ? '#ff2d8d' : '#21e6ff'
  }
});
const rivals = Array.from({
  length: 5
}, (_, i) => ({
  t: .05 + i * .105,
  lap: 1,
  speed: 122 + i * 7,
  x: 0,
  y: 0,
  angle: 0,
  color: ['#ff2d8d', '#ffd83d', '#21e6ff', '#8e61ff', '#ff713d'][i]
}));
const scenery = Array.from({
  length: 42
}, (_, i) => {
  const p = sampleTrack(i / 42 + .013),
    side = i % 2 ? 1 : -1,
    offset = p.width * (1.32 + (i % 4) * .18);
  return {
    x: p.x + p.rightX * offset * side,
    y: p.y + p.rightY * offset * side,
    size: 45 + (i % 3) * 19,
    color: side > 0 ? '#21e6ff' : '#ff2d8d'
  }
});
const groundDecor = [];
for (let gy = -6; gy <= 5; gy++)
  for (let gx = -6; gx <= 5; gx++) {
    const hash = Math.abs(gx * 37 + gy * 61),
      x = gx * visualDesign.ground.spacing + (hash % 5) * 27,
      y = gy * visualDesign.ground.spacing + (hash % 7) * 19,
      near = nearestTrack(x, y);
    if (near.distance > near.p.width * (ROAD_LIMIT + .14)) groundDecor.push({
      x,
      y,
      type: hash % 6 === 0 ? 'flower' : 'grass'
    })
  }

function syncRival(r) {
  const p = sampleTrack(r.t);
  r.x = p.x;
  r.y = p.y;
  r.angle = p.angle
}
rivals.forEach(syncRival);

function resize() {
  const d = Math.min(devicePixelRatio, 2),
    r = canvas.getBoundingClientRect();
  canvas.width = r.width * d;
  canvas.height = r.height * d;
  ctx.setTransform(d, 0, 0, d, 0, 0)
}
addEventListener('resize', resize);
resize();
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
document.querySelectorAll('[data-key]').forEach(b => {
  const k = b.dataset.key.toLowerCase(),
    release = () => keys[k] = false;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    keys[k] = true;
    b.setPointerCapture(e.pointerId)
  });
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release)
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Object.keys(keys).forEach(k => keys[k] = false);
    resetTouchPad()
  }
});

// Mobile browsers can interpret a driving swipe as page scroll or pinch zoom.
// Lock those gestures only while a race/countdown is active, not in the editor.
function setGameplayLock(active) {
  document.documentElement.classList.toggle('gameplay-active', active);
  document.body.classList.toggle('gameplay-active', active)
}

function blockGameplayGesture(event) {
  if (document.body.classList.contains('gameplay-active')) event.preventDefault()
}

['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(type => {
  gameFrame.addEventListener(type, blockGameplayGesture, {
    passive: false
  })
});
['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
  document.addEventListener(type, blockGameplayGesture, {
    passive: false
  })
});
gameFrame.addEventListener('wheel', event => {
  if (document.body.classList.contains('gameplay-active') && event.ctrlKey) event.preventDefault()
}, {
  passive: false
});
$('#soundBtn').onclick = () => {
  sound = !sound;
  $('#soundBtn').textContent = `SOUND ${sound?'ON':'OFF'}`
};
$('#startBtn').onclick = startRace;
$('#restartBtn').onclick = startRace;
$('#restartRaceBtn').onclick = startRace;

function beep(freq, d = .08) {
  if (!sound) return;
  const a = beep.a || (beep.a = new AudioContext),
    o = a.createOscillator(),
    g = a.createGain();
  o.frequency.value = freq;
  o.type = 'square';
  g.gain.setValueAtTime(.04, a.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, a.currentTime + d);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + d)
}

function startRace() {
  resetTouchPad();
  setGameplayLock(true);
  setPlayerStart();
  boostPads.forEach(b => b.armed = true);
  rivals.forEach((r, i) => {
    r.t = wrap(.06 + i * .105);
    r.lap = 1;
    syncRival(r)
  });
  $('#startScreen').classList.remove('show');
  $('#finishScreen').classList.remove('show');
  state = 'countdown';
  countValue = 3;
  startAt = performance.now();
  showCount('3');
  beep(220)
}

function showCount(t) {
  const el = $('#countdown');
  el.textContent = t;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop')
}

function format(ms) {
  const m = Math.floor(ms / 60000),
    s = Math.floor(ms / 1000) % 60,
    x = Math.floor(ms % 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`
}

function updatePlayer(dt) {
  const up = keys.arrowup || keys.w || touchInput.up,
    down = keys.arrowdown || keys.s || touchInput.down,
    left = keys.arrowleft || keys.a || touchInput.left,
    right = keys.arrowright || keys.d;
  const wasOnRoad = player.onRoad,
    before = nearestTrack(player.x, player.y);
  player.onRoad = before.onRoad;
  if (up) player.speed += player.acceleration * dt;
  else if (player.speed > 0) player.speed -= player.friction * dt;
  else if (player.speed < 0) player.speed += player.friction * dt;
  if (down) {
    if (player.speed > 0) player.speed -= player.brakePower * dt;
    else player.speed -= player.acceleration * .72 * dt
  }
  if (!player.onRoad && player.speed > GRASS_CRAWL_SPEED) player.speed = Math.max(GRASS_CRAWL_SPEED, player.speed - 260 * dt);
  const surfaceMax = player.onRoad ? player.maxSpeed : GRASS_CRAWL_SPEED,
    boostMax = player.onRoad && player.boost > 0 ? player.maxSpeed * 1.28 : surfaceMax;
  if (player.speed > boostMax) player.speed = Math.max(boostMax, player.speed - player.brakePower * dt);
  if (player.speed < -player.reverseSpeed) player.speed = -player.reverseSpeed;
  if (Math.abs(player.speed) < 2 && !up && !down) player.speed = 0;
  const steerInput = (right ? 1 : 0) - (left ? 1 : 0),
    speedRatio = Math.min(1, Math.abs(player.speed) / player.maxSpeed);
  // High speed steering is intentionally less sharp than low speed steering.
  const turnScale = .96 - speedRatio * .48;
  player.steer += (steerInput - player.steer) * Math.min(1, dt * 11);
  player.angle += steerInput * player.turnSpeed * turnScale * dt * (player.speed >= 0 ? 1 : -1);
  player.x += Math.sin(player.angle) * player.speed * dt;
  player.y -= Math.cos(player.angle) * player.speed * dt;
  player.collisionCooldown = Math.max(0, player.collisionCooldown - dt);
  if (!player.collisionCooldown)
    for (const o of obstacles) {
      const dx = player.x - o.x,
        dy = player.y - o.y,
        d = Math.hypot(dx, dy);
      if (d < o.radius + 26) {
        const nx = d ? dx / d : -Math.sin(player.angle),
          ny = d ? dy / d : Math.cos(player.angle);
        player.x = o.x + nx * (o.radius + 27);
        player.y = o.y + ny * (o.radius + 27);
        player.speed = -Math.max(24, Math.min(52, Math.abs(player.speed) * .22));
        player.collisionCooldown = .22;
        player.hitFlash = 1;
        beep(105, .09);
        break
      }
    }
  let near = nearestTrack(player.x, player.y),
    wallLimit = Math.max(40, near.p.width * ROAD_LIMIT - PLAYER_RADIUS);
  if (near.distance > wallLimit) {
    const dx = player.x - near.p.x,
      dy = player.y - near.p.y,
      d = near.distance || 1,
      inset = wallLimit - 4;
    player.x = near.p.x + dx / d * inset;
    player.y = near.p.y + dy / d * inset;
    player.speed *= .32;
    player.boundaryFlash = 1;
    player.hitFlash = Math.max(player.hitFlash, .45);
    near = nearestTrack(player.x, player.y);
    if (!player.collisionCooldown) {
      player.collisionCooldown = .16;
      beep(135, .06)
    }
  }
  player.onRoad = near.onRoad;
  if (!wasOnRoad && player.onRoad && up) player.speed = Math.max(player.speed, 82);
  player.trackT = near.p.t;
}

function updateWorld(dt, now) {
  boostPads.forEach(b => {
    const d = Math.hypot(player.x - b.x, player.y - b.y);
    if (d > b.radius * 1.7) b.armed = true;
    if (d < b.radius && b.armed) {
      b.armed = false;
      player.boost = 1.5;
      player.speed = Math.max(player.speed, player.maxSpeed * 1.14);
      beep(880, .12)
    }
  });
  player.boost = Math.max(0, player.boost - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt * 2.8);
  player.boundaryFlash = Math.max(0, player.boundaryFlash - dt * 2.2);
  if (player.trackT < .12 && player.lastTrackT > .88 && player.speed > 20 && player.onRoad) {
    const lapTime = now - player.lapStart;
    player.best = player.best ? Math.min(player.best, lapTime) : lapTime;
    player.lapStart = now;
    if (player.lap >= 3) {
      finish(now);
      return
    }
    player.lap++
  }
  player.lastTrackT = player.trackT;
  rivals.forEach((r, i) => {
    const old = r.t;
    r.speed = 132 + i * 4 + Math.sin(now / 800 + i) * 7;
    r.t = wrap(r.t + r.speed * dt / 6500);
    if (r.t < .12 && old > .88) r.lap++;
    syncRival(r)
  });
}

function updateCamera(dt) {
  camera.x = player.x;
  camera.y = player.y;
  const angleFollow = Math.min(1, dt * 8);
  camera.angle += angleDiff(player.angle, camera.angle) * angleFollow
}

function updateHud(now) {
  const meScore = (player.lap - 1) + player.trackT,
    ahead = rivals.filter(r => (r.lap - 1) + r.t > meScore).length;
  $('#position').textContent = Math.min(6, ahead + 1);
  $('#lap').textContent = player.lap;
  $('#speed').textContent = String(Math.round(Math.abs(player.speed))).padStart(3, '0');
  $('#raceTime').textContent = format(now - startAt);
  $('#bestLap').textContent = player.best ? format(player.best) : '--:--.---'
}

function update(dt, now) {
  if (state === 'countdown') {
    const elapsed = (now - startAt) / 1000,
      newCount = 3 - Math.floor(elapsed);
    if (newCount !== countValue && newCount > 0) {
      countValue = newCount;
      showCount(String(newCount));
      beep(260 + (3 - newCount) * 110)
    }
    if (elapsed >= 3) {
      showCount('GO!');
      beep(660, .16);
      state = 'race';
      startAt = now;
      player.lapStart = now
    }
    updateCamera(dt);
    return
  }
  if (state !== 'race') return;
  updatePlayer(dt);
  updateWorld(dt, now);
  updateCamera(dt);
  updateHud(now)
}

function finish(now) {
  state = 'finish';
  setGameplayLock(false);
  const pos = $('#position').textContent,
    suffix = pos === '1' ? 'ST' : pos === '2' ? 'ND' : pos === '3' ? 'RD' : 'TH';
  $('#finishPlace').textContent = pos + suffix;
  $('#finalTime').textContent = format(now - startAt);
  setTimeout(() => $('#finishScreen').classList.add('show'), 400);
  beep(520, .25)
}

function canvasPoint(x, y) {
  const r = canvas.getBoundingClientRect();
  return {
    x: x - r.left,
    y: y - r.top
  }
}

function resetTouchPad() {
  touchPointer = null;
  touchOrigin = null;
  Object.keys(touchInput).forEach(k => touchInput[k] = false);
  touchPad.classList.remove('show');
  touchPad.style.setProperty('--stick-x', '0px');
  touchPad.style.setProperty('--stick-y', '0px')
}

function updateTouchDrive(x, y) {
  if (!touchOrigin) return;
  let dx = x - touchOrigin.x,
    dy = y - touchOrigin.y,
    len = Math.hypot(dx, dy);
  if (len > 52) {
    dx = dx / len * 52;
    dy = dy / len * 52
  }
  touchInput.left = dx < -10;
  touchInput.right = dx > 10;
  touchInput.up = dy < -10;
  touchInput.down = dy > 10;
  touchPad.style.setProperty('--stick-x', `${dx}px`);
  touchPad.style.setProperty('--stick-y', `${dy}px`)
}

function beginTouch(id, x, y) {
  if (touchPointer !== null || (state !== 'race' && state !== 'countdown')) return false;
  touchPointer = id;
  touchOrigin = {
    x,
    y
  };
  touchPad.style.left = `${x}px`;
  touchPad.style.top = `${y}px`;
  touchPad.classList.add('show');
  updateTouchDrive(x, y);
  return true
}

function moveTouch(id, x, y) {
  if (touchPointer !== id) return false;
  updateTouchDrive(x, y);
  return true
}

function endTouch(id) {
  if (touchPointer === id) resetTouchPad()
}
if (window.PointerEvent) {
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const p = canvasPoint(e.clientX, e.clientY);
    if (beginTouch(e.pointerId, p.x, p.y)) {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId)
    }
  });
  canvas.addEventListener('pointermove', e => {
    const p = canvasPoint(e.clientX, e.clientY);
    if (moveTouch(e.pointerId, p.x, p.y)) e.preventDefault()
  });
  canvas.addEventListener('pointerup', e => endTouch(e.pointerId));
  canvas.addEventListener('pointercancel', e => endTouch(e.pointerId));
  canvas.addEventListener('lostpointercapture', e => endTouch(e.pointerId))
}

// Converts world points to the upper-screen pseudo-3D camera. The player stays fixed on screen.
function cameraPoint(x, y, w, raceH) {
  const dx = x - camera.x,
    dy = y - camera.y,
    s = Math.sin(camera.angle),
    c = Math.cos(camera.angle),
    depth = dx * s - dy * c,
    side = dx * c + dy * s;
  if (depth < 68 || depth > 2300) return null;
  const scale = (320 * Math.max(.72, raceH / 500)) / depth,
    horizon = raceH * .43;
  return {
    x: w / 2 + side * scale,
    y: horizon + 160 * scale,
    depth,
    scale
  }
}

function roadQuad(a, b, w, raceH) {
  const ar = {
      x: a.x + a.rightX * a.width,
      y: a.y + a.rightY * a.width
    },
    al = {
      x: a.x - a.rightX * a.width,
      y: a.y - a.rightY * a.width
    },
    br = {
      x: b.x + b.rightX * b.width,
      y: b.y + b.rightY * b.width
    },
    bl = {
      x: b.x - b.rightX * b.width,
      y: b.y - b.rightY * b.width
    },
    q = [cameraPoint(ar.x, ar.y, w, raceH), cameraPoint(al.x, al.y, w, raceH), cameraPoint(br.x, br.y, w, raceH), cameraPoint(bl.x, bl.y, w, raceH)];
  return q.some(v => !v) ? null : q
}

function polygon(points, color) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill()
}

function renderGround(w, raceH) {
  const horizon = Math.floor(raceH * .43),
    bottom = raceH + 2,
    bands = 32,
    phase = Math.floor((camera.x * Math.cos(camera.angle) + camera.y * Math.sin(camera.angle)) / 90);
  for (let i = 0; i < bands; i++) {
    const t = i / bands,
      next = (i + 1) / bands,
      y = horizon + (bottom - horizon) * t * t,
      y2 = horizon + (bottom - horizon) * next * next,
      shade = (i + phase + 64) & 3;
    ctx.fillStyle = visualDesign.palette.grassTiles[shade];
    ctx.fillRect(0, y, w, Math.max(1, y2 - y + 1))
  }
}

function renderRoad(w, raceH) {
  const quads = [];
  for (let i = 0; i < trackSamples.length; i++) {
    const q = roadQuad(trackSamples[i], trackSamples[(i + 1) % trackSamples.length], w, raceH);
    if (q) quads.push({
      q,
      depth: q.reduce((n, p) => n + p.depth, 0) / 4,
      i
    })
  }
  quads.sort((a, b) => b.depth - a.depth);
  for (const item of quads) {
    const q = item.q,
      road = visualDesign.road;
    polygon(q, item.i % 6 < 3 ? visualDesign.palette.road : visualDesign.palette.roadAlt);
    if (item.i % 2 === 0) {
      ctx.strokeStyle = road.edge;
      ctx.globalAlpha = .55;
      ctx.lineWidth = Math.max(1, 3 * q[0].scale);
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      ctx.lineTo(q[2].x, q[2].y);
      ctx.moveTo(q[1].x, q[1].y);
      ctx.lineTo(q[3].x, q[3].y);
      ctx.stroke();
      ctx.globalAlpha = 1
    }
    if (item.i % road.centerEvery < 3) {
      ctx.strokeStyle = road.mark;
      ctx.globalAlpha = .32;
      ctx.beginPath();
      ctx.moveTo((q[0].x + q[1].x) * .5, (q[0].y + q[1].y) * .5);
      ctx.lineTo((q[2].x + q[3].x) * .5, (q[2].y + q[3].y) * .5);
      ctx.stroke();
      ctx.globalAlpha = 1
    }
  }
}

function drawRibbon(p, width, length, color, w, raceH) {
  const rx = p.rightX * width,
    ry = p.rightY * width,
    fx = p.dirX * length,
    fy = p.dirY * length,
    q = [cameraPoint(p.x - rx - fx, p.y - ry - fy, w, raceH), cameraPoint(p.x + rx - fx, p.y + ry - fy, w, raceH), cameraPoint(p.x + rx + fx, p.y + ry + fy, w, raceH), cameraPoint(p.x - rx + fx, p.y - ry + fy, w, raceH)];
  if (!q.some(v => !v)) polygon(q, color)
}

function spriteFrameFor(angle) {
  const relative = Math.abs(angleDiff(angle, camera.angle));
  return relative < .45 ? 'rear' : relative < 1.25 ? (angleDiff(angle, camera.angle) > 0 ? 'rear-left' : 'rear-right') : 'side'
}

function drawPixelSprite(sprite, x, y, unit, overrides = {}) {
  const pixels = sprite.pixels,
    legend = {
      ...sprite.legend,
      ...overrides
    },
    rows = pixels.length,
    cols = pixels[0].length;
  for (let row = 0; row < rows; row++) {
    let start = 0,
      key = pixels[row][0];
    for (let col = 1; col <= cols; col++) {
      const next = col < cols ? pixels[row][col] : null;
      if (next !== key) {
        const color = legend[key];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x + (start - cols / 2) * unit, y + (row - rows) * unit, (col - start) * unit + .35, unit + .35)
        }
        start = col;
        key = next
      }
    }
  }
}

function renderGroundMaterial(w, raceH) {
  const visible = [];
  for (const item of groundDecor) {
    const p = cameraPoint(item.x, item.y, w, raceH);
    if (p) visible.push({
      p,
      item
    })
  }
  visible.sort((a, b) => b.p.depth - a.p.depth);
  for (const v of visible) {
    const unit = clamp(9 * v.p.scale, 1, 5);
    drawPixelSprite(spriteCatalog[v.item.type], v.p.x, v.p.y, unit)
  }
}

function renderWalls(w, raceH) {
  const segments = [],
    posts = [],
    step = visualDesign.wall.sampleStep,
    style = visualDesign.wall;
  for (let i = 0; i < trackSamples.length; i += step) {
    const aTrack = trackSamples[i],
      bTrack = trackSamples[(i + step) % trackSamples.length];
    for (const side of [-1, 1]) {
      const aEdge = aTrack.width * ROAD_LIMIT,
        bEdge = bTrack.width * ROAD_LIMIT,
        a = cameraPoint(aTrack.x + aTrack.rightX * aEdge * side, aTrack.y + aTrack.rightY * aEdge * side, w, raceH),
        b = cameraPoint(bTrack.x + bTrack.rightX * bEdge * side, bTrack.y + bTrack.rightY * bEdge * side, w, raceH);
      if (a) posts.push({
        p: a,
        i
      });
      if (a && b) segments.push({
        a,
        b,
        depth: (a.depth + b.depth) / 2
      })
    }
  }
  segments.sort((a, b) => b.depth - a.depth);
  ctx.lineCap = 'butt';
  for (const wall of segments) {
    const scale = (wall.a.scale + wall.b.scale) / 2;
    ctx.strokeStyle = style.base;
    ctx.lineWidth = clamp(19 * scale, 3, 32);
    ctx.beginPath();
    ctx.moveTo(wall.a.x, wall.a.y);
    ctx.lineTo(wall.b.x, wall.b.y);
    ctx.stroke();
    ctx.strokeStyle = style.face;
    ctx.lineWidth = clamp(13 * scale, 2, 23);
    ctx.beginPath();
    ctx.moveTo(wall.a.x, wall.a.y - 2 * scale);
    ctx.lineTo(wall.b.x, wall.b.y - 2 * scale);
    ctx.stroke();
    ctx.strokeStyle = style.top;
    ctx.lineWidth = clamp(3 * scale, 1, 7);
    ctx.beginPath();
    ctx.moveTo(wall.a.x, wall.a.y - 6 * scale);
    ctx.lineTo(wall.b.x, wall.b.y - 6 * scale);
    ctx.stroke()
  }
  posts.sort((a, b) => b.p.depth - a.p.depth);
  for (const v of posts) {
    const unit = clamp(style.worldSize * v.p.scale / 6, 1, 7);
    drawPixelSprite(spriteCatalog.wall, v.p.x, v.p.y, unit, {
      R: ((v.i / step) & 1) ? style.accent : '#e6b943'
    })
  }
}

function renderObjects(w, raceH) {
  const visible = [];
  for (const b of boostPads) {
    const p = cameraPoint(b.x, b.y, w, raceH);
    if (p) visible.push({
      type: 'boost',
      p,
      item: b
    })
  }
  for (const o of obstacles) {
    const p = cameraPoint(o.x, o.y, w, raceH);
    if (p) visible.push({
      type: 'obstacle',
      p,
      item: o
    })
  }
  for (const r of rivals) {
    const p = cameraPoint(r.x, r.y, w, raceH);
    if (p) visible.push({
      type: 'rival',
      p,
      item: r
    })
  }
  for (const t of scenery) {
    const p = cameraPoint(t.x, t.y, w, raceH);
    if (p) visible.push({
      type: 'tree',
      p,
      item: t
    })
  }
  visible.sort((a, b) => b.p.depth - a.p.depth);
  for (const v of visible) {
    const p = v.p,
      it = v.item;
    if (v.type === 'boost') drawRibbon(it, it.width * .78, 20, it.color, w, raceH);
    else if (v.type === 'tree') {
      const s = Math.min(150, it.size * p.scale);
      ctx.shadowBlur = 14;
      ctx.shadowColor = it.color;
      drawPixelSprite(spriteCatalog.tree, p.x, p.y, s / 7, {
        L: it.color,
        H: '#d8ff9a'
      });
      ctx.shadowBlur = 0
    } else if (v.type === 'obstacle') {
      const s = Math.min(95, it.radius * p.scale);
      ctx.fillStyle = '#283042';
      ctx.fillRect(p.x - s, p.y - s * .85, s * 2, s * .85);
      ctx.fillStyle = it.color;
      ctx.fillRect(p.x - s * .88, p.y - s * .72, s * 1.76, s * .15)
    } else drawKart(p.x, p.y, Math.min(76, 28 * p.scale), it.color, false, 0, spriteFrameFor(it.angle))
  }
}

function renderFinish(w, raceH) {
  const p = sampleTrack(0);
  drawRibbon(p, p.width, 9, '#f4f6ff', w, raceH)
}

function drawKart(x, y, s, color, hero, tilt = 0, frame = 'rear') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const unit = s / 7;
  // The fixed player camera needs a clear contact shadow; otherwise the kart
  // appears to float above the road while world-space rivals remain grounded.
  ctx.fillStyle = hero ? '#06101699' : '#06101677';
  ctx.beginPath();
  ctx.ellipse(0, unit * .18, unit * 3.05, unit * .52, 0, 0, Math.PI * 2);
  ctx.fill();
  if (hero && Math.abs(player.speed) > 20) {
    const flameColor = player.boost > 0 ? '#f04e32' : '#f6c85f';
    ctx.fillStyle = flameColor;
    ctx.shadowBlur = player.boost > 0 ? 18 : 5;
    ctx.shadowColor = flameColor;
    ctx.fillRect(-unit, unit * .3, unit * 2, unit * (player.boost > 0 ? 2.4 : 1.5));
    ctx.fillStyle = '#fff0a5';
    ctx.fillRect(-unit * .45, unit * .3, unit * .9, unit * .85);
    ctx.shadowBlur = 0
  }
  ctx.shadowBlur = hero ? 18 : 6;
  ctx.shadowColor = color;
  drawPixelSprite({
    pixels: spriteCatalog.kart.frames[frame],
    legend: spriteCatalog.kart.legend
  }, 0, 0, unit, {
    B: color
  });
  ctx.shadowBlur = 0;
  ctx.restore()
}

function renderParticles(w, raceH) {
  const motion = Math.abs(player.speed) / 210;
  ctx.strokeStyle = '#dbe9ff44';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const seed = (i * 83 + Math.floor(performance.now() * .04 * motion)) % 997,
      x = (seed * 17) % w,
      y = raceH * .48 + (seed * 11) % (raceH * .52);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (x - w / 2) * .018 * motion, y + 8 + 24 * motion);
    ctx.stroke()
  }
}

function renderRaceView(w, raceH) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, raceH);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, 0, 0, raceH * .48);
  sky.addColorStop(0, '#5e8dd7');
  sky.addColorStop(1, '#b77fb1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, raceH * .48);
  const grass = ctx.createLinearGradient(0, raceH * .35, 0, raceH);
  grass.addColorStop(0, '#3b9a6c');
  grass.addColorStop(1, '#195d43');
  ctx.fillStyle = grass;
  ctx.fillRect(0, raceH * .38, w, raceH * .62);
  renderGround(w, raceH);
  renderGroundMaterial(w, raceH);
  renderRoad(w, raceH);
  renderWalls(w, raceH);
  renderFinish(w, raceH);
  renderObjects(w, raceH);
  drawKart(w / 2, raceH * .85, Math.min(58, raceH * .115), '#caff3d', true, player.steer * .14);
  if (player.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,45,141,${player.hitFlash*.18})`;
    ctx.fillRect(0, 0, w, raceH)
  }
  if (player.boundaryFlash > 0) {
    ctx.fillStyle = `rgba(33,230,255,${player.boundaryFlash*.12})`;
    ctx.fillRect(0, 0, w, raceH);
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.max(16,w*.02)}px "Barlow Condensed",sans-serif`;
    ctx.fillStyle = '#e2feff';
    ctx.fillText('COURSE WALL — SLOW DOWN', w / 2, raceH * .7)
  }
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.max(14,w*.018)}px "Barlow Condensed",sans-serif`;
  ctx.fillStyle = player.onRoad ? '#d9ff53' : '#ffca75';
  ctx.fillText(player.onRoad ? 'ON ROAD' : 'GRASS • SLOW', w / 2, raceH * .68);
  if (player.boost > 0) {
    ctx.font = `italic 800 ${Math.max(16,w*.022)}px "Barlow Condensed",sans-serif`;
    ctx.fillStyle = '#ff354d';
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ff354d';
    ctx.fillText('BOOST ACTIVE', w / 2, raceH * .61);
    ctx.shadowBlur = 0
  }
  renderParticles(w, raceH);
  ctx.restore()
}

function worldMapPoint(x, y, cx, cy, scale) {
  return {
    x: cx + x * scale,
    y: cy + y * scale
  }
}

function renderMinimap(w, h, raceH) {
  const gap = 8,
    pad = 12,
    x = pad,
    y = raceH + gap,
    mapW = w - pad * 2,
    mapH = h - y - pad,
    cx = x + mapW / 2,
    cy = y + mapH / 2 + 10,
    scale = Math.min((mapW - 48) / 2100, (mapH - 42) / 2000);
  ctx.fillStyle = '#091323';
  ctx.fillRect(0, raceH, w, h - raceH);
  ctx.fillStyle = '#101b2d';
  ctx.fillRect(x, y, mapW, mapH);
  ctx.strokeStyle = '#79d6ee88';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + .5, y + .5, mapW - 1, mapH - 1);
  ctx.fillStyle = '#9cecff';
  ctx.font = '800 10px Inter,sans-serif';
  ctx.fillText('WORLD MAP  •  LIVE PLAYER COORDINATES', x + 14, y + 18);
  ctx.beginPath();
  trackSamples.forEach((p, i) => {
    const m = worldMapPoint(p.x + p.rightX * p.width * ROAD_LIMIT, p.y + p.rightY * p.width * ROAD_LIMIT, cx, cy, scale);
    i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y)
  });
  for (let i = trackSamples.length - 1; i >= 0; i--) {
    const p = trackSamples[i],
      m = worldMapPoint(p.x - p.rightX * p.width * ROAD_LIMIT, p.y - p.rightY * p.width * ROAD_LIMIT, cx, cy, scale);
    ctx.lineTo(m.x, m.y)
  }
  ctx.closePath();
  ctx.fillStyle = '#343943';
  ctx.fill();
  ctx.strokeStyle = '#f6efcf';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  trackSamples.forEach((p, i) => {
    const m = worldMapPoint(p.x, p.y, cx, cy, scale);
    i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y)
  });
  ctx.closePath();
  ctx.strokeStyle = '#fef8dd88';
  ctx.stroke();
  boostPads.forEach(b => {
    const m = worldMapPoint(b.x, b.y, cx, cy, scale);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.fill()
  });
  rivals.forEach(r => {
    const m = worldMapPoint(r.x, r.y, cx, cy, scale);
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
    ctx.fill()
  });
  const me = worldMapPoint(player.x, player.y, cx, cy, scale);
  ctx.save();
  ctx.translate(me.x, me.y);
  ctx.rotate(player.angle);
  ctx.fillStyle = player.onRoad ? '#f7ffce' : '#ffb45c';
  ctx.shadowBlur = 10;
  ctx.shadowColor = ctx.fillStyle;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-6, 7);
  ctx.lineTo(6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#b7c4d9';
  ctx.font = '700 9px Inter,sans-serif';
  ctx.fillText(`X ${Math.round(player.x)}  Y ${Math.round(player.y)}  A ${Math.round(player.angle*180/Math.PI)}°`, x + 14, y + mapH - 12)
}

function render() {
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    raceH = Math.floor(h * .64);
  ctx.clearRect(0, 0, w, h);
  renderRaceView(w, raceH);
  renderMinimap(w, h, raceH)
}

function loop(now) {
  const dt = Math.min(.035, (now - last) / 1000);
  last = now;
  update(dt, now);
  render();
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// MAP CHIP COURSE: this record is the shared source for editor, collision,
// race rendering and the lower map.  The old spline only seeds the first map.
const TILE_SIZE = 80,
  TILE_TYPES = {
    asphalt: {
      label: 'ROAD',
      color: '#746d60'
    },
    grass: {
      label: 'GRASS',
      color: '#4b9a61'
    },
    sand: {
      label: 'SAND',
      color: '#c9aa62'
    },
    wall: {
      label: 'WALL',
      color: '#ead9a8'
    }
  };
const COURSE_STORAGE_KEY = 'neon-lap-map-chip-course-v1';

function makeDefaultCourse() {
  const map = {
    cols: 28,
    rows: 25,
    size: TILE_SIZE,
    originX: -1120,
    originY: -1000,
    cells: []
  };
  for (let row = 0; row < map.rows; row++) {
    const line = [];
    for (let col = 0; col < map.cols; col++) {
      const near = nearestTrack(map.originX + (col + .5) * map.size, map.originY + (row + .5) * map.size);
      line.push(near.distance < near.p.width * .69 ? 'asphalt' : near.distance < near.p.width * .9 ? 'wall' : 'grass')
    }
    map.cells.push(line)
  }
  map.cells[3][3] = 'sand';
  map.cells[21][24] = 'sand';
  enforceBorderWalls(map);
  return map
}

function validCourse(value) {
  return value && Number.isInteger(value.cols) && Number.isInteger(value.rows) && value.cols > 4 && value.rows > 4 && Array.isArray(value.cells) && value.cells.length === value.rows && value.cells.every(r => Array.isArray(r) && r.length === value.cols) && Number.isFinite(value.size) && value.size > 20
}

function loadStoredCourse() {
  try {
    const saved = JSON.parse(localStorage.getItem(COURSE_STORAGE_KEY));
    if (validCourse(saved)) {
      enforceBorderWalls(saved);
      return saved
    }
  } catch (err) {}
  return makeDefaultCourse()
}
let courseMap = loadStoredCourse();

function enforceBorderWalls(map = courseMap) {
  for (let c = 0; c < map.cols; c++) {
    map.cells[0][c] = 'wall';
    map.cells[map.rows - 1][c] = 'wall'
  }
  for (let r = 0; r < map.rows; r++) {
    map.cells[r][0] = 'wall';
    map.cells[r][map.cols - 1] = 'wall'
  }
}

function cellFromWorld(x, y) {
  return {
    col: Math.floor((x - courseMap.originX) / courseMap.size),
    row: Math.floor((y - courseMap.originY) / courseMap.size)
  }
}

function tileAtWorld(x, y) {
  const p = cellFromWorld(x, y);
  return p.col < 0 || p.row < 0 || p.col >= courseMap.cols || p.row >= courseMap.rows ? 'wall' : courseMap.cells[p.row][p.col]
}

function cellCenter(col, row) {
  return {
    x: courseMap.originX + (col + .5) * courseMap.size,
    y: courseMap.originY + (row + .5) * courseMap.size
  }
}

function circleHitsWall(x, y, r = PLAYER_RADIUS) {
  const p = cellFromWorld(x, y),
    range = Math.ceil(r / courseMap.size) + 1;
  for (let row = p.row - range; row <= p.row + range; row++)
    for (let col = p.col - range; col <= p.col + range; col++) {
      if (col < 0 || row < 0 || col >= courseMap.cols || row >= courseMap.rows || courseMap.cells[row][col] === 'wall') {
        const inset = 12,
          left = courseMap.originX + col * courseMap.size + inset,
          top = courseMap.originY + row * courseMap.size + inset,
          wallSize = courseMap.size - inset * 2,
          cx = clamp(x, left, left + wallSize),
          cy = clamp(y, top, top + wallSize);
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return true
      }
    }
  return false
}

function resolveWallCollision(previousX, previousY) {
  if (!circleHitsWall(player.x, player.y)) return false;
  const moveX = player.x - previousX,
    moveY = player.y - previousY,
    moveLength = Math.hypot(moveX, moveY) || 1,
    backX = -moveX / moveLength,
    backY = -moveY / moveLength,
    kick = Math.max(18, Math.min(48, Math.abs(player.speed) * .18));
  let safeX = previousX,
    safeY = previousY;
  for (let step = kick; step >= 0; step -= 4) {
    const x = previousX + backX * step,
      y = previousY + backY * step;
    if (!circleHitsWall(x, y)) {
      safeX = x;
      safeY = y;
      break
    }
  }
  player.x = safeX;
  player.y = safeY;
  player.speed = player.speed > 0 ? Math.min(16, player.speed * .14) : Math.max(-12, player.speed * .14);
  player.wallKick = .14;
  player.boundaryFlash = 1;
  player.hitFlash = Math.max(player.hitFlash, .45);
  if (!player.collisionCooldown) {
    player.collisionCooldown = .16;
    beep(135, .06)
  }
  return true
}

function updatePlayer(dt) {
  const up = keys.arrowup || keys.w || touchInput.up,
    down = keys.arrowdown || keys.s || touchInput.down,
    left = keys.arrowleft || keys.a || touchInput.left,
    right = keys.arrowright || keys.d;
  const beforeTile = tileAtWorld(player.x, player.y),
    wasOnRoad = player.onRoad;
  player.onRoad = beforeTile === 'asphalt';
  player.surface = beforeTile;
  if (up) player.speed += player.acceleration * dt;
  else if (player.speed > 0) player.speed -= player.friction * dt;
  else if (player.speed < 0) player.speed += player.friction * dt;
  if (down) {
    if (player.speed > 0) player.speed -= player.brakePower * dt;
    else player.speed -= player.acceleration * .72 * dt
  }
  const surfaceMax = beforeTile === 'asphalt' ? player.maxSpeed : beforeTile === 'sand' ? player.maxSpeed * .5 : GRASS_CRAWL_SPEED;
  const boostMax = beforeTile === 'asphalt' && player.boost > 0 ? player.maxSpeed * 1.28 : surfaceMax;
  if (player.speed > boostMax) player.speed = Math.max(boostMax, player.speed - 260 * dt);
  if (player.speed < -player.reverseSpeed) player.speed = -player.reverseSpeed;
  if (Math.abs(player.speed) < 2 && !up && !down) player.speed = 0;
  const steerInput = (right ? 1 : 0) - (left ? 1 : 0),
    speedRatio = Math.min(1, Math.abs(player.speed) / player.maxSpeed);
  player.steer += (steerInput - player.steer) * Math.min(1, dt * 11);
  player.angle += steerInput * player.turnSpeed * (.96 - speedRatio * .48) * dt * (player.speed >= 0 ? 1 : -1);
  const oldX = player.x,
    oldY = player.y;
  player.x += Math.sin(player.angle) * player.speed * dt;
  player.y -= Math.cos(player.angle) * player.speed * dt;
  player.collisionCooldown = Math.max(0, player.collisionCooldown - dt);
  resolveWallCollision(oldX, oldY);
  if (!player.collisionCooldown)
    for (const o of obstacles) {
      const dx = player.x - o.x,
        dy = player.y - o.y,
        d = Math.hypot(dx, dy);
      if (d < o.radius + 26) {
        const nx = d ? dx / d : -Math.sin(player.angle),
          ny = d ? dy / d : Math.cos(player.angle);
        player.x = o.x + nx * (o.radius + 27);
        player.y = o.y + ny * (o.radius + 27);
        player.speed = -Math.max(24, Math.min(52, Math.abs(player.speed) * .22));
        player.collisionCooldown = .22;
        player.hitFlash = 1;
        beep(105, .09);
        break
      }
    }
  const tile = tileAtWorld(player.x, player.y);
  player.onRoad = tile === 'asphalt';
  player.surface = tile;
  if (!wasOnRoad && player.onRoad && up) player.speed = Math.min(player.speed, player.maxSpeed * .62);
  player.trackT = nearestTrack(player.x, player.y).p.t
}

function tileQuad(col, row, w, raceH) {
  const x = courseMap.originX + col * courseMap.size,
    y = courseMap.originY + row * courseMap.size,
    q = [cameraPoint(x, y, w, raceH), cameraPoint(x + courseMap.size, y, w, raceH), cameraPoint(x + courseMap.size, y + courseMap.size, w, raceH), cameraPoint(x, y + courseMap.size, w, raceH)];
  return q.some(p => !p) ? null : q
}

function renderCourseTiles(w, raceH) {
  const surfaces = [],
    walls = [];
  for (let row = 0; row < courseMap.rows; row++)
    for (let col = 0; col < courseMap.cols; col++) {
      const type = courseMap.cells[row][col];
      if (type === 'grass') continue;
      const q = tileQuad(col, row, w, raceH);
      if (!q) continue;
      const depth = q.reduce((n, p) => n + p.depth, 0) / 4;
      (type === 'wall' ? walls : surfaces).push({
        col,
        row,
        type,
        q,
        depth
      })
    }
  surfaces.sort((a, b) => b.depth - a.depth);
  for (const item of surfaces) {
    polygon(item.q, item.type === 'sand' ? '#b99a57' : item.col % 2 ? '#6d675c' : '#787164');
    ctx.strokeStyle = item.type === 'sand' ? '#e9cc83' : '#aaa08b';
    ctx.globalAlpha = .22;
    ctx.lineWidth = Math.max(1, item.q[0].scale * 2);
    ctx.beginPath();
    ctx.moveTo(item.q[0].x, item.q[0].y);
    ctx.lineTo(item.q[1].x, item.q[1].y);
    ctx.stroke();
    ctx.globalAlpha = 1
  }
  walls.sort((a, b) => b.depth - a.depth);
  for (const item of walls) {
    const p = cameraPoint(cellCenter(item.col, item.row).x, cellCenter(item.col, item.row).y, w, raceH);
    if (!p) continue;
    polygon(item.q, '#4a4339');
    const unit = clamp(courseMap.size * p.scale / 8, 1, 12);
    drawPixelSprite(spriteCatalog.wall, p.x, p.y, unit, {
      R: (item.col + item.row) % 3 ? '#df5447' : '#e6b943'
    })
  }
}

function renderRaceView(w, raceH) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, raceH);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, 0, 0, raceH * .48);
  sky.addColorStop(0, '#6f9cdd');
  sky.addColorStop(1, '#c596bb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, raceH * .48);
  const grass = ctx.createLinearGradient(0, raceH * .35, 0, raceH);
  grass.addColorStop(0, '#51ab73');
  grass.addColorStop(1, '#236f50');
  ctx.fillStyle = grass;
  ctx.fillRect(0, raceH * .38, w, raceH * .62);
  renderGround(w, raceH);
  renderGroundMaterial(w, raceH);
  renderCourseTiles(w, raceH);
  renderObjects(w, raceH);
  drawKart(w / 2, raceH * .85, Math.min(58, raceH * .115), '#caff3d', true, player.steer * .14);
  if (player.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,45,141,${player.hitFlash*.18})`;
    ctx.fillRect(0, 0, w, raceH)
  }
  if (player.boundaryFlash > 0) {
    ctx.fillStyle = `rgba(33,230,255,${player.boundaryFlash*.12})`;
    ctx.fillRect(0, 0, w, raceH);
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.max(16,w*.02)}px "Barlow Condensed",sans-serif`;
    ctx.fillStyle = '#e2feff';
    ctx.fillText('WALL — SLOW DOWN', w / 2, raceH * .7)
  }
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.max(14,w*.018)}px "Barlow Condensed",sans-serif`;
  ctx.fillStyle = player.onRoad ? '#d9ff53' : player.surface === 'sand' ? '#ffe08a' : '#ffca75';
  ctx.fillText(player.onRoad ? 'ROAD' : player.surface === 'sand' ? 'SAND • SLOW' : 'GRASS • SLOW', w / 2, raceH * .68);
  if (player.boost > 0) {
    ctx.font = `italic 800 ${Math.max(16,w*.022)}px "Barlow Condensed",sans-serif`;
    ctx.fillStyle = '#ff354d';
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ff354d';
    ctx.fillText('BOOST ACTIVE', w / 2, raceH * .61);
    ctx.shadowBlur = 0
  }
  renderParticles(w, raceH);
  ctx.restore()
}

function renderMinimap(w, h, raceH) {
  const gap = 8,
    pad = 12,
    x = pad,
    y = raceH + gap,
    mapW = w - pad * 2,
    mapH = h - y - pad,
    innerTop = y + 28,
    scale = Math.min((mapW - 24) / (courseMap.cols * courseMap.size), (mapH - 44) / (courseMap.rows * courseMap.size)),
    drawW = courseMap.cols * courseMap.size * scale,
    drawH = courseMap.rows * courseMap.size * scale,
    left = x + (mapW - drawW) / 2,
    top = innerTop + (mapH - 40 - drawH) / 2;
  ctx.fillStyle = '#091323';
  ctx.fillRect(0, raceH, w, h - raceH);
  ctx.fillStyle = '#101b2d';
  ctx.fillRect(x, y, mapW, mapH);
  ctx.strokeStyle = '#79d6ee88';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + .5, y + .5, mapW - 1, mapH - 1);
  ctx.fillStyle = '#9cecff';
  ctx.font = '800 10px Inter,sans-serif';
  ctx.fillText('MAP CHIP COURSE  •  LIVE PLAYER COORDINATES', x + 14, y + 18);
  for (let row = 0; row < courseMap.rows; row++)
    for (let col = 0; col < courseMap.cols; col++) {
      const type = courseMap.cells[row][col],
        px = left + col * courseMap.size * scale,
        py = top + row * courseMap.size * scale;
      ctx.fillStyle = type === 'wall' ? '#f0db9d' : type === 'asphalt' ? '#54535a' : type === 'sand' ? '#d7b66d' : '#4f9960';
      ctx.fillRect(px, py, courseMap.size * scale + .3, courseMap.size * scale + .3)
    }
  ctx.strokeStyle = '#f8efce';
  ctx.globalAlpha = .38;
  ctx.strokeRect(left, top, drawW, drawH);
  ctx.globalAlpha = 1;
  const me = {
    x: left + (player.x - courseMap.originX) * scale,
    y: top + (player.y - courseMap.originY) * scale
  };
  ctx.save();
  ctx.translate(me.x, me.y);
  ctx.rotate(player.angle);
  ctx.fillStyle = player.onRoad ? '#f7ffce' : '#ffb45c';
  ctx.shadowBlur = 10;
  ctx.shadowColor = ctx.fillStyle;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-6, 7);
  ctx.lineTo(6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#b7c4d9';
  ctx.font = '700 9px Inter,sans-serif';
  ctx.fillText(`X ${Math.round(player.x)}  Y ${Math.round(player.y)}  A ${Math.round(player.angle*180/Math.PI)}°`, x + 14, y + mapH - 12)
}
// Editor interaction ---------------------------------------------------------
const editorOverlay = $('#editorOverlay'),
  editorCanvas = $('#editorCanvas'),
  editorCtx = editorCanvas.getContext('2d');
let editorTool = 'asphalt',
  editorPointer = null,
  editorPreviousState = 'menu';

function drawEditor() {
  if (!editorOverlay.classList.contains('show')) return;
  const rect = editorCanvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio, 2),
    width = Math.max(1, rect.width),
    height = Math.max(1, rect.height);
  if (editorCanvas.width !== Math.round(width * d) || editorCanvas.height !== Math.round(height * d)) {
    editorCanvas.width = Math.round(width * d);
    editorCanvas.height = Math.round(height * d)
  }
  editorCtx.setTransform(d, 0, 0, d, 0, 0);
  editorCtx.fillStyle = '#0b1827';
  editorCtx.fillRect(0, 0, width, height);
  const cell = Math.min((width - 18) / courseMap.cols, (height - 18) / courseMap.rows),
    mapWidth = cell * courseMap.cols,
    mapHeight = cell * courseMap.rows,
    left = (width - mapWidth) / 2,
    top = (height - mapHeight) / 2;
  drawEditor.layout = {
    left,
    top,
    cell
  };
  for (let row = 0; row < courseMap.rows; row++)
    for (let col = 0; col < courseMap.cols; col++) {
      const type = courseMap.cells[row][col],
        x = left + col * cell,
        y = top + row * cell;
      editorCtx.fillStyle = type === 'wall' ? '#efd99d' : type === 'asphalt' ? '#676259' : type === 'sand' ? '#cba95f' : '#4d9660';
      editorCtx.fillRect(x, y, cell + .4, cell + .4);
      if (type === 'wall') {
        editorCtx.fillStyle = '#b54d48';
        editorCtx.fillRect(x + cell * .18, y + cell * .42, cell * .64, cell * .22)
      }
    }
  editorCtx.strokeStyle = '#dff9ff99';
  editorCtx.lineWidth = 1;
  editorCtx.strokeRect(left + .5, top + .5, mapWidth - 1, mapHeight - 1);
  editorCtx.fillStyle = '#d4ecff';
  editorCtx.font = '700 11px Inter,sans-serif';
  editorCtx.fillText('START', left + 6, top + 15)
}

function editorCellAt(e) {
  const r = editorCanvas.getBoundingClientRect(),
    l = drawEditor.layout;
  if (!l) return null;
  const col = Math.floor((e.clientX - r.left - l.left) / l.cell),
    row = Math.floor((e.clientY - r.top - l.top) / l.cell);
  return col >= 0 && row >= 0 && col < courseMap.cols && row < courseMap.rows ? {
    col,
    row
  } : null
}

function paintEditor(e) {
  const p = editorCellAt(e);
  if (!p) return;
  courseMap.cells[p.row][p.col] = editorTool;
  enforceBorderWalls();
  drawEditor()
}

function openEditor() {
  resetTouchPad();
  setGameplayLock(false);
  editorPreviousState = state;
  editorOverlay.classList.add('show');
  state = 'editor';
  requestAnimationFrame(drawEditor)
}

function closeEditor() {
  editorOverlay.classList.remove('show');
  state = editorPreviousState;
  setGameplayLock(state === 'race' || state === 'countdown')
}

function saveCourse() {
  try {
    localStorage.setItem(COURSE_STORAGE_KEY, JSON.stringify(courseMap));
    $('#editorSaveBtn').textContent = 'SAVED ✓';
    setTimeout(() => $('#editorSaveBtn').textContent = 'SAVE', 900)
  } catch (err) {
    $('#editorSaveBtn').textContent = 'SAVE FAILED'
  }
}

function loadCourse() {
  courseMap = loadStoredCourse();
  drawEditor()
}

function mapStartAngle(col, row) {
  for (const d of [{
      x: 1,
      y: 0
    }, {
      x: 0,
      y: 1
    }, {
      x: -1,
      y: 0
    }, {
      x: 0,
      y: -1
    }, {
      x: 1,
      y: 1
    }, {
      x: -1,
      y: 1
    }, {
      x: -1,
      y: -1
    }, {
      x: 1,
      y: -1
    }]) {
    const next = courseMap.cells[row + d.y]?.[col + d.x];
    if (next === 'asphalt') return Math.atan2(d.x, -d.y)
  }
  return 0
}

function startEditedMap() {
  let start, startCell;
  for (let row = 0; row < courseMap.rows && !start; row++)
    for (let col = 0; col < courseMap.cols; col++)
      if (courseMap.cells[row][col] === 'asphalt') {
        start = cellCenter(col, row);
        startCell = {
          col,
          row
        };
        break
      } if (!start) {
    alert('ROAD チップを1つ以上配置してください。');
    return
  }
  const startAngle = mapStartAngle(startCell.col, startCell.row),
    startTrack = nearestTrack(start.x, start.y).p;
  Object.assign(player, {
    x: start.x,
    y: start.y,
    angle: startAngle,
    speed: 0,
    lap: 1,
    trackT: startTrack.t,
    lastTrackT: startTrack.t,
    onRoad: true,
    boost: 0,
    hitFlash: 0,
    boundaryFlash: 0
  });
  snapCamera();
  boostPads.forEach(b => b.armed = true);
  $('#startScreen').classList.remove('show');
  $('#finishScreen').classList.remove('show');
  editorOverlay.classList.remove('show');
  state = 'countdown';
  setGameplayLock(true);
  countValue = 3;
  startAt = performance.now();
  showCount('3');
  beep(220)
}
$('#editorBtn').onclick = openEditor;
$('#editorCloseBtn').onclick = closeEditor;
$('#editorSaveBtn').onclick = saveCourse;
$('#editorLoadBtn').onclick = loadCourse;
$('#editorResetBtn').onclick = () => {
  courseMap = makeDefaultCourse();
  drawEditor()
};
$('#editorPlayBtn').onclick = startEditedMap;
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => {
  editorTool = button.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected', b === button))
});
editorCanvas.addEventListener('pointerdown', e => {
  editorPointer = e.pointerId;
  editorCanvas.setPointerCapture?.(e.pointerId);
  paintEditor(e);
  e.preventDefault()
});
editorCanvas.addEventListener('pointermove', e => {
  if (e.pointerId === editorPointer) paintEditor(e)
});
editorCanvas.addEventListener('pointerup', e => {
  if (e.pointerId === editorPointer) editorPointer = null
});
editorCanvas.addEventListener('pointercancel', () => editorPointer = null);
addEventListener('resize', () => requestAnimationFrame(drawEditor));
