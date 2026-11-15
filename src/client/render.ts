// Everything you see. The renderer only ever reads the simulation state; it never writes
// to it, which is why a replay renders exactly like the live match did.

import type { GarbageBlock, MatchState, Panel, PlayerState } from '../core/types.ts';
import { BOARD_COLS, BOARD_ROWS, CALLOUT_FRAMES, RISE_STEPS, SWAP_FRAMES } from '../core/tuning.ts';

export const CELL = 16;
const BOARD_W = BOARD_COLS * CELL;
const BOARD_H = BOARD_ROWS * CELL;
const MARGIN = 14;
export const LOGICAL_H = BOARD_H + 76;

/** Colours of the six panel types, in the spirit of the original but drawn from scratch. */
const PALETTE: { base: string; light: string; dark: string }[] = [
  { base: '#e8455f', light: '#ff8a9c', dark: '#8e1f31' },
  { base: '#3fc7e8', light: '#9ce9f7', dark: '#1c6f88' },
  { base: '#5ec85a', light: '#a9ee9a', dark: '#2b6f2c' },
  { base: '#f2c53d', light: '#ffe999', dark: '#8f6c12' },
  { base: '#a86ce0', light: '#d7b0f5', dark: '#5b3282' },
  { base: '#4a6ee0', light: '#9fb4f7', dark: '#22336f' },
];
const SHOCK_COLORS = { base: '#b9c0c8', light: '#eef1f4', dark: '#5c636b' };

export interface PanelView {
  state: MatchState;
  /** Player indices to draw, in screen order. */
  boards: number[];
  selfIndex: number;
  names: [string, string];
  status: string;
  banner: string | null;
  countdown: number;
  solo: boolean;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprites = new Map<string, HTMLCanvasElement>();
  private logicalW = 300;
  private scale = 1;
  private time = 0;
  /** Last seen counters, used to fire sound effects and effects exactly once. */
  private seen = new WeakMap<PlayerState, { cleared: number; chain: number; garbage: number }>();
  onSound: (name: string, variation: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
  }

