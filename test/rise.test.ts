import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptyRows, countPanels } from './helpers.ts';
import { createMatch, createRules, panelsToNextLevel } from '../src/core/simulate.ts';

test('the stack rises on its own and gets new rows at the bottom', () => {
  const { state, run } = fixture();
  assert.equal(countPanels(state, 0), 0);
  run(1000);
  assert.ok(countPanels(state, 0) > 0, "after a thousand frames a new row has arrived");
});

test('the rise counter freezes while panels are clearing', () => {
  const rows = emptyRows();
  rows[11] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  run(2);
  const before = state.players[0].riseTimer;
  const displacement = state.players[0].displacement;
  run(20);
  assert.equal(state.players[0].riseTimer, before);
  assert.equal(state.players[0].displacement, displacement);
});

test('a topped out stack drains its grace and then loses the match', () => {
  const rows = emptyRows();
  for (let r = 0; r < 12; r++) rows[r] = r % 2 === 0 ? "R....." : "C.....";
  const { state, run } = fixture({ board: rows });
  run(2);
  assert.ok(state.players[0].toppedOut);
  assert.ok(state.players[0].health < state.players[0].maxHealth, "the grace period is ticking down");
  run(80);
  assert.equal(state.players[0].gameOver, true);
  assert.equal(state.finished, true);
  assert.equal(state.winner, 1, "the other player wins");
});

test('stop time cannot stretch out the ceiling grace period', () => {
  const rows = emptyRows();
  for (let r = 0; r < 12; r++) rows[r] = r % 2 === 0 ? 'R.....' : 'C.....';
  const { state, run } = fixture({ board: rows });
  state.players[0].stopTime = 600;
  run(2);
  assert.ok(state.players[0].health < state.players[0].maxHealth, 'the grace runs even with stop time banked');
  run(90);
  assert.equal(state.players[0].gameOver, true, 'the match is over within about a second');
});

test('a harder difficulty speeds the stack up sooner', () => {
  const easy = createRules('endless', 'easy');
  const shard = createRules('endless', 'shard');
  assert.ok(panelsToNextLevel(1, shard) < panelsToNextLevel(1, easy));
  assert.ok(panelsToNextLevel(1, shard) < 9, 'S-Hard needs fewer panels for the first level up');
});

test('a solo match can start at a higher level', () => {
  const state = createMatch(1, 'endless', 'normal', 9);
  assert.equal(state.players[0].speed, 9);
  assert.equal(state.players[1].speed, 9);
  const plain = createMatch(1, 'endless', 'normal');
  assert.equal(plain.players[0].speed, 1);
});

test('clearing stops the rise and banks stop time', () => {
  const rows = emptyRows();
  rows[11] = 'RRRRR.';
  const { state, run } = fixture({ board: rows });
  run(3);
  assert.ok(state.players[0].stopTime > 0);
  assert.ok(state.players[0].preStop > 0, "the clear animation itself already freezes the stack");
});

