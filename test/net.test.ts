// End to end netcode test: a real server process and two real clients, both running the
// actual client-side Game controller. If the three simulations ever disagree the server
// answers with a desync error, which fails this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Game } from '../src/client/game.ts';
import { createMatch } from '../src/core/simulate.ts';
import { canonical, hashState } from '../src/core/hash.ts';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import type { InputFrame } from '../src/protocol.ts';

const PORT = 18871;

interface TestClient {
  socket: WebSocket;
  game: Game;
  errors: string[];
  finished: boolean;
  tick: number;
  hashes: Map<number, number>;
  states: Map<number, string>;
}

function connect(): Promise<WebSocket> {
  const socket = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function send(socket: WebSocket, message: Record<string, unknown>): void {
  socket.send(JSON.stringify(message));
}

function makeClient(socket: WebSocket, script: (tick: number) => number): TestClient {
  const client: TestClient = {
    socket,
    game: new Game({ mode: 'vs', difficulty: 'normal', solo: false, useCpu: false }, {
      onStatus: () => {},
      onSound: () => {},
    }),
    errors: [],
    finished: false,
    tick: 0,
    hashes: new Map(),
    states: new Map(),
  };
  client.game.onTickApplied = (state) => {
    if (state.tick <= 400) client.hashes.set(state.tick, hashState(state));
    if (state.tick >= 60 && state.tick <= 90 && !client.states.has(state.tick)) client.states.set(state.tick, canonical(state));
  };
  client.game.onInput = (tick, buttons) => send(socket, { t: 'input', tick, buttons });
  client.game.onFinish = () => { client.finished = true; };

  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.t === 'error') client.errors.push(message.code + ': ' + message.message);
    if (message.t === 'start') {
      const state = createMatch(message.seed, message.mode, message.difficulty);
      client.game.startOnline(state, message.selfIndex, message.inputDelay);
    }
    if (message.t === 'inputs') {
      client.game.receiveInputs(message.frames as InputFrame[]);
      for (const frame of message.frames as InputFrame[]) client.tick = Math.max(client.tick, frame.tick + 1);
    }
    if (message.t === 'snapshot') client.game.applySnapshot(message.state, message.tick);
    if (message.t === 'end') client.finished = true;
  });

  let last = 0;
  const pump = () => {
    const now = performance.now();
    client.game.frame(now, () => script(client.tick));
    if (now - last > 50) {
      last = now;
      send(socket, { t: 'hash', tick: client.game.state ? client.game.state.tick : 0, hash: client.game.state ? hashState(client.game.state) : 0 });
    }
  };
  const interval = setInterval(pump, 8);
  socket.on('close', () => clearInterval(interval));
  return client;
}

