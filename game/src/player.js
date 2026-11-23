// player.js — Marco Reyes on foot: movement, stamina, health, entering and
// exiting cars, and the little top-down character drawing.

import { clamp, dist } from './world.js';

export const PLAYER_RADIUS = 13;

export function createPlayer(x, y) {
  return {
    x, y,
    vx: 0, vy: 0,
    angle: -Math.PI / 2,   // facing
    aimAngle: 0,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    car: null,             // vehicle object while driving
    walkCycle: 0,
    hurtFlash: 0,
    dead: false,
  };
}

// Move on foot. Cars handle their own movement in vehicles.js; while driving
// the player simply rides along.
export function updatePlayerOnFoot(G, dt) {
  const p = G.player;
  const input = G.input;
  const mx = input.moveX();
  const my = input.moveY();
  const moving = mx !== 0 || my !== 0;
  const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
  const sprinting = wantSprint && moving && p.stamina > 1;
  if (sprinting) p.stamina = Math.max(0, p.stamina - 26 * dt);
  else p.stamina = Math.min(100, p.stamina + 14 * dt);

  const speed = sprinting ? 265 : 165;
  if (moving) {
    const len = Math.hypot(mx, my);
    p.vx = (mx / len) * speed;
    p.vy = (my / len) * speed;
    p.angle = Math.atan2(p.vy, p.vx);
    p.walkCycle += dt * (sprinting ? 13 : 9);
  } else {
    p.vx = 0; p.vy = 0;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (G.world.isWater(p.x, p.y)) { p.y = 2236; p.vy = 0; } // the sea is off-limits
  G.world.collideCircle(p, PLAYER_RADIUS);
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
}

// Enter the nearest car within reach, or get out of the current one.
// Stealing a car that has witnesses raises the wanted level (police.js hook).
export function tryEnterExit(G) {
  const p = G.player;
  if (p.car) {
    const car = p.car;
    car.driver = null;
    p.car = null;
    // Step out to the left side of the car.
    p.x = car.x + Math.cos(car.angle - Math.PI / 2) * 30;
    p.y = car.y + Math.sin(car.angle - Math.PI / 2) * 30;
    G.world.collideCircle(p, PLAYER_RADIUS);
    G.audio.door();
    return;
  }
  let best = null;
  let bestD = 58;
  for (const car of G.vehicles) {
    if (car.wrecked) continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  for (const car of G.policeCars) {
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) return;
  // Taking a car that isn't Marco's yet — a parked ride or one with a driver
  // still in it — is a carjacking if anyone sees it. Once he has taken a car
  // it counts as his, and getting back in is not a new crime.
  const isTheft = !best.playerUsed && (best.parked || best.driver === 'traffic');
  best.parked = false;
  best.driver = 'player';
  best.playerUsed = true;
  if (G.policeCars.includes(best)) {
    G.policeCars.splice(G.policeCars.indexOf(best), 1);
    G.vehicles.push(best);
    best.kind = 'civilian';
  }
  p.car = best;
  G.audio.door();
  if (isTheft) G.commitCrime('carjacking', p.x, p.y);
}

export function damagePlayer(G, amount) {
  const p = G.player;
  if (p.dead) return;
  p.health -= amount;
  p.hurtFlash = 0.18;
  G.audio.hit();
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    G.onPlayerDown('dead');
  }
}

export function drawPlayer(ctx, G) {
  const p = G.player;
  if (p.car) return; // hidden inside the car
  const t = p.walkCycle;
  const legSwing = Math.sin(t) * 5;
  ctx.save();
  ctx.translate(p.x, p.y);
  // Soft shadow.
  ctx.fillStyle = 'rgba(50,25,30,0.35)';
  ctx.beginPath(); ctx.ellipse(3, 5, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Legs (dark jeans), swinging while walking.
  ctx.rotate(p.angle);
  ctx.fillStyle = '#2d3a55';
  ctx.fillRect(-2, -8 + legSwing * 0.4, 11, 5);
  ctx.fillRect(-2, 3 - legSwing * 0.4, 11, 5);
  // Torso: sunset-orange shirt.
  ctx.fillStyle = p.hurtFlash > 0 ? '#ff5a4d' : '#e2703a';
  ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8542a';
  ctx.beginPath(); ctx.arc(-2, 0, 7, 0, Math.PI * 2); ctx.fill();
  // Head.
  ctx.fillStyle = '#c98d64';
  ctx.beginPath(); ctx.arc(3, 0, 5.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#26221f';
  ctx.beginPath(); ctx.arc(1.6, 0, 5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.restore();

  // Aim line toward the mouse while on foot.
  if (G.mode === 'playing') {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.aimAngle) * 16, p.y + Math.sin(p.aimAngle) * 16);
    ctx.lineTo(p.x + Math.cos(p.aimAngle) * 30, p.y + Math.sin(p.aimAngle) * 30);
    ctx.stroke();
  }
}

export function nearestInteractCar(G) {
  const p = G.player;
  if (p.car) return p.car;
  let best = null;
  let bestD = 58;
  for (const car of [...G.vehicles, ...G.policeCars]) {
    if (car.wrecked) continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export { clamp };
