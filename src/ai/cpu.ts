// The CPU opponent. It plays through the same input bitmask as a human, so it cannot cheat:
// it reads its own board, picks a swap and then has to move the cursor there like anyone else.
//
// It scores every legal swap two ways. A swap that clears panels right now is worth a lot;
// otherwise a swap that brings matching colours together is worth a little. Without that second
// half it would simply freeze as soon as the board had no ready made match left, which is
// exactly what a settled board with five colours looks like.

import type { DifficultyId, PlayerState } from '../core/types.ts';
import { BTN } from '../core/types.ts';
import { BOARD_COLS, BOARD_ROWS } from '../core/tuning.ts';
import { garbageAt } from '../core/board.ts';
import { roll, seedState } from '../core/rng.ts';

export interface CpuProfile {
  /** Frames between two decisions. */
  thinkInterval: number;
  /** Frames between single-cell cursor steps (human-paced cursor speed). */
  cursorInterval: number;
  /** Initial warmup frames at the start of a match before the CPU begins swapping. */
  openingCooldown: number;
  /** Recovery frames after executing a swap. */
  postSwapCooldown: number;
  /** Chance out of 100 that it picks a worse move on purpose. */
  mistakeChance: number;
  /** How strongly it avoids working high up the board. */
  greed: number;
  /** Frames of having nothing to do before it tidies the board anyway. */
  idleBeforeTidy: number;
  /** How far ahead it looks when it has no immediate match. */
  setupWeight: number;
}

export const CPU_PROFILES: Record<DifficultyId, CpuProfile> = {
  easy: { thinkInterval: 34, cursorInterval: 6, openingCooldown: 120, postSwapCooldown: 42, mistakeChance: 45, greed: 2, idleBeforeTidy: 12, setupWeight: 3 },
  normal: { thinkInterval: 22, cursorInterval: 4, openingCooldown: 90, postSwapCooldown: 26, mistakeChance: 26, greed: 2, idleBeforeTidy: 8, setupWeight: 5 },
  hard: { thinkInterval: 12, cursorInterval: 2, openingCooldown: 45, postSwapCooldown: 14, mistakeChance: 10, greed: 3, idleBeforeTidy: 5, setupWeight: 8 },
  shard: { thinkInterval: 7, cursorInterval: 1, openingCooldown: 15, postSwapCooldown: 8, mistakeChance: 3, greed: 4, idleBeforeTidy: 4, setupWeight: 11 },
};

const EMPTY = -1;
const GARBAGE = -2;

export class CpuPlayer {
  private profile: CpuProfile;
  private rng: number;
  private cooldown = 0;
  private cursorCooldown = 0;
  private target: { x: number; y: number } | null = null;
  private pressedLastFrame = false;
  private idleFrames = 0;
  /** Recent swaps are excluded so the CPU cannot shuffle the same two panels back and forth. */
  private recent: { x: number; y: number }[] = [];

  constructor(difficulty: DifficultyId, seed: number) {
    this.profile = CPU_PROFILES[difficulty];
    this.cooldown = this.profile.openingCooldown;
    this.rng = seedState(seed, 7);
  }

  /** Produces the bitmask the CPU wants to press this frame. */
  sample(player: PlayerState): number {
    if (this.cooldown > 0) this.cooldown -= 1;
    if (this.cursorCooldown > 0) this.cursorCooldown -= 1;
    if (!this.target && this.cooldown <= 0) {
      this.chooseTarget(player);
      this.cooldown = this.profile.thinkInterval;
    }
    const target = this.target;
    if (!target) return 0;

    const cursor = player.cursor;
    if (cursor.y !== target.y || cursor.x !== target.x) {
      if (this.cursorCooldown > 0) return 0;
      this.cursorCooldown = this.profile.cursorInterval - 1;
      if (cursor.y < target.y) return BTN.down;
      if (cursor.y > target.y) return BTN.up;
      if (cursor.x < target.x) return BTN.right;
      if (cursor.x > target.x) return BTN.left;
    }

    if (this.pressedLastFrame) {
      this.pressedLastFrame = false;
      this.recent.push(target);
      if (this.recent.length > 6) this.recent.shift();
      this.target = null;
      this.cooldown = Math.max(this.cooldown, this.profile.postSwapCooldown);
      return 0;
    }
    this.pressedLastFrame = true;
    return BTN.swap;
  }

