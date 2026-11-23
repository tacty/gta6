// combat.js — mouse-aimed shooting while on foot. Click or hold F to fire;
// bullets fly, hit pedestrians and police, spark off buildings and cars.
// Gunfire is a crime: witnesses raise the wanted level and everyone nearby
// panics.

import { dist } from './world.js';
import { damageCar } from './vehicles.js';
import { damagePlayer } from './player.js';

const FIRE_INTERVAL = 0.16;
const BULLET_SPEED = 780;
const BULLET_RANGE = 430;

export function createCombat() {
  return { cooldown: 0, muzzle: 0 };
}

export function updateCombat(G, dt) {
  const p = G.player;
  const c = G.combat;
  c.cooldown -= dt;
  if (c.muzzle > 0) c.muzzle -= dt;

  // Aim from the player toward the mouse (world space).
  if (!p.car) {
    const wx = G.camera.x - G.viewW / 2 + G.input.mouseX;
    const wy = G.camera.y - G.viewH / 2 + G.input.mouseY;
    p.aimAngle = Math.atan2(wy - p.y, wx - p.x);
  }

  const firing = !p.car && (G.input.mouseDown || G.input.down('KeyF'));
  if (firing && c.cooldown <= 0 && G.mode === 'playing') {
    c.cooldown = FIRE_INTERVAL;
    c.muzzle = 0.05;
    const spread = (G.rand() - 0.5) * 0.05;
    const a = p.aimAngle + spread;
    G.bullets.push({
      x: p.x + Math.cos(p.aimAngle) * 18,
      y: p.y + Math.sin(p.aimAngle) * 18,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      life: BULLET_RANGE / BULLET_SPEED,
      fromPlayer: true,
    });
    G.audio.shot();
    G.commitCrime('gunfire', p.x, p.y);
    G.dangerPos = { x: p.x, y: p.y, radius: 260 };
    G.dangerTimer = 1.2;
    p.angle = p.aimAngle;
  }

  // Police shoot back at high wanted levels when the player is on foot.
  if (G.wanted >= 3 && !p.car) {
    for (const cop of G.policeCars) {
      if (cop.wrecked) continue;
      const d = dist(cop.x, cop.y, p.x, p.y);
      if (d < 300 && d > 60 && G.rand() < dt * 0.55) {
        const a = Math.atan2(p.y - cop.y, p.x - cop.x) + (G.rand() - 0.5) * 0.16;
        G.bullets.push({
          x: cop.x + Math.cos(a) * 26,
          y: cop.y + Math.sin(a) * 26,
          vx: Math.cos(a) * BULLET_SPEED * 0.9,
          vy: Math.sin(a) * BULLET_SPEED * 0.9,
          life: BULLET_RANGE / BULLET_SPEED,
          fromPlayer: false,
        });
        G.audio.shot();
      }
    }
  }

  // Advance bullets and resolve hits.
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let spent = b.life <= 0;
    if (!spent && G.world.buildingAt(b.x, b.y)) {
      G.spawnSparks(b.x, b.y, 3);
      spent = true;
    }
    if (!spent && b.fromPlayer) {
      for (const ped of G.peds) {
        if (ped.dead) continue;
        if (dist(b.x, b.y, ped.x, ped.y) < 12) {
          hurtPed(G, ped, 30);
          spent = true;
          break;
        }
      }
      if (!spent) {
        for (const car of [...G.vehicles, ...G.policeCars]) {
          if (dist(b.x, b.y, car.x, car.y) < 26) {
            damageCar(G, car, 16);
            G.spawnSparks(b.x, b.y, 4);
            if (car.kind === 'police') G.commitCrime('assault', b.x, b.y);
            spent = true;
            break;
          }
        }
      }
    } else if (!spent && !b.fromPlayer) {
      if (dist(b.x, b.y, p.x, p.y) < 13) {
        damagePlayer(G, 7);
        spent = true;
      }
    }
    if (spent) G.bullets.splice(i, 1);
  }
}

export function hurtPed(G, ped, amount) {
  ped.health -= amount;
  ped.panic = 3;
  G.audio.hit();
  if (ped.health <= 0 && !ped.dead) {
    ped.dead = true;
    G.commitCrime('assault', ped.x, ped.y);
  }
}

export function drawBullets(ctx, G) {
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (const b of G.bullets) {
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
  }
  ctx.stroke();
  // Muzzle flash.
  const p = G.player;
  if (G.combat.muzzle > 0 && !p.car) {
    ctx.fillStyle = 'rgba(255,200,80,0.9)';
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(p.aimAngle) * 22, p.y + Math.sin(p.aimAngle) * 22, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}
