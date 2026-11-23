// vehicles.js — car physics, traffic AI and parked cars.
// Player driving: acceleration, braking/reverse, speed-sensitive steering,
// handbrake drift. Traffic: cars follow road lanes (right-hand traffic),
// stop for obstacles ahead, and pick a new direction at intersections.

import { ROAD_CENTERS, ROAD_HALF, BEACH_Y, clamp, dist } from './world.js';

export const CAR_COLORS = [
  '#d94f3d', '#3d7bd9', '#f2f0e6', '#39b06b', '#e8b04b', '#7a5fb0',
  '#22242c', '#c0c6ce', '#e2703a', '#4fb3b0',
];

let nextId = 1;

export function createCar(x, y, angle, opts = {}) {
  return {
    id: nextId++,
    x, y, angle,
    speed: 0,
    steer: 0,
    w: 46, h: 22,           // footprint (length x width)
    color: opts.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    kind: opts.kind || 'civilian',   // civilian | police
    driver: opts.driver || null,     // null | 'traffic' | 'player'
    parked: !!opts.parked,
    stolen: !!opts.stolen,
    health: 100,
    wrecked: false,
    // traffic AI state
    dirX: Math.round(Math.cos(angle)),
    dirY: Math.round(Math.sin(angle)),
    cruise: 120 + Math.random() * 60,
    honk: 0,
  };
}

function snapDir(car) {
  // Keep traffic aligned to the grid: direction is one of the 4 cardinals.
  const a = Math.atan2(car.dirY, car.dirX);
  const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  car.dirX = Math.round(Math.cos(q));
  car.dirY = Math.round(Math.sin(q));
  car.angle = q;
}

function nearestCenter(v) {
  let best = ROAD_CENTERS[0];
  for (const c of ROAD_CENTERS) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  return best;
}

// Put a fresh traffic car onto the nearest lane to (x, y).
export function placeOnRoad(car, world) {
  const cx = nearestCenter(car.x);
  const cy = nearestCenter(car.y);
  if (Math.abs(car.x - cx) < Math.abs(car.y - cy)) {
    // vertical road: travel along y, lane offset to the right of travel
    car.dirX = 0;
    car.dirY = Math.random() < 0.5 ? 1 : -1;
    car.x = cx + (car.dirY > 0 ? 24 : -24);
  } else {
    car.dirY = 0;
    car.dirX = Math.random() < 0.5 ? 1 : -1;
    car.y = cy + (car.dirX > 0 ? -24 : 24);
  }
  snapDir(car);
  car.speed = car.cruise * 0.7;
}

export function spawnTraffic(G, count) {
  const rand = G.rand;
  for (let i = 0; i < count; i++) {
    const onVertical = rand() < 0.5;
    const c = ROAD_CENTERS[Math.floor(rand() * ROAD_CENTERS.length)];
    const along = 120 + rand() * 1700;
    const car = createCar(onVertical ? c : along, onVertical ? along : c, 0, { driver: 'traffic' });
    placeOnRoad(car, G.world);
    if (onVertical) car.y = along; else car.x = along;
    if (!G.world.buildingAt(car.x, car.y, 30)) G.vehicles.push(car);
  }
}

export function spawnParked(G, count) {
  const rand = G.rand;
  for (let i = 0; i < count; i++) {
    const vertical = rand() < 0.5;
    const c = ROAD_CENTERS[Math.floor(rand() * ROAD_CENTERS.length)];
    const along = 100 + rand() * 1800;
    const side = rand() < 0.5 ? -1 : 1;
    const x = vertical ? c + side * (ROAD_HALF - 14) : along;
    const y = vertical ? along : c + side * (ROAD_HALF - 14);
    if (y > BEACH_Y - 40) continue;
    const car = createCar(x, y, vertical ? Math.PI / 2 : 0, { parked: true, stolen: true });
    G.vehicles.push(car);
  }
}

// ------------------------------------------------------------- player car

