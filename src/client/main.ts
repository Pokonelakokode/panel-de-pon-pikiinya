// Application bootstrap: wire the socket, the menus, the renderer and the game loop.

import { createMatch } from '../core/simulate.ts';
import type { DifficultyId, MatchState, ModeId } from '../core/types.ts';
import type { InputFrame, ServerMessage } from '../protocol.ts';
import { PROTOCOL_VERSION } from '../protocol.ts';
import { Net, defaultSocketUrl } from './net.ts';
import { Game } from './game.ts';
import { InputSampler } from './input.ts';
import { Audio } from './audio.ts';
import { Renderer } from './render.ts';
import { Ui } from './ui.ts';
import type { LobbyState } from './ui.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// Any uncaught error becomes visible on screen, which makes a screenshot self-diagnosing.
const errorBox = document.createElement('pre');
errorBox.className = 'crash';
errorBox.style.display = 'none';
document.body.appendChild(errorBox);
function reportCrash(text: string): void {
  errorBox.style.display = 'block';
  errorBox.textContent = (errorBox.textContent ? errorBox.textContent + String.fromCharCode(10) : '') + text;
}
window.addEventListener('error', (event) => reportCrash('error: ' + event.message));
window.addEventListener('unhandledrejection', (event) => reportCrash('rejection: ' + String(event.reason)));

const input = new InputSampler();
const audio = new Audio();
const renderer = new Renderer(canvas);
const net = new Net(defaultSocketUrl());

let screen: 'menu' | 'lobby' | 'game' = 'menu';
let lobby: LobbyState | null = null;
let countdown = 0;
let banner: string | null = null;
let status = 'offline';

document.addEventListener('pointerdown', () => audio.resume(), { once: true });
document.addEventListener('keydown', () => audio.resume(), { once: true });

const game = new Game({ mode: 'vs', difficulty: 'normal', solo: false, useCpu: false }, {
  onStatus: (text) => { status = text; },
  onSound: (name, variation) => audio.play(name as never, variation),
});

const ui = new Ui(uiRoot, {
  onPlayOnline: () => {
    screen = 'menu';
    ui.showOnline();
  },
  onCreateRoom: (mode, difficulty, name) => {
    net.name = name;
    net.send({ t: 'create', mode, difficulty, name });
  },
  onJoinRoom: (code, name) => {
    if (code.trim().length < 4) return;
    net.name = name;
    net.send({ t: 'join', code: code.trim().toUpperCase(), name });
  },
  onReady: (ready) => net.send({ t: 'ready', ready }),
  onRematch: () => {
    ui.setRematchNote('waiting for your opponent to accept...');
    net.send({ t: 'rematch' });
  },
  onLeave: () => {
    net.send({ t: 'leave' });
    game.stop();
    screen = 'menu';
    lobby = null;
    ui.showMenu();
  },
  onSolo: (mode, difficulty, useCpu, startLevel) => {
    startSolo(mode, difficulty, useCpu, startLevel);
  },
  onAgain: () => {
    const options = game.options;
    startSolo(options.mode, options.difficulty, options.useCpu, options.startLevel ?? 1);
  },
  onToggleSound: (enabled) => { audio.enabled = enabled; },
});

function startSolo(mode: ModeId, difficulty: DifficultyId, useCpu: boolean, startLevel = 1): void {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  game.options = { mode, difficulty, solo: true, useCpu, startLevel };
  game.startLocal(seed);
  screen = 'game';
  banner = null;
  countdown = 0;
  ui.clear();
  audio.play('start', 0);
}

game.onInput = (tick, buttons) => net.send({ t: 'input', tick, buttons });
game.onFinish = (winner) => {
  if (game.options.solo) {
    const state = game.state;
    const stats = state ? summary(state, winner, 0) : '';
    ui.showResult(
      winner === -1 ? -1 : winner,
      0,
      winner === 0 ? 'your stack topped out' : 'game over',
      stats,
      true,
    );
  }
};

net.onStatus = (value) => {
  status = value === 'open' ? 'online' : value === 'connecting' ? 'connecting...' : 'reconnecting...';
};