  /**
   * Plans one swap. In order of preference: a swap that clears panels right now, a swap that
   * sets up a clear the CPU can take on its next turn, a swap that at least groups colours
   * together, and finally a harmless tidy move so it never stands completely still.
   */
  private chooseTarget(player: PlayerState): void {
    const colors = this.buildColors(player);
    const immediate: { x: number; y: number; score: number }[] = [];
    const setup: { x: number; y: number; score: number }[] = [];
    const baseAdjacency = adjacencyScore(colors);

    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let col = 0; col + 1 < BOARD_COLS; col++) {
        if (!this.legal(colors, r, col) || this.isRecent(col, r)) continue;
        const heightCost = (BOARD_ROWS - r) * this.profile.greed * 0.25;
        const grid = swapped(colors, r, col);
        const matched = countMatches(grid);
        if (matched > 0) {
          immediate.push({ x: col, y: r, score: matched * 12 + (matched >= 4 ? 18 : 0) - heightCost });
          continue;
        }
        const gain = adjacencyScore(grid) - baseAdjacency;
        if (gain > 0) setup.push({ x: col, y: r, score: gain * this.profile.setupWeight - heightCost });
      }
    }

    const options = immediate.length > 0 ? immediate : setup;
    if (options.length > 0) {
      this.idleFrames = 0;
      options.sort((a, b) => b.score - a.score);
      const draw = roll(this.rng, 100);
      this.rng = draw.state;
      const mistake = draw.value < this.profile.mistakeChance;
      const pick = mistake ? Math.min(options.length - 1, 1 + (draw.value % 3)) : 0;
      this.target = { x: options[pick].x, y: options[pick].y };
      return;
    }

    // Nothing pays off in one move: look for a single preparation that unlocks a clear.
    const plan = this.findTwoPly(colors);
    if (plan) {
      this.idleFrames = 0;
      this.target = plan;
      return;
    }

    this.idleFrames += 1;
    if (this.idleFrames > this.profile.idleBeforeTidy) {
      this.idleFrames = 0;
      this.target = this.firstLegal(colors);
      return;
    }
    this.target = null;
  }

  /** A swap that is legal: never garbage, never two identical panels, never two empty cells. */
  private legal(colors: number[][], row: number, col: number): boolean {
    const a = colors[row][col];
    const b = colors[row][col + 1];
    if (a === GARBAGE || b === GARBAGE) return false;
    if (a === EMPTY && b === EMPTY) return false;
    return a !== b;
  }

  private isRecent(col: number, row: number): boolean {
    for (const entry of this.recent) {
      if (entry.x === col && entry.y === row) return true;
    }
    return false;
  }

  private firstLegal(colors: number[][]): { x: number; y: number } | null {
    for (let r = BOARD_ROWS - 1; r >= 0; r--) {
      for (let col = 0; col + 1 < BOARD_COLS; col++) {
        if (this.legal(colors, r, col) && !this.isRecent(col, r)) return { x: col, y: r };
      }
    }
    return null;
  }

  /** Finds a swap after which some other swap would clear panels. */
  private findTwoPly(base: number[][]): { x: number; y: number } | null {
    let best: { x: number; y: number; score: number } | null = null;
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let col = 0; col + 1 < BOARD_COLS; col++) {
        if (!this.legal(base, r, col) || this.isRecent(col, r)) continue;
        const after = swapped(base, r, col);
        let unlocks = false;
        for (let r2 = 0; r2 < BOARD_ROWS && !unlocks; r2++) {
          for (let col2 = 0; col2 + 1 < BOARD_COLS && !unlocks; col2++) {
            if (!this.legal(after, r2, col2) || this.isRecent(col2, r2)) continue;
            if (countMatches(swapped(after, r2, col2)) > 0) unlocks = true;
          }
        }
        if (!unlocks) continue;
        const score = 10 - (BOARD_ROWS - r) * this.profile.greed * 0.25;
        if (!best || score > best.score) best = { x: col, y: r, score };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private buildColors(player: PlayerState): number[][] {
    const colors: number[][] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      const row: number[] = [];
      for (let col = 0; col < BOARD_COLS; col++) {
        const panel = player.grid[r][col];
        if (panel) row.push(panel.color);
        else if (garbageAt(player, r, col)) row.push(GARBAGE);
        else row.push(EMPTY);
      }
      colors.push(row);
    }
    return colors;
  }
}

/** A copy of the board with two horizontally adjacent cells exchanged. */
function swapped(base: number[][], row: number, col: number): number[][] {
  const grid = base.map((line) => line.slice());
  const a = grid[row][col];
  grid[row][col] = grid[row][col + 1];
  grid[row][col + 1] = a;
  return grid;
}

/** How many orthogonal same colour neighbours the board has. Higher means closer to matches. */
function adjacencyScore(grid: number[][]): number {
  let total = 0;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const value = grid[r][col];
      if (value < 0) continue;
      if (col + 1 < BOARD_COLS && grid[r][col + 1] === value) total += 1;
      if (r + 1 < BOARD_ROWS && grid[r + 1][col] === value) total += 1;
    }
  }
  return total;
}

function countMatches(grid: number[][]): number {
  const marked = new Set<number>();
  for (let r = 0; r < BOARD_ROWS; r++) {
    let run = 1;
    for (let col = 1; col <= BOARD_COLS; col++) {
      const same = col < BOARD_COLS && grid[r][col] >= 0 && grid[r][col] === grid[r][col - 1];
      if (same) run += 1;
      else {
        if (run >= 3) for (let k = col - run; k < col; k++) marked.add(r * BOARD_COLS + k);
        run = 1;
      }
    }
  }
  for (let col = 0; col < BOARD_COLS; col++) {
    let run = 1;
    for (let r = 1; r <= BOARD_ROWS; r++) {
      const same = r < BOARD_ROWS && grid[r][col] >= 0 && grid[r][col] === grid[r - 1][col];
      if (same) run += 1;
      else {
        if (run >= 3) for (let k = r - run; k < r; k++) marked.add(k * BOARD_COLS + col);
        run = 1;
      }
    }
  }
  return marked.size;
}

