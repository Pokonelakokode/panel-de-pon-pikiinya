// Keyboard and gamepad sampling. The result is a plain bitmask, which is exactly what
// travels over the wire, so what you press is what the simulation sees.

import { BTN } from '../core/types.ts';

export interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  swap: string[];
  raiseLeft: string[];
  raiseRight: string[];
}

export const DEFAULT_KEYS: KeyMap = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  swap: ['KeyZ', 'KeyX', 'Space', 'Enter'],
  raiseLeft: ['KeyQ', 'ShiftLeft'],
  raiseRight: ['KeyE', 'ShiftRight'],
};

export class InputSampler {
  private held = new Set<string>();
  /** Keys pressed since the last sample, so a one frame tap is never dropped. */
  private latched = new Set<string>();
  private map: KeyMap = DEFAULT_KEYS;
  private gamepadIndex: number | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.repeat) return;
      this.held.add(e.code);
      this.latched.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (event) => {
      const e = event as KeyboardEvent;
      this.held.delete(e.code);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
      this.latched.clear();
    });
    target.addEventListener('gamepadconnected', (event) => {
      this.gamepadIndex = (event as GamepadEvent).gamepad.index;
    });
    target.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  setKeyMap(map: KeyMap): void {
    this.map = map;
  }

  /** Current button bitmask, combining keyboard and the first connected gamepad. */
  sample(): number {
    let buttons = 0;
    if (this.anyHeld(this.map.up)) buttons |= BTN.up;
    if (this.anyHeld(this.map.down)) buttons |= BTN.down;
    if (this.anyHeld(this.map.left)) buttons |= BTN.left;
    if (this.anyHeld(this.map.right)) buttons |= BTN.right;
    if (this.anyHeld(this.map.swap)) buttons |= BTN.swap;
    if (this.anyHeld(this.map.raiseLeft)) buttons |= BTN.raiseLeft;
    if (this.anyHeld(this.map.raiseRight)) buttons |= BTN.raiseRight;
    buttons |= this.sampleGamepad();
    this.latched.clear();
    return buttons & 255;
  }

  private anyHeld(codes: string[]): boolean {
    for (const code of codes) if (this.held.has(code) || this.latched.has(code)) return true;
    return false;
  }

  private sampleGamepad(): number {
    if (this.gamepadIndex === null) return 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[this.gamepadIndex];
    if (!pad) return 0;
    let buttons = 0;
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    if (axisY < -0.4 || pad.buttons[12]?.pressed) buttons |= BTN.up;
    if (axisY > 0.4 || pad.buttons[13]?.pressed) buttons |= BTN.down;
    if (axisX < -0.4 || pad.buttons[14]?.pressed) buttons |= BTN.left;
    if (axisX > 0.4 || pad.buttons[15]?.pressed) buttons |= BTN.right;
    if (pad.buttons[0]?.pressed || pad.buttons[2]?.pressed) buttons |= BTN.swap;
    if (pad.buttons[4]?.pressed || pad.buttons[6]?.pressed) buttons |= BTN.raiseLeft;
    if (pad.buttons[5]?.pressed || pad.buttons[7]?.pressed) buttons |= BTN.raiseRight;
    return buttons;
  }
}

