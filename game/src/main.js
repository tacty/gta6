// main.js — SOLMAR HEAT entry point: boot, the game loop, screen flow
// (title / playing / paused / DOWN / ARRESTED), crime bookkeeping, effects,
// autosave, and deterministic screenshot staging via ?shot=…&seed=N.
//
// SOLMAR HEAT is an original top-down 2D open-world crime game set in the
// fictional coastal city of Solmar. Marco Reyes runs jobs for Lucia while
// the Solmar PD tries to run him down. All names, places and art are
// original and drawn in code; nothing is loaded from the network.

import { createInput } from './input.js';
import { createWorld, drawWorld, clamp, dist } from './world.js';
import { createPlayer, updatePlayerOnFoot, tryEnterExit, nearestInteractCar, drawPlayer } from './player.js';
import { spawnTraffic, spawnParked, updatePlayerCar, updateTraffic, drawCar, placeOnRoad } from './vehicles.js';
import { commitCrime as policeCrime, updatePolice, setWanted } from './police.js';
import { spawnPeds, updatePeds, drawPed } from './pedestrians.js';
import { createCombat, updateCombat, drawBullets, hurtPed } from './combat.js';
import { startMission, updateMissions, drawMissionMarker, MISSIONS } from './missions.js';
import { drawHUD } from './hud.js';
import { createAudio } from './audio.js';
import { loadSave, writeSave } from './save.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

