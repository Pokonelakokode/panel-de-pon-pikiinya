export type OnlineGameKind = 'pdp' | 'pikiinya';
export type OnlineRole = 'host' | 'client' | null;

export interface OnlineStatusSnapshot {
  connected: boolean;
  connecting: boolean;
  role: OnlineRole;
  roomCode: string | null;
  game: OnlineGameKind;
  localName: string;
  peerName: string | null;
  pingMs: number | null;
  inMatch: boolean;
  options: Record<string, unknown>;
}

type Listener = (payload: any) => void;

export class OnlineClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pingTimer: number | null = null;
  private pingSeq = 0;
  private listeners = new Map<string, Set<Listener>>();

  connected = false;
  connecting = false;
  role: OnlineRole = null;
  roomCode: string | null = null;
  game: OnlineGameKind = 'pdp';
  localName = 'Player';
  peerName: string | null = null;
  pingMs: number | null = null;
  inMatch = false;
  seed = 1;
  options: Record<string, unknown> = {};

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[onlineClient listener error]', event, err);
      }
    }
  }

  getStatus(): OnlineStatusSnapshot {
    return {
      connected: this.connected,
      connecting: this.connecting,
      role: this.role,
      roomCode: this.roomCode,
      game: this.game,
      localName: this.localName,
      peerName: this.peerName,
      pingMs: this.pingMs,
      inMatch: this.inMatch,
      options: { ...this.options },
    };
  }

  getInviteUrl(): string | null {
    if (!this.roomCode) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomCode);
    url.searchParams.set('game', this.game);
    return url.toString();
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connecting = true;
    this.emit('status', this.getStatus());

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      let settled = false;

      ws.onopen = () => {
        this.connected = true;
        this.connecting = false;
        this.startPingLoop();
        this.emit('status', this.getStatus());
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!msg || typeof msg.t !== 'string') return;
        this.handleMessage(msg);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          this.connecting = false;
          this.connectPromise = null;
          this.emit('status', this.getStatus());
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = () => {
        const wasInRoom = this.roomCode !== null;
        this.connected = false;
        this.connecting = false;
        this.connectPromise = null;
        this.stopPingLoop();
        this.ws = null;
        if (wasInRoom) {
          this.role = null;
          this.roomCode = null;
          this.peerName = null;
          this.inMatch = false;
          this.emit('peer_left', { role: 'server', reason: 'Disconnected from server.' });
        }
        this.emit('status', this.getStatus());
      };
    });

    return this.connectPromise;
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.sendRaw({ t: 'net_ping', id: ++this.pingSeq, ts: Date.now() });
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ t: 'net_ping', id: ++this.pingSeq, ts: Date.now() });
      }
    }, 3000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendRaw(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  private handleMessage(msg: Record<string, any>): void {
    switch (msg.t) {
      case 'net_hosted':
        this.role = 'host';
        this.roomCode = String(msg.code ?? '');
        this.game = msg.game === 'pikiinya' ? 'pikiinya' : 'pdp';
        this.localName = String(msg.name ?? this.localName);
        this.peerName = null;
        this.inMatch = false;
        this.options = (msg.options && typeof msg.options === 'object') ? msg.options : {};
        this.emit('hosted', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_joined':
        this.role = 'client';
        this.roomCode = String(msg.code ?? '');
        this.game = msg.game === 'pikiinya' ? 'pikiinya' : 'pdp';
        this.localName = String(msg.name ?? this.localName);
        this.peerName = String(msg.hostName ?? 'Host');
        this.inMatch = false;
        this.options = (msg.options && typeof msg.options === 'object') ? msg.options : {};
        this.emit('joined', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_peer_joined':
        this.peerName = String(msg.peerName ?? 'Opponent');
        this.emit('peer_joined', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_peer_left':
        this.inMatch = false;
        if (msg.role === 'host') {
          this.role = null;
          this.roomCode = null;
          this.peerName = null;
        } else {
          this.peerName = null;
        }
        this.emit('peer_left', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_started':
        this.inMatch = true;
        this.game = msg.game === 'pikiinya' ? 'pikiinya' : 'pdp';
        this.seed = Number(msg.seed ?? 1);
        this.options = (msg.options && typeof msg.options === 'object') ? msg.options : {};
        this.emit('started', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_sync':
        this.emit('sync', msg);
        break;

      case 'net_attack':
        this.emit('attack', msg);
        break;

      case 'net_gameover':
        this.inMatch = false;
        this.emit('gameover', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_rematch_wait':
        this.emit('rematch_wait', msg);
        break;

      case 'net_left':
        this.role = null;
        this.roomCode = null;
        this.peerName = null;
        this.inMatch = false;
        this.emit('left', msg);
        this.emit('status', this.getStatus());
        break;

      case 'net_pong':
        if (typeof msg.ts === 'number' && msg.ts > 0) {
          this.pingMs = Math.max(1, Date.now() - msg.ts);
          this.emit('pong', { pingMs: this.pingMs });
          this.emit('status', this.getStatus());
        }
        break;

      case 'net_error':
        this.emit('error', msg);
        break;
    }
  }

  async hostRoom(game: OnlineGameKind, name: string, options: Record<string, unknown> = {}): Promise<void> {
    await this.connect();
    this.localName = name.trim() || 'Player 1';
    this.sendRaw({ t: 'net_host', game, name: this.localName, options });
  }

  async joinRoom(code: string, name: string): Promise<void> {
    await this.connect();
    this.localName = name.trim() || 'Player 2';
    this.sendRaw({ t: 'net_join', code: code.trim().toUpperCase(), name: this.localName });
  }

  startMatch(options?: Record<string, unknown>): void {
    this.sendRaw({ t: 'net_start', options });
  }

  sendSync(state: unknown): void {
    if (!this.inMatch) return;
    this.sendRaw({ t: 'net_sync', state });
  }

  sendAttack(attack: unknown): void {
    if (!this.inMatch) return;
    this.sendRaw({ t: 'net_attack', attack });
  }

  sendGameOver(summary?: unknown): void {
    if (!this.roomCode) return;
    this.inMatch = false;
    this.sendRaw({ t: 'net_gameover', summary });
  }

  requestRematch(): void {
    this.sendRaw({ t: 'net_rematch' });
  }

  leaveRoom(): void {
    this.inMatch = false;
    this.sendRaw({ t: 'net_leave' });
    this.role = null;
    this.roomCode = null;
    this.peerName = null;
    this.emit('status', this.getStatus());
  }
}

export const onlineClient = new OnlineClient();
(window as unknown as { onlineClient: OnlineClient }).onlineClient = onlineClient;
