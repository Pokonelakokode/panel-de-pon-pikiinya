// Recording and replaying input logs. A replay plus the seed has to reproduce the exact
// same final state hash, which is what keeps refactors of the rules honest.

import type { DifficultyId, MatchState, ModeId, PlayerInput } from './types.ts';
import { createMatch, createRules, step } from './simulate.ts';
import { hashState, snapshot } from './hash.ts';

export const REPLAY_VERSION = 1;

export interface ReplayFrame {
  tick: number;
  p0: number;
  p1: number;
}

export interface Replay {
  version: number;
  seed: number;
  mode: ModeId;
  difficulty: DifficultyId;
  frames: ReplayFrame[];
  endTick: number;
  endHash: number;
}

export interface Recorder {
  replay: Replay;
  record(inputs: [PlayerInput, PlayerInput]): void;
  finish(state: MatchState): Replay;
}

export function startRecording(seed: number, mode: ModeId, difficulty: DifficultyId): Recorder {
  const replay: Replay = { version: REPLAY_VERSION, seed, mode, difficulty, frames: [], endTick: 0, endHash: 0 };
  return {
    replay,
    record(inputs) {
      replay.frames.push({ tick: replay.frames.length, p0: inputs[0].buttons, p1: inputs[1].buttons });
    },
    finish(state) {
      replay.endTick = state.tick;
      replay.endHash = hashState(state);
      return replay;
    },
  };
}

/** Replays a log and returns the final state. */
export function runReplay(replay: Replay, onTick?: (state: MatchState, tick: number) => void): MatchState {
  const rules = createRules(replay.mode, replay.difficulty);
  const state = createMatch(replay.seed, replay.mode, replay.difficulty);
  for (let i = 0; i < replay.frames.length; i++) {
    const frame = replay.frames[i];
    step(state, [{ buttons: frame.p0 }, { buttons: frame.p1 }], rules);
    if (onTick) onTick(state, i);
    if (state.finished) break;
  }
  return state;
}

/** Reproduces a snapshot at an arbitrary tick, used when a client has to resync. */
export function replayTo(replay: Replay, tick: number): MatchState {
  const rules = createRules(replay.mode, replay.difficulty);
  const state = createMatch(replay.seed, replay.mode, replay.difficulty);
  const limit = Math.min(tick, replay.frames.length);
  for (let i = 0; i < limit; i++) {
    const frame = replay.frames[i];
    step(state, [{ buttons: frame.p0 }, { buttons: frame.p1 }], rules);
    if (state.finished) break;
  }
  return state;
}

export function cloneState(state: MatchState): MatchState {
  return snapshot(state);
}

