// pedestrians.js — Solmar's citizens: they stroll along sidewalks, cross at
// corners, chat in pairs, and run screaming from danger (gunfire, reckless
// cars, a sprinting Marco with a smoking wreck nearby).

import { ROAD_CENTERS, ROAD_HALF, BEACH_Y, clamp } from './world.js';

const SHIRTS = ['#4fb3b0', '#f2f0e6', '#e8b04b', '#7a5fb0', '#39b06b', '#d9708a', '#5b84c4', '#eeeeee'];
const PANTS = ['#2d3a55', '#5a4632', '#333333', '#74655a', '#28418c'];

let nextId = 1;

export function createPed(x, y, rand) {
  return {
    id: nextId++,
    x, y,
    angle: rand() * Math.PI * 2,
    speed: 34 + rand() * 30,
    shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
    pants: PANTS[Math.floor(rand() * PANTS.length)],
    skin: ['#e8b98d', '#c98d64', '#8a5a3b', '#f0c8a0'][Math.floor(rand() * 4)],
    walkCycle: rand() * 6,
    state: 'walk',          // walk | flee | down
    panic: 0,
    health: 30,
    dead: false,
    turnTimer: 1 + rand() * 3,
    targetX: x,
    targetY: y,
  };
}

export function spawnPeds(G, count) {
  const rand = G.rand;
  for (let i = 0; i < count; i++) {
    // Place near a road edge (sidewalk) somewhere in the city.
    const vertical = rand() < 0.5;
    const c = ROAD_CENTERS[Math.floor(rand() * ROAD_CENTERS.length)];
    const along = 90 + rand() * 1850;
    const side = rand() < 0.5 ? -1 : 1;
    const x = vertical ? c + side * (ROAD_HALF + 16) : along;
    const y = vertical ? along : c + side * (ROAD_HALF + 16);
    if (y > BEACH_Y - 20) continue;
    if (G.world.buildingAt(x, y, 6)) continue;
    const ped = createPed(x, y, rand);
    pickTarget(G, ped);
    G.peds.push(ped);
  }
}

function pickTarget(G, ped) {
  // Wander to another sidewalk point a block or two away.
  const rand = G.rand;
  ped.targetX = clamp(ped.x + (rand() - 0.5) * 520, 40, G.world.size - 40);
  ped.targetY = clamp(ped.y + (rand() - 0.5) * 520, 40, BEACH_Y + 120);
  ped.turnTimer = 4 + rand() * 5;
}

export function updatePeds(G, dt) {
  const danger = G.dangerPos; // {x, y, radius} set by combat / crashes, or null
  for (const ped of G.peds) {
    if (ped.dead) continue;
    // Flee from danger or a fast-approaching car.
    let fleeX = 0;
    let fleeY = 0;
    let fleeing = ped.panic > 0;
    if (ped.panic > 0) ped.panic -= dt;
    if (danger && Math.hypot(ped.x - danger.x, ped.y - danger.y) < danger.radius) fleeing = true;
    const threat = fleeing ? (danger || G.playerPos()) : null;
    if (threat) {
      fleeX = ped.x - threat.x;
      fleeY = ped.y - threat.y;
    }
    if (G.player.car && Math.abs(G.player.car.speed) > 130
      && Math.hypot(ped.x - G.player.car.x, ped.y - G.player.car.y) < 110) {
      fleeing = true;
      fleeX = ped.x - G.player.car.x;
      fleeY = ped.y - G.player.car.y;
    }

    let vx = 0;
    let vy = 0;
    if (fleeing) {
      const len = Math.hypot(fleeX, fleeY) || 1;
      vx = (fleeX / len) * 175;
      vy = (fleeY / len) * 175;
      ped.state = 'flee';
    } else {
      ped.state = 'walk';
      ped.turnTimer -= dt;
      const dx = ped.targetX - ped.x;
      const dy = ped.targetY - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < 14 || ped.turnTimer <= 0) pickTarget(G, ped);
      else { vx = (dx / d) * ped.speed; vy = (dy / d) * ped.speed; }
    }
    if (vx !== 0 || vy !== 0) {
      ped.angle = Math.atan2(vy, vx);
      ped.walkCycle += dt * (ped.state === 'flee' ? 14 : 7);
    }
    ped.x += vx * dt;
    ped.y += vy * dt;
    if (ped.y > 2236) ped.y = 2236;
    G.world.collideCircle(ped, 10);
  }
}

export function drawPed(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(50,25,30,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 4, 10, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  if (ped.dead) {
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = ped.shirt;
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath(); ctx.arc(7, 0, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const swing = Math.sin(ped.walkCycle) * 4;
  ctx.rotate(ped.angle);
  ctx.fillStyle = ped.pants;
  ctx.fillRect(-1, -6.5 + swing * 0.35, 9, 4.2);
  ctx.fillRect(-1, 2.3 - swing * 0.35, 9, 4.2);
  ctx.fillStyle = ped.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 8.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath(); ctx.arc(2.4, 0, 4.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (ped.state === 'flee' && !ped.dead) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', ped.x, ped.y - 16);
  }
}
