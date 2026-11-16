import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../protocol.ts';

export type OnlineGameKind = 'pdp' | 'pikiinya';
export type OnlineRole = 'host' | 'client';

export interface OnlinePeer {
  id: string;
  name: string;
  role: OnlineRole;
  send: (payload: Record<string, unknown>) => void;
}

export interface OnlineRoom {
  code: string;
  game: OnlineGameKind;
  host: OnlinePeer;
  client: OnlinePeer | null;
  started: boolean;
  rematchHost: boolean;
  rematchClient: boolean;
  options: Record<string, unknown>;
}

export interface OnlineIncomingMessage {
  t: string;
  code?: unknown;
  name?: unknown;
  game?: unknown;
  options?: unknown;
  state?: unknown;
  attack?: unknown;
  summary?: unknown;
  id?: unknown;
  ts?: unknown;
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeGame(raw: unknown): OnlineGameKind {
  return raw === 'pikiinya' ? 'pikiinya' : 'pdp';
}

function sanitizeOptions(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export class OnlineRelayManager {
  readonly rooms = new Map<string, OnlineRoom>();
  readonly byPeer = new Map<OnlinePeer, OnlineRoom>();

  private generateCode(isTaken?: (code: string) => boolean): string {
    for (let attempt = 0; attempt < 128; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code) && !(isTaken && isTaken(code))) {
        return code;
      }
    }
    throw new Error('Failed to allocate unique online room code');
  }

  private getOpponent(room: OnlineRoom, peer: OnlinePeer): OnlinePeer | null {
    if (room.host === peer) return room.client;
    if (room.client === peer) return room.host;
    return null;
  }

  handleMessage(
    peer: OnlinePeer,
    msg: OnlineIncomingMessage,
    isCodeTaken?: (code: string) => boolean,
  ): boolean {
    switch (msg.t) {
      case 'net_host': {
        this.leave(peer);
        const game = sanitizeGame(msg.game);
        const name = sanitizeName(msg.name, 'Player 1');
        const options = sanitizeOptions(msg.options);
        const code = this.generateCode(isCodeTaken);
        peer.name = name;
        peer.role = 'host';
        const room: OnlineRoom = {
          code,
          game,
          host: peer,
          client: null,
          started: false,
          rematchHost: false,
          rematchClient: false,
          options,
        };
        this.rooms.set(code, room);
        this.byPeer.set(peer, room);
        peer.send({
          t: 'net_hosted',
          code,
          game,
          name,
          options,
        });
        return true;
      }

      case 'net_join': {
        this.leave(peer);
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        if (!code) {
          peer.send({ t: 'net_error', code: 'INVALID_CODE', message: 'Enter a valid 4-character room code.' });
          return true;
        }
        const room = this.rooms.get(code);
        if (!room) {
          peer.send({ t: 'net_error', code: 'NOT_FOUND', message: `Room "${code}" not found.` });
          return true;
        }
        if (room.client !== null) {
          peer.send({ t: 'net_error', code: 'ROOM_FULL', message: `Room "${code}" is already full.` });
          return true;
        }
        const name = sanitizeName(msg.name, 'Player 2');
        peer.name = name;
        peer.role = 'client';
        room.client = peer;
        room.rematchHost = false;
        room.rematchClient = false;
        this.byPeer.set(peer, room);
        peer.send({
          t: 'net_joined',
          code: room.code,
          game: room.game,
          name,
          hostName: room.host.name,
          options: room.options,
        });
        room.host.send({
          t: 'net_peer_joined',
          code: room.code,
          peerName: name,
        });
        return true;
      }

      case 'net_start': {
        const room = this.byPeer.get(peer);
        if (!room) {
          peer.send({ t: 'net_error', code: 'NO_ROOM', message: 'Not in an online room.' });
          return true;
        }
        if (room.host !== peer) {
          peer.send({ t: 'net_error', code: 'NOT_HOST', message: 'Only the host can start the match.' });
          return true;
        }
        if (!room.client) {
          peer.send({ t: 'net_error', code: 'NO_OPPONENT', message: 'Waiting for an opponent to join.' });
          return true;
        }
        if (msg.options !== undefined) {
          room.options = { ...room.options, ...sanitizeOptions(msg.options) };
        }
        room.started = true;
        room.rematchHost = false;
        room.rematchClient = false;
        const seed = ((Math.random() * 0x7fffffff) | 0) || 1;
        const payload = {
          t: 'net_started',
          code: room.code,
          game: room.game,
          seed,
          options: room.options,
          hostName: room.host.name,
          clientName: room.client.name,
        };
        room.host.send(payload);
        room.client.send(payload);
        return true;
      }

      case 'net_sync': {
        const room = this.byPeer.get(peer);
        if (!room) return true;
        const opponent = this.getOpponent(room, peer);
        if (opponent) {
          opponent.send({
            t: 'net_sync',
            from: peer.role,
            state: msg.state ?? null,
          });
        }
        return true;
      }

      case 'net_attack': {
        const room = this.byPeer.get(peer);
        if (!room) return true;
        const opponent = this.getOpponent(room, peer);
        if (opponent) {
          opponent.send({
            t: 'net_attack',
            from: peer.role,
            attack: msg.attack ?? null,
          });
        }
        return true;
      }

      case 'net_gameover': {
        const room = this.byPeer.get(peer);
        if (!room) return true;
        room.started = false;
        const payload = {
          t: 'net_gameover',
          loser: peer.role,
          loserName: peer.name,
          summary: msg.summary ?? null,
        };
        room.host.send(payload);
        if (room.client) room.client.send(payload);
        return true;
      }

      case 'net_rematch': {
        const room = this.byPeer.get(peer);
        if (!room || !room.client) return true;
        if (peer === room.host) room.rematchHost = true;
        else if (peer === room.client) room.rematchClient = true;

        if (room.rematchHost && room.rematchClient) {
          room.rematchHost = false;
          room.rematchClient = false;
          room.started = true;
          const seed = ((Math.random() * 0x7fffffff) | 0) || 1;
          const payload = {
            t: 'net_started',
            code: room.code,
            game: room.game,
            seed,
            options: room.options,
            hostName: room.host.name,
            clientName: room.client.name,
          };
          room.host.send(payload);
          room.client.send(payload);
        } else {
          const opponent = this.getOpponent(room, peer);
          if (opponent) {
            opponent.send({
              t: 'net_rematch_wait',
              from: peer.role,
              name: peer.name,
            });
          }
        }
        return true;
      }

      case 'net_leave': {
        this.leave(peer);
        peer.send({ t: 'net_left' });
        return true;
      }

      case 'net_ping': {
        peer.send({
          t: 'net_pong',
          id: msg.id ?? 0,
          ts: msg.ts ?? 0,
          serverTs: Date.now(),
        });
        return true;
      }

      default:
        return false;
    }
  }

  leave(peer: OnlinePeer): void {
    const room = this.byPeer.get(peer);
    if (!room) return;
    this.byPeer.delete(peer);

    if (room.host === peer) {
      if (room.client) {
        this.byPeer.delete(room.client);
        room.client.send({
          t: 'net_peer_left',
          role: 'host',
          reason: 'Host left the room.',
        });
      }
      this.rooms.delete(room.code);
    } else if (room.client === peer) {
      room.client = null;
      room.started = false;
      room.rematchHost = false;
      room.rematchClient = false;
      room.host.send({
        t: 'net_peer_left',
        role: 'client',
        reason: 'Opponent left the room.',
      });
    }
  }
}
