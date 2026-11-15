import type { GarbageBlock, Panel, PanelColor, PlayerState } from './types.ts';
import { BOARD_COLS, BOARD_ROWS, RISE_STEPS } from './tuning.ts';
import { roll } from './rng.ts';

/** Panels may never be generated next to an identical panel when adjacent denial is on. */
export function generateRow(
  rngState: number,
  colorCount: number,
  shockFrequency: number,
  adjacentDenial: boolean,
): { rng: number; row: Panel[] } {
  const row: Panel[] = [];
  let rng = rngState;
  for (let c = 0; c < BOARD_COLS; c++) {
    let shock = false;
    if (shockFrequency > 0) {
      const draw = roll(rng, 1000);
      rng = draw.state;
      shock = draw.value < Math.round(shockFrequency * 1000);
    }
    if (shock) {
      row.push(makePanel(0 as PanelColor, true));
      continue;
    }
    const colors = new Set<number>();
    for (let attempt = 0; attempt < 8; attempt++) {
      const draw = roll(rng, colorCount);
      rng = draw.state;
      if (adjacentDenial && c > 0 && !row[c - 1].shock && row[c - 1].color === draw.value) continue;
      colors.add(draw.value);
      break;
    }
    const pick = colors.size > 0 ? firstOf(colors) : 0;
    row.push(makePanel(pick as PanelColor, false));
  }
  return { rng, row };
}

function firstOf(values: Set<number>): number {
  for (const v of values) return v;
  return 0;
}

export function makePanel(color: PanelColor, shock: boolean): Panel {
  return { color, phase: 'normal', timer: 0, matchAnyway: false, matched: false, swapId: -1, shock, order: 0 };
}

export function panelAt(p: PlayerState, r: number, c: number): Panel | null {
  if (r < 0 || r >= BOARD_ROWS || c < 0 || c >= BOARD_COLS) return null;
  return p.grid[r][c];
}

export function garbageAt(p: PlayerState, r: number, c: number): GarbageBlock | null {
  for (const block of p.garbage) {
    if (c >= block.x && c < block.x + block.w && r >= block.y && r < block.y + block.h) return block;
  }
  return null;
}

export function isBlocked(p: PlayerState, r: number, c: number): boolean {
  if (r >= BOARD_ROWS) return true;
  if (r < 0) return false;
  if (p.grid[r][c] !== null) return true;
  return garbageAt(p, r, c) !== null;
}

/** Shifts the whole stack up by one row and generates a fresh bottom row. */
export function shiftRowsUp(p: PlayerState, colorCount: number, shockFrequency: number, adjacentDenial: boolean): void {
  for (let r = 0; r < BOARD_ROWS - 1; r++) {
    p.grid[r] = p.grid[r + 1];
  }
  const generated = generateRow(p.rng, colorCount, shockFrequency, adjacentDenial);
  p.rng = generated.rng;
  p.grid[BOARD_ROWS - 1] = generated.row;
  for (const block of p.garbage) block.y -= 1;
}

/** True while a panel still has to resolve before the board counts as settled. */
export function hasActivePanels(p: PlayerState): boolean {
  for (let r = 0; r < BOARD_ROWS; r++) {
    const row = p.grid[r];
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = row[c];
      if (!panel) continue;
      if (panel.phase !== 'normal' && panel.phase !== 'landing') return true;
    }
  }
  for (const block of p.garbage) {
    if (block.falling) return true;
  }
  return false;
}

/** The first row from the top that still has a free cell, i.e. how high the stack is. */
export function stackHeight(p: PlayerState): number {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (p.grid[r][c] !== null) return BOARD_ROWS - r;
    }
  }
  return 0;
}

export function isToppedOut(p: PlayerState): boolean {
  for (let c = 0; c < BOARD_COLS; c++) {
    if (p.grid[0][c] !== null) return true;
  }
  for (const block of p.garbage) {
    if (block.y <= 0 && block.y + block.h > 0) return true;
  }
  return false;
}

export const INITIAL_DISPLACEMENT = RISE_STEPS;

