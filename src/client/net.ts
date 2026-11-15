// Thin WebSocket wrapper: connect, reconnect with backoff, and typed send/receive.

import type { ClientMessage, ServerMessage } from '../protocol.ts';
import { PROTOCOL_VERSION, decode, encode } from '../protocol.ts';

export type NetStatus = 'connecting' | 'open' | 'closed';

export class Net {
  socket: WebSocket | null = null;
  status: NetStatus = 'closed';
  rtt = 0;
  token = '';
  name = 'Player';

  onMessage: (message: ServerMessage) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};

  private pingId = 0;
  private pingSent = new Map<number, number>();
  private pingTimer: number | null = null;
  private retry = 0;
  private url: string;
  private closedByUser = false;

  constructor(url: string) {
    this.url = url;
    this.token = sessionStorage.getItem('pdp.token') ?? '';
    this.name = sessionStorage.getItem('pdp.name') ?? 'Player';
  }

  connect(): void {
    this.closedByUser = false;
    this.status = 'connecting';
    this.onStatus(this.status);
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.status = 'open';
      this.onStatus(this.status);
      this.send({ t: 'hello', ver: PROTOCOL_VERSION, name: this.name, token: this.token || undefined });
      this.startPinging();
    };
    socket.onmessage = (event) => {
      const message = decode(String(event.data)) as ServerMessage | null;
      if (!message) return;
      this.handle(message);
      this.onMessage(message);
    };
    socket.onclose = () => {
      this.status = 'closed';
      this.onStatus(this.status);
      this.stopPinging();
      if (this.closedByUser) return;
      this.retry += 1;
      const delay = Math.min(500 * this.retry, 4000);
      window.setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => socket.close();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopPinging();
    this.socket?.close();
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encode(message));
    }
  }

  private handle(message: ServerMessage): void {
    if (message.t === 'welcome') {
      this.token = message.token;
      sessionStorage.setItem('pdp.token', message.token);
    } else if (message.t === 'pong') {
      const sent = this.pingSent.get(message.id);
      if (sent !== undefined) {
        this.rtt = Math.max(0, Math.round(performance.now() - sent));
        this.pingSent.delete(message.id);
      }
    }
  }

  private startPinging(): void {
    this.stopPinging();
    this.pingTimer = window.setInterval(() => {
      this.pingId += 1;
      this.pingSent.set(this.pingId, performance.now());
      this.send({ t: 'ping', id: this.pingId });
    }, 1000);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}

export function defaultSocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + location.host + '/ws';
}

