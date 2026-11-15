import type { Panel, PlayerState } from './types.ts';
import { BOARD_COLS, BOARD_ROWS } from './tuning.ts';
import { garbageAt } from './board.ts';

export interface MatchResult {
  /** Indices (row * BOARD_COLS + col) of every panel that is part of the clear event. */
  cells: number[];
  /** Group id per cell index, used to decide whether a match touches a garbage block. */
  groupOf: Map<number, number>;
  /** Groups that are adjacent to a garbage block of their own colour. */
  groupsTouchingGarbage: Set<number>;
  /** Number of shock panels in the event. */
  shockCount: number;
}

/** Two panels match when they are both matchable and share colour and shock-ness. */
function matchable(panel: Panel | null): boolean {
  if (!panel) return false;
  if (panel.phase === 'normal' || panel.phase === 'landing') return true;
  return panel.matchAnyway && (panel.phase === 'hover' || panel.phase === 'falling');
}

function sameKind(a: Panel, b: Panel): boolean {
  return a.shock === b.shock && a.color === b.color;
}

/**
 * Finds every run of three or more matching panels, horizontally or vertically.
 * All runs that exist at the same moment form a single clear event: the combo size is
 * the total number of panels in the event, exactly like the original.
 */
export function findMatches(p: PlayerState): MatchResult {
  const cells: number[] = [];
  const groupOf = new Map<number, number>();
  let groupId = 0;

  // horizontal runs
  for (let r = 0; r < BOARD_ROWS; r++) {
    let c = 0;
    while (c < BOARD_COLS) {
      const panel = p.grid[r][c];
      if (!matchable(panel)) { c++; continue; }
      let end = c + 1;
      while (end < BOARD_COLS) {
        const other = p.grid[r][end];
        if (!matchable(other) || !sameKind(panel as Panel, other as Panel)) break;
        end++;
      }
      const length = end - c;
      if (length >= 3) {
        groupId++;
        for (let k = c; k < end; k++) {
          const index = r * BOARD_COLS + k;
          if (!groupOf.has(index)) { groupOf.set(index, groupId); cells.push(index); }
        }
      }
      c = end;
    }
  }

  // vertical runs
  for (let c = 0; c < BOARD_COLS; c++) {
    let r = 0;
    while (r < BOARD_ROWS) {
      const panel = p.grid[r][c];
      if (!matchable(panel)) { r++; continue; }
      let end = r + 1;
      while (end < BOARD_ROWS) {
        const other = p.grid[end][c];
        if (!matchable(other) || !sameKind(panel as Panel, other as Panel)) break;
        end++;
      }
      const length = end - r;
      if (length >= 3) {
        groupId++;
        for (let k = r; k < end; k++) {
          const index = k * BOARD_COLS + c;
          if (!groupOf.has(index)) { groupOf.set(index, groupId); cells.push(index); }
        }
      }
      r = end;
    }
  }

  const groupsTouchingGarbage = new Set<number>();
  let shockCount = 0;
  const dirs = [-1, 1, -BOARD_COLS, BOARD_COLS];
  for (const index of cells) {
    const r = Math.floor(index / BOARD_COLS);
    const c = index % BOARD_COLS;
    const panel = p.grid[r][c] as Panel;
    if (panel.shock) shockCount++;
    const group = groupOf.get(index);
    if (group === undefined) continue;
    for (let d = 0; d < 4; d++) {
      const nr = r + (d < 2 ? 0 : d === 2 ? -1 : 1);
      const nc = c + (d < 2 ? (d === 0 ? -1 : 1) : 0);
      if (nr < 0 || nr >= BOARD_ROWS || nc < 0 || nc >= BOARD_COLS) continue;
      const block = garbageAt(p, nr, nc);
      if (block && !block.metal && block.color === panel.color) groupsTouchingGarbage.add(group);
    }
  }

  return { cells, groupOf, groupsTouchingGarbage, shockCount };
}

