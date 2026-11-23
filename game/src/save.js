// save.js — localStorage persistence for SOLMAR HEAT.
// Saves money, mission progress and the player's position so Continue works.

const KEY = 'solmar-heat-save-v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage may be unavailable (private mode); the game still runs.
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function hasSave() {
  return loadSave() !== null;
}
