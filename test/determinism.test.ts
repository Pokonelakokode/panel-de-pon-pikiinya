import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createRules, step } from '../src/core/simulate.ts';
import { hashState, snapshot } from '../src/core/hash.ts';
import type { MatchState, PlayerInput } from '../src/core/types.ts';

function randomInputs(tick: number, seedA: number, seedB: number): number {
  const a = (Math.imul(tick + 1, 1103515245) + seedA) >>> 0;
  const b = (Math.imul(tick + 7, 12345) + seedB) >>> 0;
  return (a ^ b) & 255;
}

function runMatch(state: MatchState, ticks: number, seedA: number, seedB: number): void {
  const rules = createRules(state.mode, state.difficulty);
  for (let t = 0; t < ticks; t++) {
    step(state, [{ buttons: randomInputs(t, seedA, 1) }, { buttons: randomInputs(t, seedB, 2) }], rules);
    if (state.finished) break;
  }
}

test('the same seed and the same inputs produce the same state', () => {
  const a = createMatch(4242, 'vs', 'normal');
  const b = createMatch(4242, 'vs', 'normal');
  runMatch(a, 3000, 11, 22);
  runMatch(b, 3000, 11, 22);
  assert.equal(hashState(a), hashState(b));
  assert.equal(a.tick, b.tick);
});

test('a different seed produces a different match', () => {
  const a = createMatch(1, 'vs', 'normal');
  const b = createMatch(2, 'vs', 'normal');
  runMatch(a, 600, 11, 22);
  runMatch(b, 600, 11, 22);
  assert.notEqual(hashState(a), hashState(b));
});

test('every difficulty and mode survives a long random match', () => {
  const modes = ['vs', 'endless', 'timeattack'] as const;
  const difficulties = ['easy', 'normal', 'hard', 'shard'] as const;
  for (const mode of modes) {
    for (const difficulty of difficulties) {
      const state = createMatch(99, mode, difficulty);
      runMatch(state, 5000, 3, 4);
      assert.ok(Number.isFinite(state.tick));
      assert.ok(state.tick > 0);
      for (const player of state.players) {
        assert.ok(player.health >= -10 && player.health <= player.maxHealth + 10);
      }
    }
  }
});

test('a snapshot restores a byte identical match', () => {
  const state = createMatch(777, 'vs', 'hard');
  runMatch(state, 500, 5, 6);
  const copy = snapshot(state);
  assert.equal(hashState(copy), hashState(state));
  runMatch(state, 200, 5, 6);
  runMatch(copy, 200, 5, 6);
  assert.equal(hashState(copy), hashState(state));
});

test('the same input log replays to the same hash', async () => {
  const { startRecording, runReplay } = await import('../src/core/replay.ts');
  const rules = createRules('vs', 'normal');
  const state = createMatch(31337, 'vs', 'normal');
  const recorder = startRecording(31337, 'vs', 'normal');
  for (let t = 0; t < 2000; t++) {
    const inputs: [PlayerInput, PlayerInput] = [{ buttons: randomInputs(t, 8, 1) }, { buttons: randomInputs(t, 9, 2) }];
    recorder.record(inputs);
    step(state, inputs, rules);
    if (state.finished) break;
  }
  const replay = recorder.finish(state);
  const replayed = runReplay(replay);
  assert.equal(hashState(replayed), replay.endHash);
});

