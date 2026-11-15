// State fingerprinting. Two simulations that agree on the hash agree on everything that
// matters, so this is what the clients report to the server to catch desyncs.

import type { MatchState, PlayerState } from './types.ts';
import { BOARD_COLS, BOARD_ROWS } from './tuning.ts';

export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Compact, ordering-stable description of the whole match. */
export function canonical(state: MatchState): string {
  const parts: string[] = [];
  parts.push('t', String(state.tick), 'w', String(state.winner ?? '-'), state.finished ? 'F' : '-', 'c', String(state.clock));
  for (const player of state.players) parts.push(playerCanonical(player));
  return parts.join('|');
}

function playerCanonical(p: PlayerState): string {
  const parts: string[] = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = p.grid[r][c];
      if (!panel) { parts.push('.'); continue; }
      parts.push(String(panel.color), panel.shock ? '!' : '', panel.phase.slice(0, 1), String(panel.timer), panel.matched ? 'm' : '');
    }
    parts.push('/');
  }
  for (const block of p.garbage) {
    parts.push('G', String(block.x), ',', String(block.y), ',', String(block.w), ',', String(block.h), ',', String(block.color), block.metal ? 'M' : '', block.falling ? 'f' : '');
  }
  parts.push('C', String(p.cursor.x), ',', String(p.cursor.y), ',', String(p.cursor.swapCooldown), p.cursor.swapHeld ? 'h' : '-');
  parts.push('R', String(p.riseTimer), ',', String(p.displacement), ',', String(p.speed), ',', String(p.panelsToSpeedup));
  parts.push('H', String(p.health), ',', String(p.shake), ',', String(p.stopTime), ',', String(p.preStop));
  parts.push('K', p.chainActive ? 'a' : '-', String(p.chainCount), ',', String(p.chainGrace), ',', String(p.comboSize));
  parts.push('S', String(p.score), ',', String(p.panelsCleared));
  for (let i = 0; i < p.incoming.length; i++) {
    const piece = p.incoming[i];
    parts.push('I', String(piece.w), ',', String(piece.h), piece.metal ? 'M' : '', piece.isChain ? 'c' : '', ',', String(piece.color), ',', String(p.incomingDelay[i]));
  }
  parts.push('X', String(p.rng), p.gameOver ? 'D' : '');
  return parts.join('');
}

export function hashState(state: MatchState): number {
  return hashString(canonical(state));
}

/** Snapshots travel between machines, so a plain deep copy is all that is needed. */
export function snapshot(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

export function restore(data: MatchState): MatchState {
  return JSON.parse(JSON.stringify(data)) as MatchState;
}