let viewW = 1280;
let viewH = 800;
function resize() {
  const ratio = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.round(viewW * ratio);
  canvas.height = Math.round(viewH * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ state

const G = {
  mode: 'title', // title | playing | paused | dead | busted
  time: 0,
  seed,
  rand: null,
  world: null,
  input: createInput(canvas),
  audio: createAudio(),
  player: null,
  vehicles: [],
  policeCars: [],
  peds: [],
  bullets: [],
  particles: [],
  skids: [],
  combat: createCombat(),
  camera: { x: 1000, y: 1000, shakeT: 0, shakeMag: 0 },
  wanted: 0,
  hideTimer: 0,
  bustMeter: 0,
  copSpawnTimer: 0,
  money: 250,
  mission: { index: 0, stage: 0, timer: 0, carId: null, done: false },
  toast: '',
  toastTimer: 0,
  phone: null,
  phoneTimer: 0,
  dangerPos: null,
  dangerTimer: 0,
  nearCar: null,
  saveTimer: 0,
  viewW: 0,
  viewH: 0,
};

G.playerPos = () => (G.player.car
  ? { x: G.player.car.x, y: G.player.car.y }
  : { x: G.player.x, y: G.player.y });

G.shake = (mag) => {
  G.camera.shakeMag = Math.max(G.camera.shakeMag, mag * 14);
  G.camera.shakeT = 0.35;
};

G.showToast = (text) => { G.toast = text; G.toastTimer = 3.2; };
G.showPhone = (title, text) => { G.phone = { title, text }; G.phoneTimer = 9; };

G.spawnDust = (x, y, n) => {
  for (let i = 0; i < n; i++) {
    G.particles.push({
      x, y,
      vx: (G.rand() - 0.5) * 90, vy: (G.rand() - 0.5) * 90,
      life: 0.5 + G.rand() * 0.6, maxLife: 1,
      color: '216,190,140', size: 5 + G.rand() * 7,
    });
  }
};
G.spawnSparks = (x, y, n) => {
  for (let i = 0; i < n; i++) {
    G.particles.push({
      x, y,
      vx: (G.rand() - 0.5) * 260, vy: (G.rand() - 0.5) * 260,
      life: 0.18 + G.rand() * 0.2, maxLife: 0.35,
      color: '255,205,90', size: 2.4,
    });
  }
};

// Crime bookkeeping: gunfire only re-raises heat once a second (the panic
// still spreads), everything else goes straight to police.js.
let lastGunCrime = -10;
G.commitCrime = (kind, x, y) => {
  if (kind === 'gunfire' && G.time - lastGunCrime < 1.1) {
    for (const p of G.peds) if (!p.dead && dist(p.x, p.y, x, y) < 200) p.panic = 2.5;
    return;
  }
  if (kind === 'gunfire') lastGunCrime = G.time;
  policeCrime(G, kind, x, y);
};

G.onCarCrash = (car, speed, other) => {
  const isPlayer = car === G.player.car;
  if (isPlayer) {
    G.shake(clamp(speed / 300, 0.15, 0.6));
    G.audio.crash(clamp(speed / 300, 0.3, 1));
    G.spawnSparks(car.x, car.y, 5);
    if (other && other.kind === 'police') G.commitCrime('copcrash', car.x, car.y);
    if (speed > 240) G.player.health -= 4;
  } else if (dist(car.x, car.y, G.player.x, G.player.y) < 300) {
    G.audio.crash(0.4);
  }
};

G.hitPedestrian = (ped, car) => {
  hurtPed(G, ped, 999);
  G.spawnDust(ped.x, ped.y, 4);
};

G.onPlayerDown = (how) => {
  if (G.mode !== 'playing') return;
  G.mode = how; // 'dead' | 'busted'
  G.audio.setEngine(false);
  G.audio.setSiren(false);
  if (how === 'dead') G.audio.fail();
  status.textContent = how === 'dead' ? 'Marco is down.' : 'Marco was arrested.';
};

G.saveGame = () => {
  const pos = G.playerPos();
  writeSave({ money: G.money, missionIndex: G.mission.index, x: pos.x, y: pos.y });
};

// ------------------------------------------------------------------- setup

function buildWorld(saved) {
  const { createRandom } = worldRandomModule;
  G.rand = createRandom(seed);
  G.world = createWorld(seed);
  G.vehicles = [];
  G.policeCars = [];
  G.peds = [];
  G.bullets = [];
  G.particles = [];
  G.skids = [];
  G.wanted = 0;
  G.hideTimer = 0;
  G.bustMeter = 0;
  const spawn = saved && Number.isFinite(saved.x)
    ? { x: saved.x, y: saved.y }
    : G.world.playerSpawn;
  G.player = createPlayer(spawn.x, spawn.y);
  G.money = saved && Number.isFinite(saved.money) ? saved.money : 250;
  G.mission = { index: 0, stage: 0, timer: 0, carId: null, done: false };
  spawnTraffic(G, 14);
  spawnParked(G, 16);
  spawnPeds(G, 42);
  const startIndex = saved && Number.isInteger(saved.missionIndex)
    ? clamp(saved.missionIndex, 0, MISSIONS.length)
    : 0;
  if (startIndex < MISSIONS.length) startMission(G, startIndex);
  else G.mission.index = MISSIONS.length;
  G.camera.x = G.player.x;
  G.camera.y = G.player.y;
}

// world.js exports createRandom; referenced through a tiny indirection so the
// import list above stays grouped by system.
import { createRandom } from './world.js';
const worldRandomModule = { createRandom };

function respawn() {
  const p = G.player;
  if (p.car) { p.car.driver = null; p.car = null; }
  G.policeCars = [];
  setWanted(G, 0);
  G.bustMeter = 0;
  G.hideTimer = 0;
  if (G.mode === 'dead') {
    G.money = Math.max(0, G.money - 100);
    p.x = G.world.hospital.x + 60;
    p.y = G.world.hospital.y + 30;
    G.showToast('Solmar General patched you up. -$100');
  } else {
    G.money = Math.max(0, G.money - 150); // flat booking fee
    p.x = G.world.station.x + 60;
    p.y = G.world.station.y + 30;
    G.showToast('Released from Solmar PD. -$150 fine');
  }
  p.health = p.maxHealth;
  p.dead = false;
  G.mode = 'playing';
  // Being caught during Clean Getaway restarts that job.
  if (G.mission.index < MISSIONS.length && MISSIONS[G.mission.index].id === 'clean-getaway') {
    startMission(G, G.mission.index);
  }
  G.saveGame();
}

// ------------------------------------------------------- screenshot staging

function stageShot(name) {
  buildWorld(null);
  G.mode = 'playing';
  const p = G.player;
  const { createCar } = vehicleModule;
  if (name === 'cover') {
    const car = createCar(760, 1000, 0, { driver: 'player', color: '#d94f3d' });
    G.vehicles.push(car);
    p.car = car;
    car.speed = 185;
    p.x = car.x; p.y = car.y;
    G.money = 1250;
  } else if (name === 'chase') {
    const car = createCar(900, 1400, 0, { driver: 'player', color: '#3d7bd9' });
    G.vehicles.push(car);
    p.car = car;
    car.speed = 225;
    p.x = car.x; p.y = car.y;
    setWanted(G, 3);
    for (let i = 0; i < 3; i++) {
      const cop = createCar(900 - 130 - i * 95, 1400 + (i % 2 === 0 ? -34 : 30), 0, { kind: 'police', driver: 'police', color: '#20242e' });
      cop.speed = 215;
      G.policeCars.push(cop);
    }
    G.mission.index = 2;
    G.mission.stage = 1;
    G.showPhone('Harbor Run', MISSIONS[2].from);
    G.money = 2650;
  } else if (name === 'mission') {
    const car = createCar(940, 1520, -Math.PI / 2, { driver: 'player', color: '#39b06b' });
    G.vehicles.push(car);
    p.car = car;
    car.speed = 60;
    p.x = car.x; p.y = car.y;
    G.mission.index = 1;
    G.mission.stage = 0;
    G.showPhone('Hot Pickup', MISSIONS[1].from);
    G.phoneTimer = 9999;
    G.money = 750;
  } else { // foot
    p.x = 1064;
    p.y = 1120;
    p.angle = 0.6;
    G.mission.index = 0;
    G.mission.stage = 0;
    // A small crowd on this corner.
    for (let i = 0; i < 6; i++) {
      const ped = G.peds[i];
      if (ped) {
        ped.x = 1010 + (i % 3) * 55;
        ped.y = 1085 + Math.floor(i / 3) * 60;
        ped.targetX = ped.x + 60;
        ped.targetY = ped.y;
      }
    }
    G.money = 250;
  }
  G.camera.x = G.playerPos().x;
  G.camera.y = G.playerPos().y;
}

import { createCar as createCarDirect } from './vehicles.js';
const vehicleModule = { createCar: createCarDirect };

// ------------------------------------------------------------------- update

function maintainPopulation() {
  // Recycle traffic that wandered too far: respawn it near the player.
  const pos = G.playerPos();
  for (const car of G.vehicles) {
    if (car.driver === 'traffic' && dist(car.x, car.y, pos.x, pos.y) > 1050) {
      car.x = pos.x + (G.rand() - 0.5) * 1300;
      car.y = pos.y + (G.rand() - 0.5) * 1300;
      placeOnRoad(car, G.world);
    }
  }
}

function update(dt) {
  G.time += dt;
  const p = G.player;
  const input = G.input;

  if (input.hit('KeyM')) {
    const muted = G.audio.toggleMute();
    G.showToast(muted ? 'Sound off' : 'Sound on');
  }
  if (input.hit('KeyE')) tryEnterExit(G);

  if (p.car) updatePlayerCar(G, dt);
  else {
    G.audio.setEngine(false);
    updatePlayerOnFoot(G, dt);
  }
  // Player rides the car.
  if (p.car) { p.x = p.car.x; p.y = p.car.y; }

  updateTraffic(G, dt);
  updatePolice(G, dt);
  updatePeds(G, dt);
  updateCombat(G, dt);
  updateMissions(G, dt);
  maintainPopulation();

  G.nearCar = nearestInteractCar(G);

  if (G.dangerTimer > 0) {
    G.dangerTimer -= dt;
    if (G.dangerTimer <= 0) G.dangerPos = null;
  }
  if (G.toastTimer > 0) G.toastTimer -= dt;
  if (G.phoneTimer > 0 && G.phoneTimer < 9000) G.phoneTimer -= dt;

  // Slow recovery while out of trouble.
  if (G.wanted === 0 && p.health > 0 && p.health < p.maxHealth) {
    p.health = Math.min(p.maxHealth, p.health + 1.1 * dt);
  }

  // Particles and skid marks.
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const pt = G.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) G.particles.splice(i, 1);
  }
  for (let i = G.skids.length - 1; i >= 0; i--) {
    G.skids[i].life -= dt;
    if (G.skids[i].life <= 0) G.skids.splice(i, 1);
  }

  // Camera follows with a little lookahead; shake decays.
  const pos = G.playerPos();
  const look = p.car ? clamp(p.car.speed * 0.35, -70, 110) : 0;
  const tx = pos.x + (p.car ? Math.cos(p.car.angle) * look : 0);
  const ty = pos.y + (p.car ? Math.sin(p.car.angle) * look : 0);
  G.camera.x += (tx - G.camera.x) * Math.min(1, dt * 5);
  G.camera.y += (ty - G.camera.y) * Math.min(1, dt * 5);
  if (G.camera.shakeT > 0) G.camera.shakeT -= dt;
  else G.camera.shakeMag = 0;

  // Periodic autosave.
  G.saveTimer += dt;
  if (G.saveTimer > 20) {
    G.saveTimer = 0;
    G.saveGame();
  }
}

