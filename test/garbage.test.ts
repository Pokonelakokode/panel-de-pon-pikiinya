import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptyRows, addGarbage } from './helpers.ts';
import { hasActivePanels } from '../src/core/board.ts';

test('queued garbage waits for its transit delay then falls in from above', () => {
  const { state, run } = fixture();
  state.players[0].incoming.push({ w: 6, h: 3, metal: false, isChain: false, order: 0, color: 0 });
  state.players[0].incomingDelay.push(2);
  run(1);
  assert.equal(state.players[0].garbage.length, 0);
  run(3);
  assert.equal(state.players[0].garbage.length, 1);
  assert.equal(state.players[0].garbage[0].falling, true);
});

test('at most one piece starts falling per frame', () => {
  const { state, run } = fixture();
  for (let i = 0; i < 4; i++) {
    state.players[0].incoming.push({ w: 3, h: 1, metal: false, isChain: false, order: i, color: 0 });
    state.players[0].incomingDelay.push(0);
  }
  run(1);
  assert.equal(state.players[0].garbage.length, 1);
  run(1);
  assert.equal(state.players[0].garbage.length, 1);
  state.players[0].garbage[0].falling = false;
  run(1);
  assert.equal(state.players[0].garbage.length, 2);
});

test('garbage lands on the floor and shakes the board', () => {
  const { state, run } = fixture();
  addGarbage(state, 0, { x: 0, y: -2, w: 6, h: 2, falling: true });
  for (let i = 0; i < 40; i++) {
    run(1);
    if (!state.players[0].garbage[0].falling) break;
  }
  const block = state.players[0].garbage[0];
  assert.equal(block.y, 10);
  assert.equal(block.falling, false);
  assert.ok(state.players[0].shake > 0);
});

test('a match next to a one row block turns the whole block into panels', () => {
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 11, w: 6, h: 1, color: 0 });
  run(6);
  assert.equal(state.players[0].garbage.length, 0);
  const converted = state.players[0].grid[11];
  assert.ok(converted[0] && converted[5], 'every cell of the block became a panel');
  assert.ok(converted[0]?.matchAnyway, 'freed panels may still match while they hover');
});

test('a thick chain block only loses its bottom row per match', () => {
  const rows = emptyRows();
  rows[8] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 9, w: 6, h: 3, color: 0 });
  run(8);
  const block = state.players[0].garbage[0];
  assert.ok(block);
  assert.equal(block.h, 2);
  assert.ok(state.players[0].grid[11][0]);
});

test('metal garbage is destroyed but never becomes panels', () => {
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 11, w: 6, h: 1, color: 0, metal: true });
  run(6);
  assert.equal(state.players[0].garbage.length, 0);
  assert.equal(state.players[0].grid[11][0], null);
});

test('any adjacent match breaks a block, whatever colour it was sent as', () => {
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 11, w: 6, h: 1, color: 2 });
  run(6);
  assert.equal(state.players[0].garbage.length, 0, 'the block colour is the sender, not a match key');
});

test('panels freed from a block settle instead of hovering for ever', () => {
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 11, w: 6, h: 1, color: 0 });
  run(10);
  assert.equal(state.players[0].garbage.length, 0);
  const freed = state.players[0].grid[11][0];
  assert.ok(freed, 'the block turned into panels');
  assert.ok(freed.phase === 'normal' || freed.phase === 'landing', 'settled, got ' + freed.phase);
  // let the clear animation finish as well, then the board has to be completely at rest
  run(200);
  assert.equal(hasActivePanels(state.players[0]), false, 'nothing may stay busy, that would freeze the rise');
});

test('garbage falls again when the panels underneath are cleared', () => {
  const rows = emptyRows();
  rows[11] = 'R.....';
  const { state, run } = fixture({ board: rows });
  addGarbage(state, 0, { x: 0, y: 10, w: 6, h: 1, color: 0, falling: false });
  run(2);
  assert.equal(state.players[0].garbage[0].y, 10, 'still resting on the panel below');
  state.players[0].grid[11][0] = null;
  run(1);
  assert.equal(state.players[0].garbage[0].y, 11, 'with the support gone it drops to the floor');
});

test('garbage cannot land while the stack is full to the ceiling', () => {
  const rows = emptyRows();
  for (let r = 0; r < 12; r++) rows[r] = r % 2 === 0 ? "R....." : "C.....";
  const { state, run } = fixture({ board: rows });
  state.players[0].incoming.push({ w: 6, h: 1, metal: false, isChain: false, order: 0, color: 0 });
  state.players[0].incomingDelay.push(0);
  run(5);
  assert.equal(state.players[0].garbage.length, 0);
  assert.equal(state.players[0].incoming.length, 1);
});

