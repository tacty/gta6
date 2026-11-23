// police.js — the wanted system and police pursuit AI.
// Stars 1-5 rise when crimes are witnessed and fall while the player stays
// out of police sight. Police cars spawn just off-screen, chase, and try to
// ram or box in the player. If they pin a slow player long enough: busted.

import { clamp, dist } from './world.js';
import { createCar, damageCar } from './vehicles.js';

export const MAX_WANTED = 5;
// How many police cars each star level fields at once.
const COPS_BY_STAR = [0, 1, 2, 3, 4, 6];

export function wantedTarget(wanted) {
  return COPS_BY_STAR[clamp(Math.floor(wanted), 0, MAX_WANTED)];
}

// Called by gameplay code when the player does something illegal.
// severity: stars to add if a witness (pedestrian or cop) can see it.
export function commitCrime(G, kind, x, y) {
  const severity = {
    carjacking: 1,
    gunfire: 1,
    hitandrun: 1,
    assault: 1,
    copcrash: 1,
  }[kind] || 1;
  const witnessed = G.policeCars.some((c) => dist(c.x, c.y, x, y) < 460)
    || G.peds.some((p) => !p.dead && dist(p.x, p.y, x, y) < 230);
  if (witnessed || G.wanted > 0) {
    setWanted(G, G.wanted + severity);
    G.hideTimer = 0;
    if (kind === 'gunfire' || kind === 'hitandrun') G.showToast(kind === 'gunfire' ? 'Shots fired — the heat is on!' : 'Hit and run!');
  }
  // Nearby pedestrians panic either way.
  for (const p of G.peds) {
    if (!p.dead && dist(p.x, p.y, x, y) < 200) p.panic = 2.5;
  }
}

export function setWanted(G, level) {
  G.wanted = clamp(level, 0, MAX_WANTED);
}

function spawnCop(G) {
  const p = G.playerPos();
  // Spawn on a road just outside the camera view.
  for (let tries = 0; tries < 12; tries++) {
    const a = G.rand() * Math.PI * 2;
    const d = 560 + G.rand() * 160;
    const x = clamp(p.x + Math.cos(a) * d, 60, G.world.size - 60);
    const y = clamp(p.y + Math.sin(a) * d, 60, 2100);
    if (G.world.buildingAt(x, y, 30)) continue;
    const cop = createCar(x, y, Math.atan2(p.y - y, p.x - x), { kind: 'police', driver: 'police', color: '#20242e' });
    cop.cruise = 300;
    G.policeCars.push(cop);
    return;
  }
}

export function updatePolice(G, dt) {
  const p = G.player;
  const target = G.playerPos();

  // Spawning to match the wanted level.
  G.copSpawnTimer -= dt;
  if (G.wanted > 0 && G.policeCars.length < wantedTarget(G.wanted) && G.copSpawnTimer <= 0) {
    spawnCop(G);
    G.copSpawnTimer = 2.2;
  }

  // Visibility: any cop with a clear-ish line (just distance) sees the player.
  let seen = false;
  for (const cop of G.policeCars) {
    if (!cop.wrecked && dist(cop.x, cop.y, target.x, target.y) < 430) seen = true;
  }
  if (seen) G.hideTimer = 0;
  else if (G.wanted > 0) {
    G.hideTimer += dt;
    const coolTime = 7 + G.wanted * 2.2; // higher stars take longer to shake
    if (G.hideTimer > coolTime) {
      setWanted(G, G.wanted - 1);
      G.hideTimer = 0;
      if (G.wanted === 0) G.showToast('You lost the cops.');
      else G.showToast('The heat is cooling…');
    }
  }

  // Pursuit steering: aim at a point slightly ahead of the player.
  const aggression = 200 + G.wanted * 42;
  for (const cop of G.policeCars) {
    if (cop.wrecked) continue;
    if (cop.driver === 'player') continue;
    const lead = 0.35;
    const tx = target.x + (p.car ? Math.cos(p.car.angle) * p.car.speed * lead : 0);
    const ty = target.y + (p.car ? Math.sin(p.car.angle) * p.car.speed * lead : 0);
    const desired = Math.atan2(ty - cop.y, tx - cop.x);
    let diff = desired - cop.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cop.angle += clamp(diff, -2.6 * dt, 2.6 * dt);
    const d = dist(cop.x, cop.y, target.x, target.y);
    const topSpeed = d > 320 ? aggression + 90 : aggression;
    cop.speed += clamp(topSpeed - cop.speed, -260 * dt, 190 * dt);
    if (G.wanted === 0) cop.speed = Math.max(0, cop.speed - 200 * dt); // give up

    const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
    const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
    if (!G.world.rectHitsBuilding(nx, ny, 18, 9) && ny < 2230) {
      cop.x = clamp(nx, 26, G.world.size - 26);
      cop.y = clamp(ny, 26, G.world.size - 26);
    } else {
      cop.angle += 1.4 * dt; // scrape along the wall and turn away
      cop.speed *= 0.5;
    }
    // Ramming contact with the player's car.
    if (p.car && dist(cop.x, cop.y, p.car.x, p.car.y) < 40) {
      if (Math.abs(cop.speed) > 120) {
        damageCar(G, p.car, 9);
        G.shake(0.35);
        G.audio.crash(0.8);
      }
      p.car.speed *= 0.55;
      cop.speed *= 0.4;
    }
    if (!p.car && dist(cop.x, cop.y, p.x, p.y) < 26) {
      // Cop on foot contact — they shove Marco.
      if (cop.speed > 60) { /* police cars stay cars; contact handled by bust meter */ }
    }
  }

  // Remove distant wrecked / surplus cops, and all cops once heat is gone.
  G.policeCars = G.policeCars.filter((cop) => {
    const d = dist(cop.x, cop.y, target.x, target.y);
    if (G.wanted === 0 && d > 700) return false;
    if (cop.wrecked && d > 700) return false;
    return true;
  });

  // Bust meter: surrounded while slow with stars up.
  const playerSpeed = p.car ? Math.abs(p.car.speed) : Math.hypot(p.vx, p.vy);
  const nearCops = G.policeCars.filter((c) => !c.wrecked && dist(c.x, c.y, target.x, target.y) < 95).length;
  if (G.wanted > 0 && nearCops >= 1 && playerSpeed < 26) {
    G.bustMeter += dt * (nearCops >= 2 ? 1.5 : 0.8);
    if (G.bustMeter > 2.4) G.onPlayerDown('busted');
  } else {
    G.bustMeter = Math.max(0, G.bustMeter - dt * 1.4);
  }

  G.audio.setSiren(G.wanted > 0 && G.policeCars.length > 0);
}
