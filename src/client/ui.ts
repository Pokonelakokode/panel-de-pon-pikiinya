// All of the menus. Plain DOM, no framework: the game screen is a canvas and everything
// else is a handful of buttons.

import type { DifficultyId, ModeId } from '../core/types.ts';
import type { PlayerInfo, RoomPhase } from '../protocol.ts';

export interface LobbyState {
  code: string;
  phase: RoomPhase;
  mode: ModeId;
  difficulty: DifficultyId;
  players: PlayerInfo[];
  selfIndex: number;
  isHost: boolean;
}

export interface UiHandlers {
  onPlayOnline: () => void;
  onCreateRoom: (mode: ModeId, difficulty: DifficultyId, name: string) => void;
  onJoinRoom: (code: string, name: string) => void;
  onReady: (ready: boolean) => void;
  onRematch: () => void;
  onLeave: () => void;
  onSolo: (mode: ModeId, difficulty: DifficultyId, useCpu: boolean, startLevel: number) => void;
  onAgain: () => void;
  onToggleSound: (enabled: boolean) => void;
}

const DIFFICULTY_LABELS: Record<DifficultyId, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  shard: 'S-Hard',
};

export class Ui {
  private root: HTMLElement;
  private handlers: UiHandlers;
  private bound = false;
  private lobby: LobbyState | null = null;

