// The client side game controller.
//
// Solo play runs the simulation straight from the display loop. Online play never simulates
// a tick until the server has told us what both players pressed for it, so the seven
// hundred and twenty cells on screen are always the same ones the server has.

import type { DifficultyId, MatchState, ModeId, PlayerInput } from '../core/types.ts';
import { createMatch, createRules, step } from '../core/simulate.ts'
import type { Rules } from '../core/simulate.ts';
import { snapshot } from '../core/hash.ts';
import type { InputFrame } from '../protocol.ts';
import { CpuPlayer } from '../ai/cpu.ts';

export interface GameOptions {
  mode: ModeId;
  difficulty: DifficultyId;
  solo: boolean;
  useCpu: boolean;
  seed?: number;
  /** Solo only: the level the stack starts at. Online always begins at level 1. */
  startLevel?: number;
}

export interface GameEvents {
  onStatus: (text: string) => void;
  onSound: (name: string, variation: number) => void;
}

const FRAME_MS = 1000 / 60;

export class Game {
  state: MatchState | null = null;
  rules: Rules;
  options: GameOptions;
  selfIndex = 0;
  inputDelay = 3;
  running = false;
  private cpu: CpuPlayer | null = null;
  private pending = new Map<number, InputFrame>();
  private simTick = 0;
  private nextSendTick = 0;
  private accumulator = 0;
  private lastFrameTime = 0;
  private serverTick = 0;
  private serverTickTime = 0;
  private events: GameEvents;
  private seenCleared = [0, 0];
  private lastGarbageCount = [0, 0];
  private finishedNotified = false;

  onFinish: (winner: number) => void = () => {};
  onInput: (tick: number, buttons: number) => void = () => {};
  /** Diagnostic hook: fires after every simulated tick. */
  onTickApplied: ((state: MatchState) => void) | null = null;

  constructor(options: GameOptions, events: GameEvents) {
    this.options = options;
    this.rules = createRules(options.mode, options.difficulty);
    this.events = events;
  }

  /** Starts a local match: endless, time attack or a game against the CPU. */
  startLocal(seed: number): void {
    this.state = createMatch(seed, this.options.mode, this.options.difficulty, this.options.startLevel ?? 1);
    this.rules = createRules(this.options.mode, this.options.difficulty);
    this.simTick = 0;
    this.selfIndex = 0;
    this.pending.clear();
    this.accumulator = 0;
    this.lastFrameTime = performance.now();
    this.seenCleared = [0, 0];
    this.finishedNotified = false;
    this.cpu = this.options.useCpu ? new CpuPlayer(this.options.difficulty, seed) : null;
    this.running = true;
  }

  /** Adopts a match that the server is also running. */
  startOnline(state: MatchState, selfIndex: number, inputDelay: number): void {
    this.rules = createRules(state.mode, state.difficulty);
    this.state = state;
    this.simTick = state.tick;
    this.selfIndex = selfIndex;
    this.inputDelay = inputDelay;
    this.pending.clear();
    this.nextSendTick = state.tick;
    this.accumulator = 0;
    this.lastFrameTime = performance.now();
    this.seenCleared = [0, 0];
    this.finishedNotified = false;
    this.cpu = null;
    // Without a fresh reference point the first input burst would be aimed far into the future.
    this.serverTick = state.tick;
    this.serverTickTime = performance.now();
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Input frames confirmed by the server. */
  receiveInputs(frames: InputFrame[]): void {
    for (const frame of frames) {
      this.pending.set(frame.tick, frame);
      this.serverTick = Math.max(this.serverTick, frame.tick + 1);
    }
    this.serverTickTime = performance.now();
    for (const key of this.pending.keys()) {
      if (key < this.simTick - 60) this.pending.delete(key);
    }
  }

  applySnapshot(state: MatchState, tick: number): void {
    this.state = snapshot(state);
    this.simTick = tick;
    this.nextSendTick = tick;
    this.pending.clear();
    this.accumulator = 0;
    this.events.onStatus('resynced');
  }

  /** Called once per animation frame. */
  frame(now: number, sampleInput: () => number): void {
    if (!this.running || !this.state) return;
    const delta = Math.min(now - this.lastFrameTime, 200);
    this.lastFrameTime = now;

    if (this.options.solo) {
      this.accumulator += delta;
      let guard = 0;
      while (this.accumulator >= FRAME_MS && guard < 5) {
        this.accumulator -= FRAME_MS;
        guard += 1;
        const buttons = this.sampleSelf(sampleInput);
        const other = this.cpu ? this.cpu.sample(this.state.players[1]) : 0;
        const inputs: [PlayerInput, PlayerInput] = [{ buttons }, { buttons: other }];
        this.advance(inputs);
      }
    } else {
      this.sendLocalInputs(sampleInput);
      let guard = 0;
      while (this.pending.has(this.simTick) && guard < 8) {
        const frame = this.pending.get(this.simTick) as InputFrame;
        this.pending.delete(this.simTick);
        guard += 1;
        this.advance([{ buttons: frame.p0 }, { buttons: frame.p1 }]);
      }
    }
    this.watchEvents();
  }

  private sampleSelf(sampleInput: () => number): number {
    return sampleInput() & 255;
  }

  private advance(inputs: [PlayerInput, PlayerInput]): void {
    const state = this.state;
    if (!state) return;
    step(state, inputs, this.rules);
    this.simTick = state.tick;
    if (this.onTickApplied) this.onTickApplied(state);
    if (state.finished && !this.finishedNotified) {
      this.finishedNotified = true;
      this.events.onSound(state.winner === this.selfIndex ? 'win' : 'lose', 0);
      this.onFinish(state.winner ?? -1);
    }
  }

  /** Sends one input frame per tick that the server still expects from us. */
  private sendLocalInputs(sampleInput: () => number): void {
    const elapsed = performance.now() - this.serverTickTime;
    const estimate = this.serverTick + elapsed / FRAME_MS;
    const target = Math.floor(estimate + this.inputDelay);
    if (target < this.nextSendTick) return;
    const buttons = sampleInput() & 255;
    let guard = 0;
    while (this.nextSendTick <= target && guard < 30) {
      this.onInput(this.nextSendTick, buttons);
      this.nextSendTick += 1;
      guard += 1;
    }
  }

  private watchEvents(): void {
    const state = this.state;
    if (!state) return;
    for (let i = 0; i < 2; i++) {
      const player = state.players[i];
      if (player.panelsCleared > this.seenCleared[i]) {
        const gained = player.panelsCleared - this.seenCleared[i];
        this.seenCleared[i] = player.panelsCleared;
        if (i === this.selfIndex || this.options.solo) {
          const variation = Math.min(11, player.chainCount > 0 ? player.chainCount - 1 : 0);
          this.events.onSound(player.chainDisplay >= 2 ? 'chain' : gained >= 4 ? 'chain' : 'clear', variation);
        }
      }
      if (player.garbage.length > this.lastGarbageCount[i]) {
        this.events.onSound('garbage', 0);
      }
      this.lastGarbageCount[i] = player.garbage.length;
    }
  }
}

