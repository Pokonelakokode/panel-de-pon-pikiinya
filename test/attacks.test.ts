import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptyRows } from './helpers.ts';
import { comboWidths } from '../src/core/simulate.ts';

test('a plain three match sends nothing', () => {
  const rows = emptyRows();
  rows[11] = 'RRR...';
  const { state, run } = fixture({ board: rows });
  run(4);
  assert.equal(state.players[1].incoming.length, 0);
});

test('a four panel combo sends a three wide piece', () => {
  const rows = emptyRows();
  rows[11] = 'RRRR..';
  const { state, run } = fixture({ board: rows });
  run(4);
  assert.equal(state.players[1].incoming.length, 1);
  assert.equal(state.players[1].incoming[0].w, 3);
  assert.equal(state.players[1].incoming[0].metal, false);
});

test('combo garbage widths follow the original table', () => {
  assert.deepEqual(comboWidths(3), []);
  assert.deepEqual(comboWidths(4), [3]);
  assert.deepEqual(comboWidths(7), [6]);
  assert.deepEqual(comboWidths(8), [3, 4]);
  assert.deepEqual(comboWidths(10), [5, 5]);
  assert.deepEqual(comboWidths(13), [6, 6, 6]);
  assert.deepEqual(comboWidths(14), [6, 6, 6, 6]);
  assert.deepEqual(comboWidths(20), [6, 6, 6, 6, 6, 6]);
  assert.deepEqual(comboWidths(27), [6, 6, 6, 6, 6, 6, 6, 6]);
  assert.deepEqual(comboWidths(40), [6, 6, 6, 6, 6, 6, 6, 6]);
});

test('new attacks hold back the garbage that is already queued', () => {
  const rows = emptyRows();
  rows[11] = 'RRRR..';
  const { state, run } = fixture({ board: rows });
  run(4);
  const delay = state.players[1].incomingDelay[0];
  assert.ok(delay > 100 && delay <= 150, "staging, telegraph and transit add up to " + delay);
});

test('clearing into another match builds a chain and sends chain garbage', () => {
  const rows = emptyRows();
  rows[7] = 'G.....';
  rows[8] = 'G.....';
  rows[9] = 'RRR...';
  rows[10] = 'GCGCGC';
  rows[11] = 'CGCGCG';
  const { state, run } = fixture({ board: rows });
  for (let i = 0; i < 200; i++) run(1);
  const player = state.players[0];
  assert.ok(player.panelsCleared >= 6, 'the red row and the green column both clear');
  const chainPieces = state.players[1].incoming.filter((piece) => piece.isChain);
  const chainBlocks = state.players[1].garbage.filter((block) => block.w === 6 && block.h === 1);
  assert.ok(chainPieces.length + chainBlocks.length > 0);
});

test('the chain counter starts at two, not one', () => {
  const rows = emptyRows();
  rows[7] = 'G.....';
  rows[8] = 'G.....';
  rows[9] = 'RRR...';
  rows[10] = 'GCGCGC';
  rows[11] = 'CGCGCG';
  const { state, run } = fixture({ board: rows });
  let sawTwo = false;
  for (let i = 0; i < 200; i++) {
    run(1);
    if (state.players[0].chainDisplay === 2) sawTwo = true;
    if (state.players[0].chainDisplay === 1) throw new Error("a chain can never display as x1");
  }
  assert.ok(sawTwo);
});

test('a combo banks stop time', () => {
  const rows = emptyRows();
  rows[11] = 'RRRR..';
  const { state, run } = fixture({ board: rows });
  run(4);
  assert.ok(state.players[0].stopTime >= 120, "a combo banks 120 frames of stop time");
});

test('clearing shock panels sends metal garbage', () => {
  const rows = emptyRows();
  rows[11] = '!!!...';
  const { state, run } = fixture({ board: rows });
  run(4);
  const metal = state.players[1].incoming.filter((piece) => piece.metal);
  assert.equal(metal.length, 1);
});