  draw(view: PanelView, delta: number): void {
    this.time += delta;
    const cols = view.boards.length;
    this.logicalW = cols * BOARD_W + MARGIN * (cols + 1) + (cols === 2 ? 46 : 0);
    this.resize();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.logicalW, LOGICAL_H);
    const gradient = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    gradient.addColorStop(0, '#141026');
    gradient.addColorStop(1, '#080614');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.logicalW, LOGICAL_H);

    let x = MARGIN;
    for (let i = 0; i < view.boards.length; i++) {
      const index = view.boards[i];
      const player = view.state.players[index];
      this.drawPlayer(player, x, 44, view, index === view.selfIndex);
      x += BOARD_W + MARGIN + (view.boards.length === 2 && i === 0 ? 46 : 0);
    }
    this.drawCenter(view);
    this.drawFooter(view);
    if (view.countdown > 0) this.drawCountdown(Math.ceil(view.countdown / 60));
    if (view.banner) this.drawBanner(view.banner);
  }

  private resize(): void {
    const availW = Math.max(320, window.innerWidth - 16);
    const availH = Math.max(320, window.innerHeight - 16);
    const scale = Math.max(1, Math.min(availW / this.logicalW, availH / LOGICAL_H));
    const rounded = Math.max(1, Math.floor(scale * 2) / 2);
    if (rounded === this.scale && this.canvas.width === Math.floor(this.logicalW * rounded)) return;
    this.scale = rounded;
    this.canvas.width = Math.floor(this.logicalW * rounded);
    this.canvas.height = Math.floor(LOGICAL_H * rounded);
    this.canvas.style.width = this.canvas.width + 'px';
    this.canvas.style.height = this.canvas.height + 'px';
  }

  private drawPlayer(player: PlayerState, x: number, y: number, view: PanelView, isSelf: boolean): void {
    const ctx = this.ctx;
    const playerIndex = view.state.players[0] === player ? 0 : 1;

    // frame
    ctx.fillStyle = '#05040d';
    ctx.fillRect(x - 2, y - 2, BOARD_W + 4, BOARD_H + 4);
    ctx.strokeStyle = player.toppedOut ? '#ff5566' : isSelf ? '#7de0ff' : '#5a5f8a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, BOARD_W + 4, BOARD_H + 4);

    // subtle column shading
    for (let c = 0; c < BOARD_COLS; c++) {
      ctx.fillStyle = c % 2 === 0 ? '#0d0a1c' : '#100c22';
      ctx.fillRect(x + c * CELL, y, CELL, BOARD_H);
    }

    const shakeX = player.shake > 0 ? Math.round(Math.sin(this.time * 0.9) * Math.min(3, player.shake / 4)) : 0;
    const shakeY = player.shake > 0 ? Math.round(Math.cos(this.time * 1.3) * Math.min(3, player.shake / 5)) : 0;
    const rise = RISE_STEPS - player.displacement;
    const originX = x + shakeX;
    const originY = y + shakeY - rise;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, BOARD_W, BOARD_H);
    ctx.clip();
    this.drawGarbage(player, originX, originY);
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const panel = player.grid[r][c];
        if (!panel) continue;
        this.drawPanel(panel, originX + c * CELL, originY + r * CELL, player);
      }
    }
    this.drawCursor(player, originX, originY);
    ctx.restore();

    this.drawTelegraph(player, x, y - 34, playerIndex, view.state);
    this.drawCallouts(player, x, y);
    if (player.toppedOut) this.drawDanger(x, y);
  }

  private drawPanel(panel: Panel, x: number, y: number, player: PlayerState): void {
    const ctx = this.ctx;
    let dx = x;
    let dy = y;
    let alpha = 1;
    let scale = 1;
    if (panel.phase === 'swapping') {
      const t = panel.timer / SWAP_FRAMES;
      dx += panel.order * t * CELL;
    } else if (panel.phase === 'hover') {
      dy += Math.round(Math.sin(this.time * 0.35) * 1.5);
    } else if (panel.phase === 'landing') {
      scale = 1 + panel.timer / 40;
    } else if (panel.phase === 'popping') {
      const k = Math.max(0, panel.timer / 8);
      scale = k;
      alpha = k;
    } else if (panel.phase === 'flash') {
      if (Math.floor(panel.timer / 3) % 2 === 0) alpha = 0.55;
    } else if (panel.phase === 'dead') {
      alpha = 0.45;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    if (scale !== 1) {
      const cxc = dx + CELL / 2;
      const cyc = dy + CELL / 2;
      ctx.translate(cxc, cyc);
      ctx.scale(scale, scale);
      ctx.translate(-cxc, -cyc);
    }
    ctx.drawImage(this.panelSprite(panel), Math.round(dx), Math.round(dy));
    if (panel.phase === 'face' || panel.phase === 'flash') this.drawFace(dx, dy, panel);
    ctx.restore();
    void player;
  }

  private drawFace(x: number, y: number, panel: Panel): void {
    const ctx = this.ctx;
    ctx.fillStyle = panel.phase === 'flash' ? '#ffffff' : '#1a1026';
    ctx.fillRect(x + 4, y + 6, 2, 2);
    ctx.fillRect(x + 10, y + 6, 2, 2);
    if (panel.phase === 'face') {
      ctx.fillRect(x + 5, y + 11, 6, 1);
      ctx.fillRect(x + 4, y + 10, 1, 1);
      ctx.fillRect(x + 11, y + 10, 1, 1);
    }
  }

  private panelSprite(panel: Panel): HTMLCanvasElement {
    const key = panel.shock ? 'shock' : 'c' + panel.color;
    const cached = this.sprites.get(key);
    if (cached) return cached;
    const sprite = document.createElement('canvas');
    sprite.width = CELL;
    sprite.height = CELL;
    const ctx = sprite.getContext('2d');
    if (ctx) {
      const colors = panel.shock ? SHOCK_COLORS : PALETTE[panel.color] ?? PALETTE[0];
      drawShape(ctx, panel.shock ? -1 : panel.color, colors);
    }
    this.sprites.set(key, sprite);
    return sprite;
  }

  private drawGarbage(player: PlayerState, originX: number, originY: number): void {
    const ctx = this.ctx;
    for (const block of player.garbage) {
      const x = originX + block.x * CELL;
      const y = originY + block.y * CELL;
      const w = block.w * CELL;
      const h = block.h * CELL;
      const colors = block.metal ? SHOCK_COLORS : PALETTE[block.color] ?? PALETTE[0];
      ctx.fillStyle = colors.dark;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = block.metal ? '#8d949c' : colors.base;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = colors.dark;
      for (let row = 0; row < block.h; row++) {
        for (let col = 0; col < block.w; col++) {
          const bx = x + col * CELL + (row % 2 === 0 ? 0 : 8);
          const by = y + row * CELL + 8;
          ctx.fillRect(bx, by, 8, 1);
          ctx.fillRect(bx + 4, by - 8, 1, 8);
        }
      }
      ctx.strokeStyle = '#05040d';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  private drawCursor(player: PlayerState, originX: number, originY: number): void {
    const ctx = this.ctx;
    const x = originX + player.cursor.x * CELL;
    const y = originY + player.cursor.y * CELL;
    const w = CELL * 2;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 0.25);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = player.cursor.swapCooldown > 0 ? '#ffffff' : '#ffe66d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, CELL - 2);
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillRect(x + w - 2, y - 1, 3, 3);
    ctx.fillRect(x - 1, y + CELL - 2, 3, 3);
    ctx.fillRect(x + w - 2, y + CELL - 2, 3, 3);
    ctx.globalAlpha = 1;
  }


  /** The queue of attacks that are on their way, drawn above the board. */
  private drawTelegraph(player: PlayerState, x: number, y: number, playerIndex: number, state: MatchState): void {
    const ctx = this.ctx;
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    let cursorX = x;
    let chainRows = 0;
    for (let i = 0; i < player.incoming.length && i < 24; i++) {
      const piece = player.incoming[i];
      if (piece.isChain) {
        chainRows += piece.h;
        continue;
      }
      const colors = piece.metal ? SHOCK_COLORS : PALETTE[piece.color] ?? PALETTE[0];
      ctx.fillStyle = piece.metal ? '#8d949c' : colors.base;
      const width = Math.max(3, piece.w * 4);
      ctx.fillRect(cursorX, y + 12, width, 4);
      ctx.strokeStyle = '#05040d';
      ctx.strokeRect(cursorX + 0.5, y + 12.5, width - 1, 3);
      cursorX += width + 2;
      if (cursorX > x + BOARD_W) break;
    }
    if (chainRows > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.fillText('x' + chainRows, x, y - 2);
    } else if (player.incoming.length > 0) {
      ctx.fillStyle = '#9fb4f7';
      ctx.fillText('INCOMING', x, y - 2);
    }
    void playerIndex;
    void state;
  }

  private drawCallouts(player: PlayerState, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (player.comboDisplayTimer > 0 && player.comboDisplay >= 4) {
      const fade = Math.min(1, player.comboDisplayTimer / 12);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#e8455f';
      roundRect(ctx, x + BOARD_W / 2 - 22, y + 28, 44, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillText(player.comboDisplay + ' COMBO', x + BOARD_W / 2, y + 38);
      ctx.globalAlpha = 1;
    }
    if (player.chainDisplayTimer > 0 && player.chainDisplay >= 2) {
      const fade = Math.min(1, player.chainDisplayTimer / 20);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#2fbf71';
      roundRect(ctx, x + BOARD_W / 2 - 22, y + 54, 44, 22, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.fillText('x' + player.chainDisplay, x + BOARD_W / 2, y + 65);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  private drawDanger(x: number, y: number): void {
    const ctx = this.ctx;
    const alpha = 0.25 + 0.25 * Math.sin(this.time * 0.4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff2d55';
    ctx.fillRect(x, y, BOARD_W, 10);
    ctx.globalAlpha = 1;
  }

  private drawCenter(view: PanelView): void {
    if (view.boards.length !== 2) return;
    const ctx = this.ctx;
    const x = MARGIN + BOARD_W + MARGIN / 2 + 23;
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px ui-monospace, monospace';
    const winner = view.state.finished ? view.state.winner : null;
    for (let i = 0; i < 2; i++) {
      const y = 60 + i * 92;
      const isSelf = i === view.selfIndex;
      ctx.fillStyle = winner === i ? '#ffd166' : isSelf ? '#7de0ff' : '#c8cbe6';
      ctx.fillText(shortName(view.names[i]), x, y);
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillStyle = '#7a80a8';
      ctx.fillText('LV ' + view.state.players[i].speed, x, y + 12);
      if (view.solo) {
        ctx.fillStyle = '#ffd166';
        ctx.fillText(String(view.state.players[i].score), x, y + 24);
      }
      ctx.font = 'bold 10px ui-monospace, monospace';
    }
    ctx.textAlign = 'left';
  }

  private drawFooter(view: PanelView): void {
    const ctx = this.ctx;
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = '#7a80a8';
    ctx.textBaseline = 'bottom';
    ctx.fillText(view.status, MARGIN, LOGICAL_H - 4);
    if (view.solo) {
      const player = view.state.players[0];
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText('SCORE ' + player.score, this.logicalW - MARGIN, LOGICAL_H - 4);
      if (view.state.clock > 0) {
        ctx.fillStyle = view.state.clock < 600 ? '#ff5566' : '#9ce9f7';
        ctx.fillText(formatClock(view.state.clock), this.logicalW - MARGIN, LOGICAL_H - 18);
      }
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'top';
  }

  private drawCountdown(seconds: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5, 4, 13, 0.65)';
    ctx.fillRect(0, 0, this.logicalW, LOGICAL_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.fillText(String(seconds), this.logicalW / 2, LOGICAL_H / 2);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#c8cbe6';
    ctx.fillText('READY', this.logicalW / 2, LOGICAL_H / 2 - 34);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  private drawBanner(text: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5, 4, 13, 0.8)';
    ctx.fillRect(0, LOGICAL_H / 2 - 26, this.logicalW, 52);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillText(text, this.logicalW / 2, LOGICAL_H / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

function shortName(name: string): string {
  return name.length > 9 ? name.slice(0, 9) : name;
}

function formatClock(frames: number): string {
  const total = Math.ceil(frames / 60);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draws one of the six classic panel shapes, plus the shock panel. */
function drawShape(ctx: CanvasRenderingContext2D, shape: number, colors: { base: string; light: string; dark: string }): void {
  ctx.fillStyle = colors.base;
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (shape === 0) {
    ctx.moveTo(8, 13);
    ctx.lineTo(2, 7);
    ctx.lineTo(2, 4);
    ctx.lineTo(5, 2);
    ctx.lineTo(8, 5);
    ctx.lineTo(11, 2);
    ctx.lineTo(14, 4);
    ctx.lineTo(14, 7);
    ctx.closePath();
  } else if (shape === 1) {
    ctx.moveTo(8, 2);
    ctx.lineTo(14, 13);
    ctx.lineTo(2, 13);
    ctx.closePath();
  } else if (shape === 2) {
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
  } else if (shape === 3) {
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? 6.4 : 2.8;
      const px = 8 + Math.cos(angle) * radius;
      const py = 8 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 4) {
    ctx.moveTo(8, 2);
    ctx.lineTo(14, 8);
    ctx.lineTo(8, 14);
    ctx.lineTo(2, 8);
    ctx.closePath();
  } else if (shape === 5) {
    ctx.moveTo(2, 3);
    ctx.lineTo(14, 3);
    ctx.lineTo(8, 13);
    ctx.closePath();
  } else {
    ctx.moveTo(8, 1);
    ctx.lineTo(14, 5);
    ctx.lineTo(14, 11);
    ctx.lineTo(8, 15);
    ctx.lineTo(2, 11);
    ctx.lineTo(2, 5);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.light;
  if (shape === -1) {
    ctx.fillRect(7, 4, 2, 5);
    ctx.fillRect(7, 11, 2, 2);
    ctx.fillStyle = colors.dark;
    ctx.fillRect(4, 6, 1, 1);
    ctx.fillRect(11, 6, 1, 1);
  } else {
    ctx.fillRect(5, 4, 2, 2);
    ctx.fillRect(4, 6, 1, 1);
  }
}