export function updatePlayerCar(G, dt) {
  const car = G.player.car;
  if (!car) return;
  const input = G.input;
  const fwd = input.down('KeyW') || input.down('ArrowUp');
  const back = input.down('KeyS') || input.down('ArrowDown');
  const left = input.down('KeyA') || input.down('ArrowLeft');
  const right = input.down('KeyD') || input.down('ArrowRight');
  const hand = input.down('Space');

  const maxSpeed = 335;
  const accel = 260;
  if (fwd) car.speed += accel * dt;
  else if (back) {
    if (car.speed > 12) car.speed -= 420 * dt;         // brake
    else car.speed -= accel * 0.55 * dt;               // reverse
  } else {
    car.speed -= car.speed * (hand ? 2.6 : 0.7) * dt;  // drag / handbrake
    if (Math.abs(car.speed) < 2) car.speed = 0;
  }
  car.speed = clamp(car.speed, -120, maxSpeed);

  const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 9);
  const grip = hand ? 1.7 : 1;
  if (car.speed !== 0) {
    car.angle += car.steer * 1.85 * grip * dt * clamp(car.speed / 130, -1, 1);
  }
  moveCar(G, car, dt, true);
  G.audio.setEngine(true, Math.abs(car.speed) / maxSpeed);

  // Skid marks and dust while drifting or launching.
  if ((hand && Math.abs(car.speed) > 60) || (fwd && Math.abs(car.speed) < 40 && car.speed !== 0)) {
    addSkid(G, car);
  }
  if (Math.abs(car.speed) > 40 && G.world.isBeach(car.x, car.y)) {
    G.spawnDust(car.x, car.y, 1);
  }
}

function addSkid(G, car) {
  const back = 16;
  const side = 9;
  for (const s of [-1, 1]) {
    G.skids.push({
      x: car.x - Math.cos(car.angle) * back + Math.cos(car.angle + Math.PI / 2) * side * s,
      y: car.y - Math.sin(car.angle) * back + Math.sin(car.angle + Math.PI / 2) * side * s,
      life: 5,
    });
  }
  if (G.skids.length > 500) G.skids.splice(0, G.skids.length - 500);
}

// Shared movement + building collision + car-car / car-pedestrian contact.
export function moveCar(G, car, dt, isPlayer = false) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const hw = car.w / 2;
  const hh = car.h / 2;
  if (G.world.rectHitsBuilding(nx, ny, hw * 0.8, hh * 0.8) || ny > 2230) {
    if (Math.abs(car.speed) > 90) {
      G.onCarCrash(car, Math.abs(car.speed));
    }
    car.speed = -car.speed * 0.25;
    return;
  }
  car.x = clamp(nx, 30, G.world.size - 30);
  car.y = clamp(ny, 30, G.world.size - 30);

  // Contact with other cars: simple push + damage + crash event.
  const others = [...G.vehicles, ...G.policeCars];
  for (const other of others) {
    if (other === car) continue;
    const d = dist(car.x, car.y, other.x, other.y);
    if (d < 40 && d > 0) {
      const push = (40 - d) / 2;
      const ux = (other.x - car.x) / d;
      const uy = (other.y - car.y) / d;
      other.x += ux * push;
      other.y += uy * push;
      if (Math.abs(car.speed) > 110) {
        damageCar(G, other, 12);
        damageCar(G, car, 7);
        G.onCarCrash(car, Math.abs(car.speed), other);
        car.speed *= 0.45;
      }
    }
  }

  // Running over a pedestrian is a serious crime.
  if (Math.abs(car.speed) > 30) {
    for (const ped of G.peds) {
      if (ped.dead) continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 24) {
        G.hitPedestrian(ped, car);
        if (isPlayer) G.commitCrime('hitandrun', car.x, car.y);
        car.speed *= 0.82;
      }
    }
  }
}

export function damageCar(G, car, amount) {
  car.health -= amount;
  if (car.health <= 0 && !car.wrecked) {
    car.wrecked = true;
    car.speed = 0;
    G.spawnDust(car.x, car.y, 10);
    if (G.player.car === car) {
      // Forced out of the wreck.
      G.player.car = null;
      car.driver = null;
      G.player.x = car.x + 34;
      G.player.y = car.y;
      G.world.collideCircle(G.player, 13);
    }
  }
}

// ------------------------------------------------------------- traffic AI

function obstacleAhead(G, car) {
  const look = 66;
  const ax = car.x + car.dirX * look;
  const ay = car.y + car.dirY * look;
  const targets = [...G.vehicles, ...G.policeCars];
  for (const other of targets) {
    if (other === car) continue;
    if (dist(ax, ay, other.x, other.y) < 34) return true;
  }
  if (G.player.car) {
    if (dist(ax, ay, G.player.car.x, G.player.car.y) < 36) return true;
  } else if (dist(ax, ay, G.player.x, G.player.y) < 26) return true;
  for (const ped of G.peds) {
    if (!ped.dead && dist(ax, ay, ped.x, ped.y) < 22) return true;
  }
  return G.world.buildingAt(ax, ay, 6) !== null;
}

