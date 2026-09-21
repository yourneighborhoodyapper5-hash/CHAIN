// input.js — unifies keyboard/mouse and Gamepad API into one polled state.

const DEADZONE = 0.18;

function applyDeadzone(v) {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

export class InputManager {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    this.pointerLocked = false;

    this._attackEdgePrev = false;
    this._dodgeEdgePrev = false;
    this._padAttackPrev = false;
    this._padDodgePrev = false;

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.dom.addEventListener('click', () => {
      if (!this.pointerLocked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseLeftDown = true;
      if (e.button === 2) this.mouseRightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeftDown = false;
      if (e.button === 2) this.mouseRightDown = false;
    });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p) return p;
    return null;
  }

  // Returns a snapshot of the current frame's intent. Call once per frame.
  poll() {
    const pad = this._gamepad();

    let moveX = 0, moveY = 0, lookX = 0, lookY = 0;
    let sprint = false, blockHeld = false, attackDown = false, dodgeDown = false;

    // Keyboard / mouse
    if (this.keys.has('KeyA')) moveX -= 1;
    if (this.keys.has('KeyD')) moveX += 1;
    if (this.keys.has('KeyW')) moveY -= 1;
    if (this.keys.has('KeyS')) moveY += 1;
    sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    blockHeld = this.mouseRightDown;
    attackDown = this.mouseLeftDown;
    dodgeDown = this.keys.has('Space');

    lookX = this.mouseDX * 0.0022;
    lookY = this.mouseDY * 0.0022;
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Gamepad overrides/adds
    if (pad) {
      const lx = applyDeadzone(pad.axes[0] || 0);
      const ly = applyDeadzone(pad.axes[1] || 0);
      const rx = applyDeadzone(pad.axes[2] || 0);
      const ry = applyDeadzone(pad.axes[3] || 0);
      if (lx !== 0 || ly !== 0) { moveX = lx; moveY = ly; }
      if (rx !== 0 || ry !== 0) { lookX += rx * 0.045; lookY += ry * 0.045; }

      const btn = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      if (btn(0)) sprint = true;               // A / Cross (hold to sprint)
      if (btn(1)) dodgeDown = dodgeDown || true; // B / Circle
      if (btn(7) || btn(5)) attackDown = attackDown || true; // RT / R2 or RB
      if (btn(6) || btn(4)) blockHeld = blockHeld || true;   // LT / L2 or LB
    }

    const len = Math.hypot(moveX, moveY);
    if (len > 1) { moveX /= len; moveY /= len; }

    const attackPressed = attackDown && !this._attackEdgePrev;
    const dodgePressed = dodgeDown && !this._dodgeEdgePrev;
    this._attackEdgePrev = attackDown;
    this._dodgeEdgePrev = dodgeDown;

    return { moveX, moveY, lookX, lookY, sprint, blockHeld, attackDown, attackPressed, dodgePressed };
  }
}
