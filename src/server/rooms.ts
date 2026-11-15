// Rooms, matchmaking and the authoritative 60 Hz match loop.
//
// The server owns the input timeline: for every tick it either has both inputs or it waits,
// and once it decides, that decision is what every client applies. That is what keeps three
// independent simulations in agreement.

import type { WebSocket } from 'ws';
import type { DifficultyId, MatchState, ModeId } from '../core/types.ts';
import { createMatch, createRules, step } from '../core/simulate.ts';
import type { Rules } from '../core/simulate.ts';
import { hashState, snapshot } from '../core/hash.ts';
import type { InputFrame, MatchStats, PlayerInfo, RoomPhase } from '../protocol.ts';
import { DEFAULT_INPUT_DELAY, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, STALL_LIMIT_TICKS, encode } from '../protocol.ts';

/** How many resolved input frames are kept so a late joiner can catch up. */
const HISTORY_LIMIT = 900;
/** Countdown before a match starts, in ticks. */
export const COUNTDOWN_TICKS = 180;

export interface Peer {
  id: string;
  name: string;
  token: string;
  socket: WebSocket | null;
  ready: boolean;
  ping: number;
  inputs: Map<number, number>;
}

/** Writes a message to a peer if it still has a live socket. */
export function send(peer: Peer, message: Record<string, unknown>): void {
  if (peer.socket && peer.socket.readyState === 1) peer.socket.send(encode(message as never));
}

export class Room {
  code: string;
  mode: ModeId;
  difficulty: DifficultyId;
  phase: RoomPhase = 'waiting';
  peers: [Peer, Peer];
  spectators = new Set<Peer>();
  state: MatchState;
  rules: Rules;
  /** The tick that has not been simulated yet. */
  tick = 0;
  countdown = 0;
  inputDelay = DEFAULT_INPUT_DELAY;
  stall = 0;
  history: InputFrame[] = [];
  /** State fingerprint after every simulated tick; used to find a divergence offline. */
  hashLog: { tick: number; hash: number }[] = [];
  createdAt = Date.now();
  maxChain: [number, number] = [0, 0];
  rematchVotes: [boolean, boolean] = [false, false];
  /** Counts the matches played in this room so a rematch is never the same board again. */
  matchNumber = 0;

  constructor(code: string, mode: ModeId, difficulty: DifficultyId, host: Peer) {
    this.code = code;
    this.mode = mode;
    this.difficulty = difficulty;
    this.peers = [host, Room.placeholder()];
    this.rules = createRules(mode, difficulty);
    this.state = createMatch(1, mode, difficulty);
  }

  static placeholder(): Peer {
    return { id: 'empty', name: '', token: '', socket: null, ready: false, ping: 0, inputs: new Map() };
  }

