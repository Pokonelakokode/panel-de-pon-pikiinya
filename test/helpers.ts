import type { MatchState, PanelColor, DifficultyId, ModeId } from '../src/core/types.ts';
import { createMatch, createRules, step } from '../src/core/simulate.ts';
import type { Rules } from '../src/core/simulate.ts';
import { makePanel } from '../src/core/board.ts';
import { BOARD_COLS, BOARD_ROWS } from '../src/core/tuning.ts';

export const LETTERS: Record<string, number> = {
  R: 0, C: 1, G: 2, Y: 3, P: 4, B: 5,
};

export interface Fixture {
  state: MatchState;
  rules: Rules;
  run(ticks: number, buttons?: (tick: number) => [number, number]): void;
}

/**
 * Builds a match whose boards are fully scripted. `rows[0]` is the ceiling, `rows[11]` the
 * floor. Each string is six characters wide: a colour letter, "." for empty, "!" for a
 * shock panel. Any panel the layout does not mention is simply empty.
 */
export function fixture(opts: {
  board?: string[];
  board1?: string[];
  mode?: ModeId;
  difficulty?: DifficultyId;
  seed?: number;
  cursor?: { x: number; y: number };
} = {}): Fixture {
  const mode = opts.mode ?? 'vs';
  const difficulty = opts.difficulty ?? 'normal';
  const rules = createRules(mode, difficulty);
  const state = createMatch(opts.seed ?? 1, mode, difficulty);
  clearBoard(state, 0);
  clearBoard(state, 1);
  if (opts.board) applyBoard(state, 0, opts.board);
  if (opts.board1) applyBoard(state, 1, opts.board1);
  if (opts.cursor) {
    state.players[0].cursor.x = opts.cursor.x;
    state.players[0].cursor.y = opts.cursor.y;
  }
  return {
    state,
    rules,
    run(ticks, buttons) {
      for (let i = 0; i < ticks; i++) {
        const pair = buttons ? buttons(i) : [0, 0];
        step(state, [{ buttons: pair[0] }, { buttons: pair[1] }], rules);
        if (state.finished) break;
      }
    },
  };
}

export function clearBoard(state: MatchState, index: number): void {
  const p = state.players[index];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) p.grid[r][c] = null;
  }
  p.garbage.length = 0;
  p.incoming.length = 0;
  p.incomingDelay.length = 0;
}

export function applyBoard(state: MatchState, index: number, rows: string[]): void {
  const p = state.players[index];
  for (let i = 0; i < rows.length && i < BOARD_ROWS; i++) {
    const line = rows[i];
    for (let c = 0; c < BOARD_COLS && c < line.length; c++) {
      const ch = line[c];
      if (ch === '.') { p.grid[i][c] = null; continue; }
      if (ch === '!') { p.grid[i][c] = makePanel(0 as PanelColor, true); continue; }
      const color = LETTERS[ch];
      if (color === undefined) { p.grid[i][c] = null; continue; }
      p.grid[i][c] = makePanel(color as PanelColor, false);
    }
  }
}

/** Counts non-empty cells per colour, for quick assertions after a clear. */
export function countPanels(state: MatchState, index: number): number {
  const p = state.players[index];
  let total = 0;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) if (p.grid[r][c]) total += 1;
  }
  return total;
}

export function addGarbage(
  state: MatchState,
  index: number,
  block: { x: number; y: number; w: number; h: number; color?: number; metal?: boolean; falling?: boolean },
): void {
  const p = state.players[index];
  p.garbage.push({
    id: p.nextGarbageId++,
    x: block.x,
    y: block.y,
    w: block.w,
    h: block.h,
    color: (block.color ?? 0) as PanelColor,
    metal: block.metal ?? false,
    falling: block.falling ?? false,
    justLanded: false,
  });
}

export function emptyRows(): string[] {
  const rows: string[] = [];
  for (let i = 0; i < BOARD_ROWS; i++) rows.push('......');
  return rows;
}

