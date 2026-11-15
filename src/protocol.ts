// The client/server contract. Both sides import these types, and both check the version,
// so a stale tab can never quietly join a match with different rules.

import type { DifficultyId, MatchState, ModeId } from './core/types.ts';

export const PROTOCOL_VERSION = 1;

export type RoomPhase = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface PlayerInfo {
  name: string;
  ready: boolean;
  connected: boolean;
  /** Latency in milliseconds, as measured by ping. */
  ping: number;
}

export interface InputFrame {
  tick: number;
  p0: number;
  p1: number;
}

export interface MatchStats {
  score: [number, number];
  panelsCleared: [number, number];
  maxChain: [number, number];
  ticks: number;
}

export type ClientMessage =
  | { t: 'hello'; ver: number; name: string; token?: string }
  | { t: 'create'; mode: ModeId; difficulty: DifficultyId; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'watch'; code: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; tick: number; buttons: number }
  | { t: 'hash'; tick: number; hash: number }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; id: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string; token: string; ver: number }
  | { t: 'room'; code: string; phase: RoomPhase; mode: ModeId; difficulty: DifficultyId; selfIndex: number; players: PlayerInfo[]; isHost: boolean }
  | { t: 'peer'; index: number; info: PlayerInfo }
  | { t: 'countdown'; ticks: number }
  | { t: 'start'; seed: number; startTick: number; inputDelay: number; selfIndex: number; mode: ModeId; difficulty: DifficultyId }
  | { t: 'inputs'; frames: InputFrame[] }
  | { t: 'snapshot'; tick: number; state: MatchState }
  | { t: 'end'; winner: number; reason: string; stats: MatchStats }
  | { t: 'rematchVote'; votes: [boolean, boolean] }
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; id: number; tick: number };

/** Room codes avoid the characters people confuse when reading them out loud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

/** How many ticks the server waits for a missing input before it gives up on it. */
export const STALL_LIMIT_TICKS = 20;
/** Default input delay in ticks; the server tunes it from the measured round trip time. */
export const DEFAULT_INPUT_DELAY = 3;

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decode(data: string): ClientMessage | ServerMessage | null {
  try {
    const parsed = JSON.parse(data) as ClientMessage | ServerMessage;
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { t?: unknown }).t !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