export function updateTraffic(G, dt) {
  for (const car of G.vehicles) {
    if (car.driver !== 'traffic' || car.wrecked) continue;
    const blocked = obstacleAhead(G, car);
    const target = blocked ? 0 : car.cruise;
    car.speed += clamp(target - car.speed, -300 * dt, 140 * dt);
    if (car.speed > 4) {
      car.x += car.dirX * car.speed * dt;
      car.y += car.dirY * car.speed * dt;
      // Lane keeping: drift back to the lane centre line.
      if (car.dirX !== 0) {
        const cy = nearestCenter(car.y) + (car.dirX > 0 ? -24 : 24);
        car.y += clamp(cy - car.y, -40 * dt, 40 * dt);
      } else {
        const cx = nearestCenter(car.x) + (car.dirY > 0 ? 24 : -24);
        car.x += clamp(cx - car.x, -40 * dt, 40 * dt);
      }
      maybeTurn(G, car);
    }
    if (car.y > BEACH_Y - 30 && car.dirY > 0) { car.dirY = -1; snapDir(car); }
    if (car.y < 70 && car.dirY < 0) { car.dirY = 1; snapDir(car); }
    if (car.x > G.world.size - 70 && car.dirX > 0) { car.dirX = -1; snapDir(car); }
    if (car.x < 70 && car.dirX < 0) { car.dirX = 1; snapDir(car); }
  }
}

function maybeTurn(G, car) {
  // At an intersection, sometimes turn onto the crossing road.
  const cx = nearestCenter(car.x);
  const cy = nearestCenter(car.y);
  const atCross = Math.abs(car.x - cx) < 8 && Math.abs(car.y - cy) < 8;
  if (!atCross || G.rand() > 0.012) return;
  if (car.dirX !== 0) { car.dirY = G.rand() < 0.5 ? 1 : -1; car.dirX = 0; }
  else { car.dirX = G.rand() < 0.5 ? 1 : -1; car.dirY = 0; }
  snapDir(car);
}

// ---------------------------------------------------------------- drawing

export function drawCar(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.fillStyle = 'rgba(50,25,30,0.35)';
  ctx.beginPath(); ctx.ellipse(5, 7, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(car.angle);
  const hw = car.w / 2;
  const hh = car.h / 2;
  // Wheels.
  ctx.fillStyle = '#17181c';
  for (const [wx, wy] of [[-hw + 9, -hh - 2], [hw - 9, -hh - 2], [-hw + 9, hh - 2], [hw - 9, hh - 2]]) {
    ctx.fillRect(wx - 5, wy, 10, 5);
  }
  // Body.
  ctx.fillStyle = car.wrecked ? '#3c3a3a' : car.color;
  roundRect(ctx, -hw, -hh, car.w, car.h, 6);
  ctx.fill();
  // Cabin / windshield.
  ctx.fillStyle = car.kind === 'police' ? '#eef2f5' : 'rgba(20,30,45,0.85)';
  roundRect(ctx, -7, -hh + 3.5, 17, car.h - 7, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,210,240,0.8)';
  ctx.fillRect(8, -hh + 4.5, 3.4, car.h - 9);
  // Headlights.
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(hw - 2.5, -hh + 3, 2.5, 4.5);
  ctx.fillRect(hw - 2.5, hh - 7.5, 2.5, 4.5);
  ctx.fillStyle = '#d23b2e';
  ctx.fillRect(-hw, -hh + 3, 2.5, 4.5);
  ctx.fillRect(-hw, hh - 7.5, 2.5, 4.5);
  if (car.kind === 'police') {
    ctx.fillStyle = '#20242e';
    ctx.fillRect(-hw, -4.5, car.w, 9);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('POLICE', 0, 3);
    // Light bar: alternating red/blue flash.
    const phase = Math.floor(time * 6) % 2 === 0;
    ctx.fillStyle = phase ? '#ff3b30' : '#5a3bff';
    ctx.fillRect(-4, -6, 8, 4.5);
    ctx.fillStyle = phase ? '#3b6bff' : '#ff3b30';
    ctx.fillRect(-4, 1.5, 8, 4.5);
  }
  if (car.wrecked) {
    ctx.fillStyle = 'rgba(20,20,20,0.5)';
    ctx.beginPath(); ctx.arc(hw - 8, 0, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
