// missions.js — Lucia's mission chain. Four linked jobs with on-screen
// objectives, world markers and minimap blips, cash rewards, and free roam
// afterwards. Progress is kept in G.mission = { index, stage, timer }.

import { dist } from './world.js';
import { createCar } from './vehicles.js';
import { setWanted } from './police.js';

export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    from: 'Lucia: Marco, I need wheels. There’s a marked convertible by Palm District — take it and bring it to my garage.',
    reward: 500,
  },
  {
    id: 'hot-pickup',
    title: 'Hot Pickup',
    from: 'Lucia: A package is waiting at the Marina. Grab it and get it to the garage — fast, and the cops will care.',
    reward: 900,
  },
  {
    id: 'harbor-run',
    title: 'Harbor Run',
    from: 'Lucia: Cargo’s loaded at the east warehouse. Deliver it to Solmar Harbor. Expect company.',
    reward: 1500,
  },
  {
    id: 'clean-getaway',
    title: 'Clean Getaway',
    from: 'Lucia: Last job went loud. Every cop in Solmar is looking for you — lose them and keep your head down.',
    reward: 2000,
  },
];

export function startMission(G, index) {
  const m = MISSIONS[index];
  G.mission.index = index;
  G.mission.stage = 0;
  G.mission.timer = 0;
  G.mission.done = false;
  G.showPhone(m.title, m.from);
  G.audio.phone();

  if (m.id === 'first-wheels') {
    // A marked stealable car in Palm District.
    const car = createCar(1830, 640, Math.PI / 2, { parked: true, stolen: true, color: '#d94f3d' });
    car.isMissionCar = true;
    G.vehicles.push(car);
    G.mission.carId = car.id;
  }
  if (m.id === 'clean-getaway') {
    setWanted(G, 4);
    G.hideTimer = 0;
  }
}

export function missionTarget(G) {
  // Returns {x, y, label} for the current objective, or null in free roam.
  const idx = G.mission.index;
  if (idx >= MISSIONS.length) return null;
  const m = MISSIONS[idx];
  const stage = G.mission.stage;
  switch (m.id) {
    case 'first-wheels': {
      if (stage === 0) {
        const car = G.vehicles.find((c) => c.id === G.mission.carId);
        return car ? { x: car.x, y: car.y, label: 'Steal the marked car' } : null;
      }
      return { ...G.world.garage, label: 'Deliver the car to Lucia’s garage' };
    }
    case 'hot-pickup':
      return stage === 0
        ? { x: 760, y: 2010, label: 'Pick up the package at the Marina' }
        : { ...G.world.garage, label: 'Deliver the package to the garage' };
    case 'harbor-run':
      return stage === 0
        ? { x: 2060, y: 1420, label: 'Collect the cargo at the east warehouse' }
        : { ...G.world.harbor, label: 'Deliver the cargo to Solmar Harbor' };
    case 'clean-getaway':
      return null; // objective is survival, not a place
    default:
      return null;
  }
}

export function objectiveText(G) {
  const idx = G.mission.index;
  if (idx >= MISSIONS.length) return 'Free roam — Lucia has no more jobs. Enjoy Solmar.';
  const m = MISSIONS[idx];
  const t = missionTarget(G);
  if (m.id === 'clean-getaway') {
    return `CLEAN GETAWAY: lose the police (wanted level ${G.wanted}) — break their line of sight and stay hidden.`;
  }
  let text = `${m.title.toUpperCase()}: ${t ? t.label : ''}`;
  if (m.id === 'hot-pickup' && G.mission.stage === 1 && G.mission.timer > 0) {
    text += ` — ${Math.ceil(G.mission.timer)}s left`;
  }
  return text;
}

function completeMission(G) {
  const m = MISSIONS[G.mission.index];
  G.money += m.reward;
  G.audio.cash();
  G.showPhone('Job done', `Lucia: Clean work, Marco. $${m.reward} wired to you.`);
  G.mission.index += 1;
  G.mission.stage = 0;
  G.mission.timer = 0;
  if (G.mission.index < MISSIONS.length) startMission(G, G.mission.index);
  else {
    G.mission.done = true;
    G.showToast('All of Lucia’s jobs complete — free roam!');
  }
  G.saveGame();
}

function failMission(G, why) {
  G.audio.fail();
  G.showPhone('Job failed', `Lucia: ${why} We run it again — get back out there.`);
  const idx = G.mission.index;
  // Remove a leftover mission car before restarting the job.
  G.vehicles = G.vehicles.filter((c) => !c.isMissionCar || G.player.car === c);
  startMission(G, idx);
}

export function updateMissions(G, dt) {
  const idx = G.mission.index;
  if (idx >= MISSIONS.length) return;
  const m = MISSIONS[idx];
  const p = G.player;
  const pos = G.playerPos();
  const stage = G.mission.stage;

  if (m.id === 'first-wheels') {
    if (stage === 0) {
      const car = G.vehicles.find((c) => c.id === G.mission.carId);
      if (!car) { failMission(G, 'The car is gone.'); return; }
      if (p.car === car) {
        G.mission.stage = 1;
        G.showToast('Got it — now deliver it to the garage.');
      } else if (car.wrecked) {
        failMission(G, 'You wrecked the wheels I asked for.');
        return;
      }
    } else if (stage === 1) {
      if (p.car && dist(pos.x, pos.y, G.world.garage.x, G.world.garage.y) < 62) completeMission(G);
    }
  }

  if (m.id === 'hot-pickup') {
    if (stage === 0) {
      if (dist(pos.x, pos.y, 760, 2010) < 55) {
        G.mission.stage = 1;
        G.mission.timer = 90;
        setWanted(G, Math.max(G.wanted, 2));
        G.audio.pickup();
        G.showToast('Package secured — the cops noticed. Move!');
      }
    } else {
      G.mission.timer -= dt;
      if (G.mission.timer <= 0) { failMission(G, 'Too slow — the buyer walked.'); return; }
      if (dist(pos.x, pos.y, G.world.garage.x, G.world.garage.y) < 62) completeMission(G);
    }
  }

  if (m.id === 'harbor-run') {
    if (stage === 0) {
      if (dist(pos.x, pos.y, 2060, 1420) < 60) {
        G.mission.stage = 1;
        setWanted(G, Math.max(G.wanted, 3));
        G.audio.pickup();
        G.showToast('Cargo loaded — every cop in Solmar is awake now.');
      }
    } else if (dist(pos.x, pos.y, G.world.harbor.x, G.world.harbor.y) < 70) {
      completeMission(G);
    }
  }

  if (m.id === 'clean-getaway') {
    if (G.wanted === 0) completeMission(G);
  }
}

// Pulsing objective marker in the world.
export function drawMissionMarker(ctx, G, time) {
  const t = missionTarget(G);
  if (!t || G.mode !== 'playing') return;
  const bob = Math.sin(time * 4) * 6;
  ctx.save();
  ctx.translate(t.x, t.y + bob);
  ctx.fillStyle = 'rgba(255, 209, 102, 0.25)';
  ctx.beginPath(); ctx.arc(0, -bob, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(-13, -8);
  ctx.lineTo(13, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a4d00';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', 0, 4);
  ctx.restore();
  // Beacon of light so the target is visible from afar.
  const grad = ctx.createLinearGradient(0, t.y - 260, 0, t.y);
  grad.addColorStop(0, 'rgba(255,209,102,0)');
  grad.addColorStop(1, 'rgba(255,209,102,0.20)');
  ctx.fillStyle = grad;
  ctx.fillRect(t.x - 9, t.y - 260, 18, 260);
}