net.onMessage = (message: ServerMessage) => {
  switch (message.t) {
    case 'room': {
      lobby = {
        code: message.code,
        phase: message.phase,
        mode: message.mode,
        difficulty: message.difficulty,
        players: message.players,
        selfIndex: message.selfIndex,
        isHost: message.isHost,
      };
      screen = 'lobby';
      ui.showLobby(lobby);
      return;
    }
    case 'countdown': {
      countdown = message.ticks;
      ui.clear();
      screen = 'game';
      return;
    }
    case 'start': {
      const state = createMatch(message.seed, message.mode, message.difficulty);
      game.options = { mode: message.mode, difficulty: message.difficulty, solo: false, useCpu: false };
      game.startOnline(state, message.selfIndex, message.inputDelay);
      screen = 'game';
      countdown = 0;
      banner = null;
      ui.clear();
      return;
    }
    case 'inputs': {
      game.receiveInputs(message.frames as InputFrame[]);
      return;
    }
    case 'snapshot': {
      game.applySnapshot(message.state as MatchState, message.tick);
      return;
    }
    case 'end': {
      const selfIndex = lobby ? lobby.selfIndex : 0;
      const stats = [
        'panels cleared  ' + message.stats.panelsCleared.join(' / '),
        'best chain      ' + message.stats.maxChain.join(' / '),
        'score           ' + message.stats.score.join(' / '),
        'length          ' + (message.stats.ticks / 60).toFixed(1) + ' s',
      ].join(String.fromCharCode(10));
      game.stop();
      ui.showResult(message.winner, selfIndex, message.reason, stats);
      screen = 'menu';
      audio.play(message.winner === selfIndex ? 'win' : 'lose', 0);
      return;
    }
    case 'rematchVote': {
      const selfIndex = lobby ? lobby.selfIndex : 0;
      const mine = message.votes[selfIndex];
      const theirs = message.votes[1 - selfIndex];
      if (mine) ui.setRematchNote('waiting for your opponent to accept...');
      else if (theirs) ui.setRematchNote('your opponent wants a rematch');
      return;
    }
    case 'error': {
      if (message.code === 'desync') {
        status = message.message;
        return;
      }
      screen = 'menu';
      game.stop();
      ui.showMenu(message.message);
      return;
    }
    default:
      return;
  }
};

function summary(state: MatchState, winner: number, selfIndex: number): string {
  void winner;
  void selfIndex;
  return [
    'panels cleared  ' + state.players[0].panelsCleared,
    'score           ' + state.players[0].score,
    'time            ' + (state.tick / 60).toFixed(1) + ' s',
  ].join(String.fromCharCode(10));
}

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get('room');
if (roomFromUrl) {
  ui.showOnline();
  const field = document.getElementById('room-code') as HTMLInputElement | null;
  if (field) field.value = roomFromUrl.toUpperCase();
} else {
  ui.showMenu();
}

// A demo query starts a match straight away, which is what the screenshot checks use.
const demo = params.get('demo');
if (demo === 'endless') startSolo('endless', 'normal', false);
if (demo === 'timeattack') startSolo('timeattack', 'normal', false);
if (demo === 'cpu') startSolo('vs', 'normal', true);

net.connect();

const FRAME_MS = 1000 / 60;
let previous = performance.now();

function loop(now: number): void {
  const delta = now - previous;
  previous = now;
  game.frame(now, () => input.sample());
  if (countdown > 0) countdown = Math.max(0, countdown - delta / FRAME_MS);
  canvas.style.display = screen === 'game' && game.state ? 'block' : 'none';
  if (screen === 'game' && game.state) {
    const versus = game.state.mode === 'vs';
    renderer.draw({
      state: game.state,
      boards: versus ? [0, 1] : [0],
      selfIndex: game.selfIndex,
      names: [
        lobby?.players[0]?.name ?? 'You',
        lobby?.players[1]?.name ?? (game.options.useCpu ? 'CPU' : 'Opponent'),
      ],
      status: game.options.solo
        ? (game.options.useCpu ? 'practice vs CPU' : game.state.mode === 'endless' ? 'endless' : 'time attack')
        : status + '   ' + Math.round(net.rtt) + ' ms',
      banner,
      countdown,
      solo: !versus,
    }, delta);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

void PROTOCOL_VERSION;
window.addEventListener('resize', () => {
  previous = performance.now();
});

