// world.js — the city of Solmar: generation, collision and drawing.
// A ~2400x2400 top-down world. A grid of roads, blocks of buildings with
// different colours and heights, a beach and the sea along the south edge,
// palm trees, and three named districts. Everything is drawn with canvas
// primitives — no external assets.

export const WORLD_SIZE = 2400;
export const ROAD_CENTERS = [200, 600, 1000, 1400, 1800, 2200];
export const ROAD_HALF = 52;          // half the road width
export const BEACH_Y = 2060;          // sand starts here
export const SEA_Y = 2240;            // water starts here

const BUILDING_COLORS = [
  '#e8b04b', '#d97b4f', '#c95d63', '#7fb3b0', '#e5d3a1', '#b08968',
  '#88a0c0', '#dda15e', '#bc6c25', '#90be6d', '#f4a261', '#a8dadc',
];

// Small deterministic PRNG (mulberry32) so a seed always builds the same city.
export function createRandom(seed) {
  let a = (seed >>> 0) || 1;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function nearRoad(v) {
  return ROAD_CENTERS.some((c) => Math.abs(v - c) <= ROAD_HALF + 26);
}

export function createWorld(seed) {
  const rand = createRandom(seed);
  const buildings = [];
  const palms = [];

  // Buildings fill each block between roads, north of the beach.
  for (let bx = 0; bx < 6; bx++) {
    for (let by = 0; by < 5; by++) {
      const x0 = bx === 0 ? 60 : ROAD_CENTERS[bx - 1] + ROAD_HALF + 18;
      const x1 = ROAD_CENTERS[bx] - ROAD_HALF - 18;
      const y0 = by === 0 ? 60 : ROAD_CENTERS[by - 1] + ROAD_HALF + 18;
      const y1 = ROAD_CENTERS[by] - ROAD_HALF - 18;
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 90 || h < 90) continue;
      const split = rand() < 0.5;
      const count = split ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const pad = 10;
        let rect;
        if (!split) rect = { x: x0 + pad, y: y0 + pad, w: w - pad * 2, h: h - pad * 2 };
        else if (bx % 2 === 0) {
          const hw = (w - pad * 3) / 2;
          rect = { x: x0 + pad + i * (hw + pad), y: y0 + pad, w: hw, h: h - pad * 2 };
        } else {
          const hh = (h - pad * 3) / 2;
          rect = { x: x0 + pad, y: y0 + pad + i * (hh + pad), w: w - pad * 2, h: hh };
        }
        rect.color = BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)];
        rect.height = 14 + Math.floor(rand() * 30); // fake height -> shadow length
        rect.roof = rand() < 0.3 ? '#8a5a44' : null;
        buildings.push(rect);
      }
    }
  }

  // Palms: rows along the beach and scattered on sidewalks / parks.
  for (let x = 90; x < WORLD_SIZE - 60; x += 110 + rand() * 60) {
    palms.push({ x, y: BEACH_Y + 46 + rand() * 60, s: 0.85 + rand() * 0.5 });
  }
  for (let i = 0; i < 90; i++) {
    const x = 40 + rand() * (WORLD_SIZE - 80);
    const y = 40 + rand() * (BEACH_Y - 80);
    if (nearRoad(x) || nearRoad(y)) palms.push({ x, y, s: 0.7 + rand() * 0.5 });
  }

  const world = {
    size: WORLD_SIZE,
    buildings,
    palms,
    districts: [
      { name: 'DOWNTOWN SOLMAR', x: 1000, y: 700 },
      { name: 'PALM DISTRICT', x: 1900, y: 900 },
      { name: 'MARINA', x: 900, y: 1980 },
    ],
    garage: { x: 1000, y: 1060, label: 'Lucia’s Garage' },
    harbor: { x: 1500, y: 2160, label: 'Solmar Harbor' },
    hospital: { x: 600, y: 340, label: 'Solmar General' },
    station: { x: 1400, y: 340, label: 'Solmar PD' },
    playerSpawn: { x: 1000, y: 1180 },

    isWater(x, y) { return y > SEA_Y; },
    isBeach(x, y) { return y > BEACH_Y && y <= SEA_Y; },
    isRoad(x, y) {
      if (y > BEACH_Y) return false;
      return ROAD_CENTERS.some((c) => Math.abs(x - c) <= ROAD_HALF)
        || ROAD_CENTERS.some((c) => Math.abs(y - c) <= ROAD_HALF);
    },
    districtAt(x, y) {
      if (y > BEACH_Y) return 'MARINA';
      if (x > 1500 && y < 1500) return 'PALM DISTRICT';
      return 'DOWNTOWN SOLMAR';
    },
    buildingAt(x, y, pad = 0) {
      for (const b of buildings) {
        if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
      }
      return null;
    },
    // Push a circle (entity) out of every building and keep it in the world.
    collideCircle(pos, r) {
      pos.x = clamp(pos.x, r, WORLD_SIZE - r);
      pos.y = clamp(pos.y, r, WORLD_SIZE - r);
      for (const b of buildings) {
        const nx = clamp(pos.x, b.x, b.x + b.w);
        const ny = clamp(pos.y, b.y, b.y + b.h);
        const dx = pos.x - nx;
        const dy = pos.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          if (d2 === 0) { pos.y = b.y - r; continue; }
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * r;
          pos.y = ny + (dy / d) * r;
        }
      }
    },
    // Rectangle (car) vs buildings: sample the four corners; returns true on hit.
    rectHitsBuilding(x, y, hw, hh) {
      const pts = [[x - hw, y - hh], [x + hw, y - hh], [x - hw, y + hh], [x + hw, y + hh]];
      return pts.some(([px, py]) => this.buildingAt(px, py) !== null);
    },
  };
  return world;
}