// -------------------------------------------------------------------- draw

function drawWorldScene() {
  const cam = G.camera;
  const shX = cam.shakeMag ? (G.rand() - 0.5) * cam.shakeMag : 0;
  const shY = cam.shakeMag ? (G.rand() - 0.5) * cam.shakeMag : 0;
  ctx.save();
  ctx.translate(viewW / 2 - cam.x + shX, viewH / 2 - cam.y + shY);
  G.viewW = viewW;
  G.viewH = viewH;

  drawWorld(ctx, G.world, cam, viewW, viewH, G.time);

  // Skid marks under everything mobile.
  ctx.fillStyle = 'rgba(25,22,26,0.5)';
  for (const s of G.skids) ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5);

  drawMissionMarker(ctx, G, G.time);

  for (const car of G.vehicles) drawCar(ctx, car, G.time);
  for (const cop of G.policeCars) drawCar(ctx, cop, G.time);
  for (const ped of G.peds) drawPed(ctx, ped);
  drawPlayer(ctx, G);
  drawBullets(ctx, G);

  // Particles (dust / sparks).
  for (const pt of G.particles) {
    const a = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = `rgba(${pt.color},${(a * 0.75).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size * (1.4 - a * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }

  // Mission-car halo so the First Wheels target reads clearly.
  if (G.mission.index === 0 && G.mission.stage === 0) {
    const car = G.vehicles.find((c) => c.id === G.mission.carId);
    if (car && !G.player.car) {
      ctx.strokeStyle = 'rgba(255,209,102,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 36 + Math.sin(G.time * 4) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();

  // Warm sunset vignette over the whole frame.
  const grad = ctx.createRadialGradient(viewW / 2, viewH / 2, viewH * 0.45, viewW / 2, viewH / 2, viewH * 0.95);
  grad.addColorStop(0, 'rgba(255,140,60,0)');
  grad.addColorStop(1, 'rgba(70,20,50,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH);
}

function panel(title, lines, prompt, accent = '#ffd166') {
  ctx.fillStyle = 'rgba(10,8,18,0.72)';
  ctx.fillRect(0, 0, viewW, viewH);
  const w = Math.min(620, viewW - 40);
  const h = 120 + lines.length * 27 + 70;
  const x = (viewW - w) / 2;
  const y = (viewH - h) / 2;
  ctx.fillStyle = 'rgba(18,16,30,0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(title, viewW / 2, y + 62);
  ctx.fillStyle = '#e8e4da';
  ctx.font = '16px system-ui, sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, viewW / 2, y + 108 + i * 27));
  ctx.fillStyle = accent;
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText(prompt, viewW / 2, y + h - 28);
}

const CONTROLS = [
  'WASD / Arrows — move · Shift — sprint',
  'E — enter / exit a car · Space — handbrake',
  'Mouse — aim · Click or F — shoot (on foot)',
  'P / Esc — pause · M — mute',
];

function draw() {
  ctx.fillStyle = '#241428';
  ctx.fillRect(0, 0, viewW, viewH);
  if (!G.world) return;
  drawWorldScene();

  if (G.mode === 'playing' || G.mode === 'paused') drawHUD(ctx, G, viewW, viewH);

  if (G.mode === 'title') {
    const has = !!loadSave();
    panel('SOLMAR HEAT', [
      'An original top-down crime sandbox in the coastal city of Solmar.',
      'Marco Reyes runs jobs for Lucia — and outruns the Solmar PD.',
      '',
      ...CONTROLS,
      '',
      has ? 'Press ENTER for New Game · C to Continue' : 'Press ENTER to start',
    ], has ? 'NEW GAME  /  CONTINUE' : 'NEW GAME', '#ff9e57');
  } else if (G.mode === 'paused') {
    panel('PAUSED', ['The city waits for no one, Marco.', '', ...CONTROLS], 'Press P or Esc to resume', '#9fb7ff');
  } else if (G.mode === 'dead') {
    panel('DOWN', ['Marco went down in the streets of Solmar.', 'The hospital bill is $100.'], 'Press ENTER to wake up at Solmar General', '#ff6b5e');
  } else if (G.mode === 'busted') {
    panel('ARRESTED', ['The Solmar PD finally boxed Marco in.', 'Booking fee: $150. Your wanted level is cleared.'], 'Press ENTER to walk out of the station', '#7db4ff');
  }

  // Hurt flash.
  if (G.player && G.player.hurtFlash > 0 && G.mode === 'playing') {
    ctx.fillStyle = `rgba(220,40,30,${(G.player.hurtFlash * 0.9).toFixed(3)})`;
    ctx.fillRect(0, 0, viewW, viewH);
  }
}

// -------------------------------------------------------------------- loop

let last = performance.now();
let titlePan = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const input = G.input;

  if (G.mode === 'title') {
    // Slow cinematic pan over the city behind the title panel.
    titlePan += dt;
    G.camera.x = 1000 + Math.sin(titlePan * 0.07) * 420;
    G.camera.y = 1000 + Math.cos(titlePan * 0.05) * 380;
    G.time += dt;
    if (input.hit('Enter') || input.mouseClicked) {
      G.audio.unlock();
      buildWorld(null);
      G.mode = 'playing';
      status.textContent = 'New game started.';
    } else if (input.hit('KeyC') && loadSave()) {
      G.audio.unlock();
      buildWorld(loadSave());
      G.mode = 'playing';
      status.textContent = 'Saved game loaded.';
    }
  } else if (G.mode === 'playing') {
    if (input.hit('KeyP') || input.hit('Escape')) {
      G.mode = 'paused';
      G.audio.setEngine(false);
      G.audio.setSiren(false);
    } else {
      update(dt);
    }
  } else if (G.mode === 'paused') {
    if (input.hit('KeyP') || input.hit('Escape')) G.mode = 'playing';
  } else if (G.mode === 'dead' || G.mode === 'busted') {
    if (input.hit('Enter') || input.mouseClicked) respawn();
  }

  draw();
  input.endFrame();
  if (shotName && !window.__shotReady) window.__shotReady = true;
}

// -------------------------------------------------------------------- boot

// Debug/testing handle: lets a headless browser test read live game state.
window.__solmar = G;

if (shotName) {
  stageShot(shotName);
} else {
  buildWorld(null);
  G.mode = 'title';
}
requestAnimationFrame(frame);
