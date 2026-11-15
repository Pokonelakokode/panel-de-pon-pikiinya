import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptyRows, countPanels } from './helpers.ts';
import { findMatches } from '../src/core/match.ts';

test('three in a row clears', () => {
  const rows = emptyRows();
  rows[11] = 'RRR...';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 3);
});

test('two in a row does not clear', () => {
  const rows = emptyRows();
  rows[11] = 'RR....';
  const { state, run } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 0);
  run(60);
  assert.equal(countPanels(state, 0), 2);
});

test('a three match is removed after the clear animation', () => {
  const rows = emptyRows();
  rows[11] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  run(100);
  assert.equal(countPanels(state, 0), 0);
  assert.equal(state.players[0].panelsCleared, 3);
});

test('vertical three clears', () => {
  const rows = emptyRows();
  rows[9] = 'G.....';
  rows[10] = 'G.....';
  rows[11] = 'G.....';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 3);
});

test('an L shape is one five panel event', () => {
  const rows = emptyRows();
  rows[9] = '.Y....';
  rows[10] = '.YYY..';
  rows[11] = '.Y....';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 5);
});

test('a cross is a single five panel event', () => {
  const rows = emptyRows();
  rows[9] = '..P...';
  rows[10] = 'PPP...';
  rows[11] = '..P...';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 5);
});

test('a straight four is a four panel event', () => {
  const rows = emptyRows();
  rows[11] = 'BBBB..';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 4);
});

test('shock panels only match other shock panels', () => {
  const rows = emptyRows();
  rows[11] = 'RR!...';
  const { state } = fixture({ board: rows });
  assert.equal(findMatches(state.players[0]).cells.length, 0);
});

test('panels do not match while they are still on the way down', () => {
  const rows = emptyRows();
  rows[6] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  run(1);
  assert.equal(findMatches(state.players[0]).cells.length, 0, 'hovering panels are not matchable');
  run(40);
  assert.equal(state.players[0].grid[11][0]?.color, 0, 'they should have landed on the floor');
  run(80);
  assert.ok(state.players[0].panelsCleared >= 3, 'and then cleared');
});

test('a swap that makes no match is not undone', () => {
  const rows = emptyRows();
  rows[11] = 'RC....';
  const { state, run } = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  run(1, () => [16, 0]);
  run(6);
  assert.equal(state.players[0].grid[11][0]?.color, 1);
  assert.equal(state.players[0].grid[11][1]?.color, 0);
});

test('a swap that makes a match clears it', () => {
  const rows = emptyRows();
  rows[11] = 'RCRR..';
  const { state, run } = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  run(1, () => [16, 0]);
  run(100);
  assert.equal(state.players[0].panelsCleared, 3);
});

test('panels can be swapped into an empty cell', () => {
  const rows = emptyRows();
  rows[11] = 'R.....';
  const { state, run } = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  run(1, () => [16, 0]);
  run(6);
  assert.equal(state.players[0].grid[11][0], null);
  assert.equal(state.players[0].grid[11][1]?.color, 0);
});

test('holding the swap button starts exactly one swap', () => {
  const rows = emptyRows();
  rows[11] = 'RCR...';
  const { state, run } = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  let swaps = 0;
  for (let t = 0; t < 60; t++) {
    const before = state.players[0].cursor.swapCooldown;
    run(1, () => [16, 0]);
    const after = state.players[0].cursor.swapCooldown;
    if (before === 0 && after > 0) swaps += 1;
  }
  assert.equal(swaps, 1, 'the button has to be released before it can fire again');
  assert.equal(state.players[0].grid[11][0]?.color, 1);
  assert.equal(state.players[0].grid[11][1]?.color, 0);
});

test('releasing and pressing the swap button swaps again', () => {
  const rows = emptyRows();
  rows[11] = 'RCR...';
  const { state, run } = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  run(2, () => [16, 0]);
  run(4, () => [0, 0]);
  run(2, () => [16, 0]);
  assert.equal(state.players[0].grid[11][0]?.color, 0, 'two swaps land back on the original order');
  assert.equal(state.players[0].grid[11][1]?.color, 1);
});

test('the cursor cannot leave the board', () => {
  const { state, run } = fixture({ cursor: { x: 0, y: 0 } });
  run(40, () => [4, 0]);
  assert.equal(state.players[0].cursor.x, 0);
  run(40, () => [1, 0]);
  assert.equal(state.players[0].cursor.y, 0);
  run(200, () => [8, 0]);
  assert.equal(state.players[0].cursor.x, 4, 'the cursor spans two columns, so it stops at column 4');
});