// ---------------------------------------------------------------- drawing

export function drawWorld(ctx, world, cam, viewW, viewH, time) {
  const x0 = cam.x - viewW / 2 - 40;
  const y0 = cam.y - viewH / 2 - 40;
  const x1 = cam.x + viewW / 2 + 40;
  const y1 = cam.y + viewH / 2 + 40;

  // Ground: warm city blocks / pavement base.
  ctx.fillStyle = '#cbb98a';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Beach and sea (south edge).
  if (y1 > BEACH_Y) {
    ctx.fillStyle = '#eed9a0';
    ctx.fillRect(x0, BEACH_Y, x1 - x0, SEA_Y - BEACH_Y);
    const grad = ctx.createLinearGradient(0, SEA_Y, 0, WORLD_SIZE);
    grad.addColorStop(0, '#3d9db8');
    grad.addColorStop(1, '#1d5f7a');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, SEA_Y, x1 - x0, WORLD_SIZE - SEA_Y);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) {
      const yy = SEA_Y + 26 + Math.sin(time * 1.4 + x * 0.05) * 5;
      ctx.moveTo(x, yy);
      ctx.lineTo(x + 44, yy);
    }
    ctx.stroke();
    // Harbor pier near the marina.
    ctx.fillStyle = '#8a6f4d';
    ctx.fillRect(world.harbor.x - 90, SEA_Y - 6, 180, 16);
    ctx.fillRect(world.harbor.x - 14, SEA_Y - 60, 28, 60);
  }

  // Roads: asphalt with sidewalk borders and dashed centre lines.
  ctx.fillStyle = '#9c8f74';
  for (const c of ROAD_CENTERS) {
    ctx.fillRect(c - ROAD_HALF - 10, 0, (ROAD_HALF + 10) * 2, BEACH_Y);
    ctx.fillRect(0, c - ROAD_HALF - 10, WORLD_SIZE, (ROAD_HALF + 10) * 2);
  }
  ctx.fillStyle = '#4a4550';
  for (const c of ROAD_CENTERS) {
    ctx.fillRect(c - ROAD_HALF, 0, ROAD_HALF * 2, BEACH_Y);
    ctx.fillRect(0, c - ROAD_HALF, WORLD_SIZE, ROAD_HALF * 2);
  }
  ctx.strokeStyle = 'rgba(250,220,130,0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  ctx.beginPath();
  for (const c of ROAD_CENTERS) {
    ctx.moveTo(c, 0); ctx.lineTo(c, BEACH_Y);
    ctx.moveTo(0, c); ctx.lineTo(WORLD_SIZE, c);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Buildings with sunset shadows.
  for (const b of world.buildings) {
    if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
    const sh = b.height * 0.55;
    ctx.fillStyle = 'rgba(60,30,40,0.35)';
    ctx.fillRect(b.x + sh, b.y + sh * 0.7, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof || 'rgba(255,255,255,0.14)';
    ctx.fillRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
    ctx.strokeStyle = 'rgba(40,20,30,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    // Window dots catch the evening light.
    ctx.fillStyle = 'rgba(255,230,160,0.5)';
    const step = 26;
    for (let wx = b.x + 14; wx < b.x + b.w - 10; wx += step) {
      for (let wy = b.y + 14; wy < b.y + b.h - 10; wy += step) {
        if ((wx * 7 + wy * 13) % 3 === 0) ctx.fillRect(wx, wy, 5, 5);
      }
    }
  }

  // Landmark pads.
  drawPad(ctx, world.garage, '#ffd166', 'G');
  drawPad(ctx, world.harbor, '#7fd4ff', 'H');
  drawPad(ctx, world.hospital, '#ffffff', '+');
  drawPad(ctx, world.station, '#6ea8ff', 'PD');

  // Palm trees.
  for (const p of world.palms) {
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    drawPalm(ctx, p.x, p.y, p.s);
  }

  // District names painted on the ground.
  ctx.fillStyle = 'rgba(90,50,40,0.4)';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const d of world.districts) {
    if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) ctx.fillText(d.name, d.x, d.y);
  }
}

function drawPad(ctx, place, color, mark) {
  ctx.fillStyle = 'rgba(30,25,35,0.55)';
  ctx.fillRect(place.x - 42, place.y - 42, 84, 84);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(place.x - 42, place.y - 42, 84, 84);
  ctx.fillStyle = color;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(mark, place.x, place.y + 9);
}

export function drawPalm(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(60,40,30,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 8 * s, y + 6 * s, 17 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 4 * s;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3 * s, y - 8 * s); ctx.stroke();
  ctx.strokeStyle = '#3f9e4d';
  ctx.lineWidth = 3.4 * s;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(x + 3 * s, y - 8 * s);
    ctx.quadraticCurveTo(
      x + 3 * s + Math.cos(a) * 13 * s, y - 8 * s + Math.sin(a) * 10 * s - 4,
      x + 3 * s + Math.cos(a) * 19 * s, y - 8 * s + Math.sin(a) * 15 * s + 3,
    );
    ctx.stroke();
  }
}