  constructor(root: HTMLElement, handlers: UiHandlers) {
    this.root = root;
    this.handlers = handlers;
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      this.dispatch(target.getAttribute('data-action') ?? '');
    });
    this.root.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Enter') return;
      const action = (event.target as HTMLElement).getAttribute('data-enter');
      if (action) this.dispatch(action);
    });
  }

  private value(id: string): string {
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return element ? element.value : '';
  }

  private dispatch(action: string): void {
    const name = this.value('player-name');
    if (name) sessionStorage.setItem('pdp.name', name);
    const code = this.value('room-code');
    const difficulty = (this.value('difficulty') || 'normal') as DifficultyId;
    const mode = (this.value('mode') || 'vs') as ModeId;
    const startLevel = Math.max(1, Math.min(30, Number(this.value('start-level') || '1') || 1));
    switch (action) {
      case 'online': this.handlers.onPlayOnline(); return;
      case 'create': this.handlers.onCreateRoom(mode, difficulty, name); return;
      case 'join': this.handlers.onJoinRoom(code, name); return;
      case 'ready': this.handlers.onReady(true); return;
      case 'unready': this.handlers.onReady(false); return;
      case 'rematch': this.handlers.onRematch(); return;
      case 'leave': this.handlers.onLeave(); return;
      case 'cpu': this.handlers.onSolo('vs', difficulty, true, startLevel); return;
      case 'endless': this.handlers.onSolo('endless', difficulty, false, startLevel); return;
      case 'timeattack': this.handlers.onSolo('timeattack', difficulty, false, startLevel); return;
      case 'again': this.handlers.onAgain(); return;
      case 'sound': this.handlers.onToggleSound(true); return;
      case 'mute': this.handlers.onToggleSound(false); return;
      case 'menu': this.showMenu(); return;
    }
  }

  showMenu(error?: string): void {
    this.bind();
    this.lobby = null;
    const stored = sessionStorage.getItem('pdp.name') ?? '';
    const rows = [
      '<h1>Panel de Pon</h1>',
      '<p class="tagline">Match three, chain them together and bury your opponent.</p>',
      error ? '<p class="error">' + escapeHtml(error) + '</p>' : '',
      '<label class="field">Name<input id="player-name" maxlength="16" value="' + escapeHtml(stored) + '" placeholder="Player"></label>',
      '<label class="field">Difficulty<select id="difficulty">' + difficultyOptions('normal') + '</select></label>',
      '<label class="field">Start level<select id="start-level">' + levelOptions() + '</select></label>',
      '<div class="buttons">',
      '  <button data-action="online" class="primary">Play online</button>',
      '  <button data-action="cpu">Vs. CPU</button>',
      '  <button data-action="endless">Endless</button>',
      '  <button data-action="timeattack">Time attack</button>',
      '</div>',
      '<details class="help"><summary>How to play</summary><ul>',
      '  <li>Arrow keys or WASD move the cursor. Z, X or Space swaps the two panels under it.</li>',
      '  <li>Q and E raise your stack by hand. That cancels your stop time, so use it wisely.</li>',
      '  <li>Match three or more panels in a row or a column. Four or more at once is a combo.</li>',
      '  <li>Panels that fall into another match make a chain, and chains send the big garbage.</li>',
      '  <li>Garbage falls onto the top of your stack. Clear panels next to it to break it up.</li>',
      '  <li>Never let the stack touch the ceiling.</li>',
      '</ul>',
      '<p class="small">A fan re-implementation of the 1995 SNES game logic. Every panel and every sound is generated at runtime.</p>',
      '</details>',
    ];
    this.root.innerHTML = '<div class="panel menu">' + rows.join('') + '</div>';
  }

  showOnline(): void {
    this.bind();
    const stored = sessionStorage.getItem('pdp.name') ?? '';
    const rows = [
      '<h2>Play online</h2>',
      '<label class="field">Name<input id="player-name" maxlength="16" value="' + escapeHtml(stored) + '" placeholder="Player"></label>',
      '<label class="field">Difficulty<select id="difficulty">' + difficultyOptions('normal') + '</select></label>',
      '<div class="buttons">',
      '  <button data-action="create" class="primary">Create room</button>',
      '  <button data-action="menu">Back</button>',
      '</div>',
      '<hr>',
      '<label class="field">Room code<input id="room-code" maxlength="4" placeholder="ABCD" data-enter="join"></label>',
      '<div class="buttons"><button data-action="join">Join room</button></div>',
    ];
    this.root.innerHTML = '<div class="panel">' + rows.join('') + '</div>';
  }

  showLobby(state: LobbyState): void {
    this.bind();
    this.lobby = state;
    const self = state.players[state.selfIndex] ?? state.players[0];
    const opponent = state.players[1 - state.selfIndex] ?? state.players[1];
    const shareUrl = location.origin + location.pathname + '?room=' + state.code;
    const selfClass = self && self.ready ? 'slot ready' : 'slot';
    const opponentClass = opponent && opponent.connected ? 'slot ready' : 'slot';
    const selfText = (self && self.name ? self.name : 'You') + (self && self.ready ? ' - ready' : ' - waiting');
    const opponentText = opponent && opponent.connected ? opponent.name + (opponent.ready ? ' - ready' : ' - waiting') : 'waiting for an opponent...';
    const rows = [
      '<h2>Room <span class="code">' + escapeHtml(state.code) + '</span></h2>',
      '<p class="small">Send this link to your opponent: <code>' + escapeHtml(shareUrl) + '</code></p>',
      '<p class="small">Difficulty: ' + DIFFICULTY_LABELS[state.difficulty] + '</p>',
      '<div class="slots">',
      '  <div class="' + selfClass + '">' + escapeHtml(selfText) + '</div>',
      '  <div class="' + opponentClass + '">' + escapeHtml(opponentText) + '</div>',
      '</div>',
      '<div class="buttons">',
      self && self.ready
        ? '  <button data-action="unready">Not ready</button>'
        : '  <button data-action="ready" class="primary">Ready</button>',
      '  <button data-action="leave">Leave</button>',
      '</div>',
    ];
    this.root.innerHTML = '<div class="panel">' + rows.join('') + '</div>';
  }

  /** `solo` swaps the online handshake for an immediate local replay. */
  showResult(winner: number, selfIndex: number, reason: string, stats: string, solo = false): void {
    this.bind();
    const title = winner === -1 ? 'Draw' : winner === selfIndex ? 'You win' : 'You lose';
    const replayButton = solo
      ? '  <button data-action="again" class="primary">Play again</button>'
      : '  <button data-action="rematch" class="primary">Rematch</button>';
    const rows = [
      '<h2>' + title + '</h2>',
      '<p class="small">' + escapeHtml(reason) + '</p>',
      '<p class="small note" id="rematch-note">Press rematch when you want another round.</p>',
      '<pre class="stats">' + escapeHtml(stats) + '</pre>',
      '<div class="buttons">',
      replayButton,
      '  <button data-action="leave">Back to menu</button>',
      '</div>',
    ];
    this.root.innerHTML = '<div class="panel">' + rows.join('') + '</div>';
  }

  /** Live feedback for the rematch handshake, so a single vote is never a silent no-op. */
  setRematchNote(text: string): void {
    const note = document.getElementById('rematch-note');
    if (note) note.textContent = text;
  }

  clear(): void {
    this.bind();
    this.root.innerHTML = '';
  }

  currentLobby(): LobbyState | null {
    return this.lobby;
  }
}

function levelOptions(): string {
  return [1, 3, 5, 9, 13, 20]
    .map((level) => '<option value="' + level + '"' + (level === 1 ? ' selected' : '') + '>Level ' + level + '</option>')
    .join('');
}

function difficultyOptions(selected: DifficultyId): string {
  return (Object.keys(DIFFICULTY_LABELS) as DifficultyId[])
    .map((key) => '<option value="' + key + '"' + (key === selected ? ' selected' : '') + '>' + DIFFICULTY_LABELS[key] + '</option>')
    .join('');
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