  static seedFrom(code: string, salt: number): number {
    let h = 0x811c9dc5;
    const text = code + ':' + salt;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  playerInfo(index: number): PlayerInfo {
    const peer = this.peers[index];
    return { name: peer.name, ready: peer.ready, connected: peer.socket !== null, ping: peer.ping };
  }

  isFull(): boolean {
    return this.peers[1].socket !== null;
  }

  broadcast(message: Record<string, unknown>, includeSpectators = true): void {
    for (const peer of this.peers) send(peer, message);
    if (includeSpectators) for (const peer of this.spectators) send(peer, message);
  }

  indexOf(peer: Peer): number {
    return this.peers[0] === peer ? 0 : this.peers[1] === peer ? 1 : -1;
  }

  roomMessage(selfIndex: number): Record<string, unknown> {
    return {
      t: 'room',
      code: this.code,
      phase: this.phase,
      mode: this.mode,
      difficulty: this.difficulty,
      selfIndex,
      isHost: selfIndex === 0,
      players: [this.playerInfo(0), this.playerInfo(1)],
    };
  }

  sendRoomState(): void {
    for (let i = 0; i < 2; i++) {
      const peer = this.peers[i];
      if (peer.socket) send(peer, this.roomMessage(i));
    }
    for (const peer of this.spectators) send(peer, this.roomMessage(-1));
  }

  maybeStart(): void {
    if (this.phase !== 'waiting') return;
    if (!this.peers[0].socket || !this.peers[1].socket) return;
    if (!this.peers[0].ready || !this.peers[1].ready) return;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_TICKS;
    this.broadcast({ t: 'countdown', ticks: COUNTDOWN_TICKS });
  }

  beginMatch(): void {
    this.phase = 'playing';
    this.tick = 0;
    this.history = [];
    this.hashLog = [];
    this.stall = 0;
    this.maxChain = [0, 0];
    this.rematchVotes = [false, false];
    this.matchNumber += 1;
    this.state = createMatch(Room.seedFrom(this.code, this.createdAt + this.matchNumber * 7919), this.mode, this.difficulty);
    for (const peer of this.peers) {
      peer.inputs.clear();
      peer.ready = false;
    }
    for (let i = 0; i < 2; i++) {
      send(this.peers[i], {
        t: 'start',
        seed: this.state.seed,
        startTick: 0,
        inputDelay: this.inputDelay,
        selfIndex: i,
        mode: this.mode,
        difficulty: this.difficulty,
      });
    }
  }

  /** Advances the match by at most one tick. */
  stepMatch(): boolean {
    if (this.phase !== 'playing') return false;
    if (!this.peers[0].socket || !this.peers[1].socket) return false;
    const bothReady = this.peers[0].inputs.has(this.tick) && this.peers[1].inputs.has(this.tick);
    if (!bothReady) {
      this.stall += 1;
      if (this.stall < STALL_LIMIT_TICKS) return false;
    }
    this.stall = 0;
    const p0 = this.peers[0].inputs.get(this.tick) ?? 0;
    const p1 = this.peers[1].inputs.get(this.tick) ?? 0;
    this.peers[0].inputs.delete(this.tick);
    this.peers[1].inputs.delete(this.tick);
    const frame: InputFrame = { tick: this.tick, p0, p1 };
    this.history.push(frame);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();

    step(this.state, [{ buttons: p0 }, { buttons: p1 }], this.rules);
    for (let i = 0; i < 2; i++) {
      const player = this.state.players[i];
      this.maxChain[i] = Math.max(this.maxChain[i], player.chainDisplay, player.chainCount);
    }

    this.broadcast({ t: 'inputs', frames: [frame] });
    this.tick += 1;
    this.hashLog.push({ tick: this.tick, hash: hashState(this.state) });
    if (this.hashLog.length > 4000) this.hashLog.shift();
    if (this.state.finished) {
      this.finish(this.state.winner ?? -1, this.state.winner === -1 ? 'draw' : 'knockout');
    }
    return true;
  }

  finish(winner: number, reason: string): void {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    const stats: MatchStats = {
      score: [this.state.players[0].score, this.state.players[1].score],
      panelsCleared: [this.state.players[0].panelsCleared, this.state.players[1].panelsCleared],
      maxChain: this.maxChain,
      ticks: this.state.tick,
    };
    this.broadcast({ t: 'end', winner, reason, stats });
  }

  /** The authoritative fingerprint of a past tick, or null if it has scrolled out. */
  hashAt(tick: number): number | null {
    for (let i = this.hashLog.length - 1; i >= 0; i--) {
      const entry = this.hashLog[i];
      if (entry.tick === tick) return entry.hash;
      if (entry.tick < tick) return null;
    }
    return null;
  }

  /** Brings a reconnecting player or a fresh spectator up to date. */
  resyncPeer(peer: Peer, index: number): void {
    send(peer, this.roomMessage(index));
    if (this.phase === 'playing' || this.phase === 'finished') {
      send(peer, {
        t: 'start',
        seed: this.state.seed,
        startTick: 0,
        inputDelay: this.inputDelay,
        selfIndex: index,
        mode: this.mode,
        difficulty: this.difficulty,
      });
      send(peer, { t: 'snapshot', tick: this.tick, state: snapshot(this.state) });
    }
  }

  voteRematch(index: number): void {
    this.rematchVotes[index] = true;
    this.broadcast({ t: 'rematchVote', votes: this.rematchVotes });
    if (!this.rematchVotes[0] || !this.rematchVotes[1]) return;
    if (!this.peers[0].socket || !this.peers[1].socket) return;
    this.phase = 'waiting';
    this.peers[0].ready = true;
    this.peers[1].ready = true;
    this.sendRoomState();
    this.maybeStart();
  }
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  byPeer = new Map<Peer, Room>();

  create(mode: ModeId, difficulty: DifficultyId, host: Peer): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, mode, difficulty, host);
    this.rooms.set(code, room);
    this.byPeer.set(host, room);
    return room;
  }

  get(code: string): Room | null {
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  join(code: string, peer: Peer): Room | null {
    const room = this.get(code);
    if (!room) return null;
    if (room.peers[1].socket !== null) return null;
    room.peers[1] = peer;
    room.phase = 'waiting';
    room.peers[0].ready = false;
    room.peers[1].ready = false;
    this.byPeer.set(peer, room);
    return room;
  }

  watch(code: string, peer: Peer): Room | null {
    const room = this.get(code);
    if (!room) return null;
    room.spectators.add(peer);
    this.byPeer.set(peer, room);
    return room;
  }

  remove(peer: Peer): void {
    const room = this.byPeer.get(peer);
    this.byPeer.delete(peer);
    if (!room) return;
    const index = room.indexOf(peer);
    if (index >= 0) {
      room.peers[index].socket = null;
      if (room.phase === 'playing') {
        room.finish(1 - index, 'opponent disconnected');
      }
    }
    room.spectators.delete(peer);
    this.cleanup();
  }

  findByToken(token: string): { room: Room; index: number } | null {
    if (!token) return null;
    for (const room of this.rooms.values()) {
      for (let i = 0; i < 2; i++) {
        if (room.peers[i].token && room.peers[i].token === token) return { room, index: i };
      }
    }
    return null;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const empty = room.peers.every((peer) => peer.socket === null) && room.spectators.size === 0;
      const stale = now - room.createdAt > 1000 * 60 * 60 * 3;
      if (empty || stale) this.rooms.delete(code);
    }
  }
}
