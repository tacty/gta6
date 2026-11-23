// hud.js — heads-up display: health, cash, wanted stars, mission objective,
// phone messages from Lucia, toasts, the bust meter, and the minimap.

import { clamp } from './world.js';
import { objectiveText, missionTarget } from './missions.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function bar(ctx, x, y, w, h, frac, color, bg = 'rgba(10,10,16,0.62)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}

export function drawHUD(ctx, G, viewW, viewH) {
  const p = G.player;
  ctx.save();
  ctx.font = `600 15px ${FONT}`;

  // Health + stamina (bottom-left).
  const bx = 18;
  const by = viewH - 58;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'left';
  ctx.fillText(p.car ? 'MARCO — DRIVING' : 'MARCO REYES', bx, by - 8);
  bar(ctx, bx, by, 190, 13, p.health / p.maxHealth, p.health > 30 ? '#e8483f' : '#ff7a1a');
  bar(ctx, bx, by + 20, 190, 7, p.stamina / 100, '#ffd166');

  // Cash (top-right, above the stars).
  ctx.textAlign = 'right';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillStyle = '#7be495';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(`$${G.money.toLocaleString('en-US')}`, viewW - 20, 34);
  ctx.shadowBlur = 0;

  // Wanted stars.
  ctx.font = '26px sans-serif';
  for (let i = 0; i < 5; i++) {
    const active = i < G.wanted;
    const flashing = G.wanted > 0 && G.hideTimer > 3 && Math.floor(G.time * 3) % 2 === 0;
    ctx.fillStyle = active ? (flashing ? '#9fb7ff' : '#ffd94d') : 'rgba(255,255,255,0.25)';
    ctx.fillText('★', viewW - 20 - (4 - i) * 30, 66);
  }

  // District label (top-left).
  ctx.textAlign = 'left';
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4;
  ctx.fillText(G.world.districtAt(p.x, p.y), 18, 30);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(G.audio.muted ? 'Sound: OFF (M)' : 'Sound: ON (M)', 18, 52);
  ctx.shadowBlur = 0;

  // Mission objective (top-centre).
  if (G.mode === 'playing') {
    const text = objectiveText(G);
    ctx.font = `600 15px ${FONT}`;
    const w = ctx.measureText(text).width + 26;
    ctx.fillStyle = 'rgba(12,10,20,0.66)';
    ctx.fillRect((viewW - w) / 2, 12, w, 30);
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'center';
    ctx.fillText(text, viewW / 2, 33);
  }

  // Bust meter.
  if (G.bustMeter > 0.05) {
    ctx.textAlign = 'center';
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillStyle = '#7db4ff';
    ctx.fillText('BUSTED?', viewW / 2, viewH - 120);
    bar(ctx, viewW / 2 - 90, viewH - 112, 180, 10, G.bustMeter / 2.4, '#5a8dff');
  }

  // Context prompt.
  if (G.mode === 'playing' && G.nearCar && !p.car) {
    ctx.textAlign = 'center';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillStyle = 'rgba(12,10,20,0.7)';
    const label = 'Press E to enter vehicle';
    const w = ctx.measureText(label).width + 24;
    ctx.fillRect((viewW - w) / 2, viewH - 96, w, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, viewW / 2, viewH - 77);
  } else if (G.mode === 'playing' && p.car) {
    ctx.textAlign = 'center';
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('E — exit vehicle · Space — handbrake', viewW / 2, viewH - 14);
  }

  // Toast (centre).
  if (G.toast && G.toastTimer > 0) {
    ctx.textAlign = 'center';
    ctx.font = `bold 19px ${FONT}`;
    ctx.fillStyle = 'rgba(12,10,20,0.7)';
    const w = ctx.measureText(G.toast).width + 30;
    ctx.fillRect((viewW - w) / 2, viewH * 0.2, w, 36);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(G.toast, viewW / 2, viewH * 0.2 + 25);
  }

  // Phone message from Lucia (bottom-right).
  if (G.phone && G.phoneTimer > 0) {
    const w = 330;
    const h = 92;
    const x = viewW - w - 16;
    const y = viewH - h - 16;
    ctx.fillStyle = 'rgba(14,16,24,0.88)';
    ctx.strokeStyle = 'rgba(255,209,102,0.7)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'left';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`📱 Lucia — ${G.phone.title}`, x + 12, y + 22);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#f2f2f2';
    wrapText(ctx, G.phone.text, x + 12, y + 44, w - 24, 16, 3);
  }

  drawMinimap(ctx, G, viewW, viewH);
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      if (lines >= maxLines) return;
      line = word;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineH);
}

// ---------------------------------------------------------------- minimap

const MAP_SIZE = 168;
const MAP_MARGIN = 16;

export function drawMinimap(ctx, G, viewW, viewH) {
  const size = MAP_SIZE;
  const x = viewW - size - MAP_MARGIN;
  const y = viewH - size - MAP_MARGIN - 108; // keep clear of the phone panel
  const scale = size / G.world.size;
  const toMap = (wx, wy) => [x + wx * scale, y + wy * scale];

  ctx.save();
  ctx.fillStyle = 'rgba(16,20,28,0.82)';
  ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  // Land / beach / sea.
  ctx.fillStyle = '#8a7f5e';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#eed9a0';
  const [, beachY] = toMap(0, 2060);
  ctx.fillRect(x, beachY, size, size);
  ctx.fillStyle = '#2b7d9c';
  const [, seaY] = toMap(0, 2240);
  ctx.fillRect(x, seaY, size, size);
  // Roads.
  ctx.strokeStyle = 'rgba(240,240,240,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const c of [200, 600, 1000, 1400, 1800, 2200]) {
    const [rx] = toMap(c, 0);
    ctx.moveTo(rx, y); ctx.lineTo(rx, y + size);
    const [, ry] = toMap(0, c);
    ctx.moveTo(x, ry); ctx.lineTo(x + size, ry);
  }
  ctx.stroke();

  const dot = (wx, wy, color, r) => {
    const [mx, my] = toMap(wx, wy);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const car of G.vehicles) if (!car.parked) dot(car.x, car.y, '#cfd6dd', 2);
  for (const cop of G.policeCars) {
    dot(cop.x, cop.y, Math.floor(G.time * 4) % 2 ? '#ff5147' : '#5a8dff', 3);
  }
  const target = missionTarget(G);
  if (target) {
    const pulse = 3.5 + Math.sin(G.time * 5) * 1.2;
    dot(target.x, target.y, '#ffd166', pulse);
  }
  dot(G.world.garage.x, G.world.garage.y, '#ffb84d', 2.5);
  // Player arrow.
  const pos = G.playerPos();
  const [px, py] = toMap(pos.x, pos.y);
  const ang = G.player.car ? G.player.car.angle : G.player.angle;
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('SOLMAR', x + size, y - 8);
}
