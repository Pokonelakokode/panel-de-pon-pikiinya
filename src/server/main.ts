// The game server: one process, one port. It serves the built client in production and
// always speaks the game protocol on /ws.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../protocol.ts';
import { PROTOCOL_VERSION, decode, encode } from '../protocol.ts';
import { RoomManager } from './rooms.ts';
import type { Peer } from './rooms.ts';
import { send } from './rooms.ts';
import { hashState } from '../core/hash.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(process.cwd(), 'dist');
const IS_PROD = process.env.NODE_ENV === 'production';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.spc': 'application/octet-stream',
  '.wav': 'audio/wav',
};

let distAvailable = false;

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/hashes') {
    const room = manager.get(url.searchParams.get('code') ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(room ? room.hashLog.slice(-2000) : []));
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, players: countConnections() }));
    return;
  }
  if (!distAvailable) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The client bundle is not built yet. Run pnpm build, or use the Vite dev server on port 5173.');
    return;
  }
  const relative = normalize(url.pathname).replace(/^(..[/\\])+/, '');
  let filePath = join(DIST, relative);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    if (url.pathname.startsWith('/ost/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    filePath = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

const manager = new RoomManager();
const server = createServer((req, res) => {
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

function countConnections(): number {
  let total = 0;
  for (const client of wss.clients) if (client.readyState === 1) total += 1;
  return total;
}

interface Session {
  peer: Peer;
  socket: WebSocket;
  alive: boolean;
}

const sessions = new Map<WebSocket, Session>();

function makePeer(socket: WebSocket): Peer {
  return {
    id: randomUUID(),
    name: 'Player',
    token: randomUUID(),
    socket,
    ready: false,
    ping: 0,
    inputs: new Map(),
  };
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (socket: WebSocket) => {
  const session: Session = { peer: makePeer(socket), socket, alive: true };
  sessions.set(socket, session);
  send(session.peer, { t: 'welcome', playerId: session.peer.id, token: session.peer.token, ver: PROTOCOL_VERSION });

  socket.on('pong', () => {
    session.alive = true;
  });

  socket.on('message', (raw) => {
    const message = decode(raw.toString()) as ClientMessage | null;
    if (!message) return;
    handle(session, message);
  });

  socket.on('close', () => {
    sessions.delete(socket);
    manager.remove(session.peer);
    const room = manager.byPeer.get(session.peer);
    if (room) room.sendRoomState();
  });
});

function handle(session: Session, message: ClientMessage): void {
  const peer = session.peer;
  switch (message.t) {
    case 'hello': {
      if (message.ver !== PROTOCOL_VERSION) {
        send(peer, { t: 'error', code: 'version', message: 'This tab is running a different build. Reload the page.' });
        return;
      }
      if (message.name) peer.name = message.name.slice(0, 16);
      const resumed = message.token ? manager.findByToken(message.token) : null;
      if (resumed) {
        peer.token = message.token as string;
        peer.name = resumed.room.peers[resumed.index].name || peer.name;
        resumed.room.peers[resumed.index] = peer;
        manager.byPeer.set(peer, resumed.room);
        resumed.room.resyncPeer(peer, resumed.index);
      }
      return;
    }
    case 'create': {
      if (message.name) peer.name = message.name.slice(0, 16);
      const room = manager.create(message.mode, message.difficulty, peer);
      room.sendRoomState();
      return;
    }
    case 'join': {
      if (message.name) peer.name = message.name.slice(0, 16);
      const room = manager.join(message.code, peer);
      if (!room) {
        send(peer, { t: 'error', code: 'noroom', message: 'No open room with that code.' });
        return;
      }
      room.sendRoomState();
      return;
    }
    case 'watch': {
      const room = manager.watch(message.code, peer);
      if (!room) {
        send(peer, { t: 'error', code: 'noroom', message: 'No room with that code.' });
        return;
      }
      room.resyncPeer(peer, -1);
      return;
    }
    case 'ready': {
      const room = manager.byPeer.get(peer);
      if (!room) return;
      const index = room.indexOf(peer);
      if (index < 0) return;
      room.peers[index].ready = message.ready;
      room.sendRoomState();
      room.maybeStart();
      return;
    }
    case 'input': {
      const room = manager.byPeer.get(peer);
      if (!room || room.phase !== 'playing') return;
      const index = room.indexOf(peer);
      if (index < 0) return;
      const tick = Math.max(0, Math.floor(message.tick));
      if (tick < room.tick - 4 || tick > room.tick + 120) return;
      room.peers[index].inputs.set(tick, message.buttons & 255);
      return;
    }
    case 'hash': {
      const room = manager.byPeer.get(peer);
      if (!room || room.phase !== 'playing') return;
      const index = room.indexOf(peer);
      if (index < 0) return;
      const mine = room.hashAt(message.tick);
      if (mine !== null && mine !== message.hash) {
        send(peer, { t: 'error', code: 'desync', message: 'State diverged, resyncing.' });
        room.resyncPeer(peer, index);
      }
      return;
    }
    case 'rematch': {
      const room = manager.byPeer.get(peer);
      if (!room) return;
      const index = room.indexOf(peer);
      if (index >= 0) room.voteRematch(index);
      return;
    }
    case 'leave': {
      manager.remove(peer);
      return;
    }
    case 'ping': {
      const room = manager.byPeer.get(peer);
      send(peer, { t: 'pong', id: message.id, tick: room ? room.tick : 0 });
      return;
    }
  }
}


// ---------------------------------------------------------------------------
// The 60 Hz authority loop
// ---------------------------------------------------------------------------

const TICK_MS = 1000 / 60;
const MAX_CATCHUP = 5;
let lastTime = Date.now();
let accumulator = 0;
let heartbeatAt = 0;

function loop(): void {
  const now = Date.now();
  const elapsed = Math.min(now - lastTime, 250);
  lastTime = now;
  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= TICK_MS && steps < MAX_CATCHUP) {
    accumulator -= TICK_MS;
    steps += 1;
    for (const room of manager.rooms.values()) {
      if (room.phase === 'countdown') {
        room.countdown -= 1;
        if (room.countdown <= 0) room.beginMatch();
      } else if (room.phase === 'playing') {
        room.stepMatch();
      }
    }
  }
  if (steps > 0 && accumulator > 1000) accumulator = 0;
  if (now - heartbeatAt > 1000) {
    heartbeatAt = now;
    for (const [socket, session] of sessions) {
      if (!session.alive) {
        socket.terminate();
        continue;
      }
      session.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
    manager.cleanup();
  }
}

setInterval(loop, 4);

async function main(): Promise<void> {
  try {
    await stat(join(DIST, 'index.html'));
    distAvailable = true;
  } catch {
    distAvailable = false;
  }
  server.listen(PORT, HOST, () => {
    const mode = IS_PROD ? 'production' : 'development';
    console.log('panel de pon server listening on http://' + HOST + ':' + PORT + ' (' + mode + ')');
    if (!distAvailable) {
      console.log('no client bundle in dist/ - use the Vite dev server on http://localhost:5173');
    }
  });
}

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

void main();
