// input.js — keyboard and mouse state for SOLMAR HEAT.
// Held keys, just-pressed keys, and mouse position/buttons in screen space.
// main.js converts the mouse position to world space for aiming.

export function createInput(canvas) {
  const input = {
    keys: new Set(),       // currently held KeyboardEvent.code values
    pressed: new Set(),    // codes that went down this frame (cleared each frame)
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    mouseClicked: false,   // true only on the frame the button went down
  };

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.mouseDown = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = e.clientX - r.left;
    input.mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.mouseDown = true; input.mouseClicked = true; }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  input.down = (code) => input.keys.has(code);
  input.hit = (code) => input.pressed.has(code);
  input.moveX = () => (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0)
    - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
  input.moveY = () => (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0)
    - (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0);
  input.endFrame = () => { input.pressed.clear(); input.mouseClicked = false; };
  return input;
}
