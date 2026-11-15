// Drives the room state machine directly, so the rematch path is covered without waiting
// for a real match to finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, COUNTDOWN_TICKS } from '../src/server/rooms.ts';
import type { Peer } from '../src/server/rooms.ts';

interface Stub { readyState: number; sent: Record<string, unknown>[]; send(data: string): void }

function makePeer(): { peer: Peer; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const stub: Stub = {
    readyState: 1,
    sent,
    send(data: string) { sent.push(JSON.parse(data)); },
  };
  const peer = {
    id: Math.random().toString(36).slice(2),
    name: 'P',
    token: Math.random().toString(36).slice(2),
    socket: stub,
    ready: false,
    ping: 0,
    inputs: new Map<number, number>(),
  } as unknown as Peer;
  return { peer, sent };
}

function starts(sent: Record<string, unknown>[]): Record<string, unknown>[] {
  return sent.filter((m) => m.t === 'start');
}

test('a rematch only starts once both players agree, and it is a fresh match', () => {
  const manager = new RoomManager();
  const a = makePeer();
  const b = makePeer();
  const room = manager.create('vs', 'normal', a.peer);
  assert.ok(manager.join(room.code, b.peer));

  a.peer.ready = true;
  b.peer.ready = true;
  room.maybeStart();
  assert.equal(room.phase, 'countdown');
  assert.equal(room.countdown, COUNTDOWN_TICKS);

  room.beginMatch();
  assert.equal(room.phase, 'playing');
  const firstSeed = starts(a.sent)[0].seed;
  assert.equal(typeof firstSeed, 'number');
  assert.deepEqual(starts(a.sent)[0].selfIndex, 0);
  assert.deepEqual(starts(b.sent)[0].selfIndex, 1);

  room.finish(0, 'knockout');
  assert.equal(room.phase, 'finished');
  assert.equal(a.sent.filter((m) => m.t === 'end').length, 1);

  room.voteRematch(0);
  assert.equal(room.phase, 'finished', 'one vote is not enough');
  assert.ok(a.sent.some((m) => m.t === 'rematchVote'));

  room.voteRematch(1);
  assert.equal(room.phase, 'countdown', 'both votes start the countdown again');
  assert.equal(room.countdown, COUNTDOWN_TICKS);

  room.countdown = 0;
  room.beginMatch();
  const secondSeed = starts(a.sent)[1].seed;
  assert.notEqual(secondSeed, firstSeed, 'a rematch is a different board');
  assert.equal(room.tick, 0);
  assert.equal(room.state.tick, 0);
  assert.equal(room.phase, 'playing');
});

test('a rematch cannot start when the other player is gone', () => {
  const manager = new RoomManager();
  const a = makePeer();
  const b = makePeer();
  const room = manager.create('vs', 'normal', a.peer);
  manager.join(room.code, b.peer);
  a.peer.ready = true;
  b.peer.ready = true;
  room.maybeStart();
  room.beginMatch();
  room.finish(0, 'knockout');
  b.peer.socket = null;
  room.voteRematch(0);
  assert.equal(room.phase, 'finished');
});