async function waitFor(predicate: () => boolean, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('two clients stay in lockstep with the server', async () => {
  const server: ChildProcess = spawn(process.execPath, ['src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout?.on('data', (chunk) => { output += String(chunk); });
  server.stderr?.on('data', (chunk) => { output += String(chunk); });

  try {
    await waitFor(() => output.includes('listening'));

    const socketA = await connect();
    const socketB = await connect();
    const clientA = makeClient(socketA, (tick) => (Math.floor(tick / 11) % 3 === 0 ? 16 : Math.floor(tick / 5) % 2 === 0 ? 2 : 0));
    const clientB = makeClient(socketB, (tick) => (Math.floor(tick / 9) % 4 === 0 ? 16 : Math.floor(tick / 7) % 2 === 0 ? 8 : 0));

    const rooms: Record<string, any> = {};
    const codes: string[] = [];
    socketA.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.t === 'welcome') send(socketA, { t: 'hello', ver: PROTOCOL_VERSION, name: 'Alpha' });
      if (message.t === 'room') rooms.A = message;
      if (message.t === 'room' && !codes.includes(message.code)) codes.push(message.code);
    });
    socketB.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.t === 'welcome') send(socketB, { t: 'hello', ver: PROTOCOL_VERSION, name: 'Beta' });
      if (message.t === 'room') rooms.B = message;
    });

    send(socketA, { t: 'create', mode: 'vs', difficulty: 'normal', name: 'Alpha' });
    await waitFor(() => Boolean(rooms.A));
    send(socketB, { t: 'join', code: rooms.A.code, name: 'Beta' });
    await waitFor(() => Boolean(rooms.B) && rooms.B.players[1].connected);

    send(socketA, { t: 'ready', ready: true });
    send(socketB, { t: 'ready', ready: true });

    const simTick = (client: TestClient) => (client.game.state ? client.game.state.tick : 0);
    await waitFor(() => simTick(clientA) > 300 && simTick(clientA) === simTick(clientB), 40000);

    assert.ok(clientA.game.state, 'client A is simulating a match');
    assert.ok(clientB.game.state, 'client B is simulating a match');
    if (clientA.errors.length > 0 || clientB.errors.length > 0) {
      const response = await fetch('http://127.0.0.1:' + PORT + '/api/hashes?code=' + rooms.A.code);
      const serverLog = (await response.json()) as { tick: number; hash: number }[];
      const serverAt = new Map(serverLog.map((entry) => [entry.tick, entry.hash]));
      let firstBad = -1;
      for (const [tick, hash] of clientA.hashes) {
        if (serverAt.has(tick) && serverAt.get(tick) !== hash) { firstBad = tick; break; }
      }
      let firstBadB = -1;
      for (const [tick, hash] of clientB.hashes) {
        if (serverAt.has(tick) && serverAt.get(tick) !== hash) { firstBadB = tick; break; }
      }
      const detail = [
        'client A first divergence at tick ' + firstBad,
        'client B first divergence at tick ' + firstBadB,
        'server logged ' + serverLog.length + ' ticks, last at ' + (serverLog.at(-1)?.tick ?? -1),
        'client A reached ' + clientA.tick + ', client B reached ' + clientB.tick,
        'errors A: ' + clientA.errors.join(' | '),
        'errors B: ' + clientB.errors.join(' | '),
      ].join(String.fromCharCode(10));
      assert.fail(detail);
    }
    assert.equal(clientA.errors.length, 0, 'client A saw no protocol errors: ' + clientA.errors.join(', '));
    assert.equal(clientB.errors.length, 0, 'client B saw no protocol errors: ' + clientB.errors.join(', '));

    const stateA = clientA.game.state as NonNullable<typeof clientA.game.state>;
    const stateB = clientB.game.state as NonNullable<typeof clientB.game.state>;
    const common = Math.min(stateA.tick, stateB.tick);
    assert.ok(common > 200, 'both clients simulated at least two hundred ticks, got ' + common);
    let divergent = -1;
    for (const [tick, hash] of clientA.hashes) {
      const other = clientB.hashes.get(tick);
      if (other !== undefined && other !== hash) { divergent = tick; break; }
    }
    if (divergent >= 0 || hashState(stateA) !== hashState(stateB)) {
      const a = clientA.states.get(divergent) ?? canonical(stateA);
      const b = clientB.states.get(divergent) ?? canonical(stateB);
      let index = 0;
      while (index < Math.min(a.length, b.length) && a[index] === b[index]) index += 1;
      const detail = [
        'first divergent tick: ' + divergent,
        'context A: ' + a.slice(Math.max(0, index - 90), index + 90),
        'context B: ' + b.slice(Math.max(0, index - 90), index + 90),
        'client A reached ' + stateA.tick + ', client B reached ' + stateB.tick,
      ].join(String.fromCharCode(10));
      assert.fail(detail);
    }
    assert.equal(hashState(stateA), hashState(stateB), 'both clients agree on the board');
    assert.ok(clientA.game.inputDelay >= 1 && clientB.game.inputDelay >= 1);

    socketA.close();
    socketB.close();
  } finally {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => undefined);
  }
});

