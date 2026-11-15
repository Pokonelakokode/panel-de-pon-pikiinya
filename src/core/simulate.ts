// The whole game rule set, in one deterministic function. `step` is the only place that
// mutates state, and it never touches the clock, the DOM or Math.random.

import type {
  GarbageBlock,
  GarbagePiece,
  MatchState,
  ModeId,
  DifficultyId,
  Panel,
  PlayerInput,
  PlayerState,
} from './types.ts';
import { BTN, emptyGrid, NO_INPUT } from './types.ts';
import {
  BOARD_COLS,
  BOARD_ROWS,
  CHAIN_GARBAGE_MAX_HEIGHT,
  CHAIN_GRACE_FRAMES,
  CALLOUT_FRAMES,
  CALLOUT_LONG_FRAMES,
  COMBO_GARBAGE,
  CURSOR_REPEAT_DELAY,
  CURSOR_REPEAT_PERIOD,
  GARBAGE_STAGING_FRAMES,
  GARBAGE_TELEGRAPH_FRAMES,
  GARBAGE_TRANSIT_FRAMES,
  PANELS_TO_NEXT_SPEED,
  RISE_STEPS,
  SCORE_CHAIN,
  SCORE_COMBO,
  SHAKE_FRAMES_MAX,
  SHAKE_FRAMES_PER_ROW,
  SHOCK_GARBAGE_OFFSET,
  SWAP_FRAMES,
  riseStepFrames,
} from './tuning.ts';
import type { DifficultyPreset, ModePreset } from './tuning.ts';
import { DIFFICULTIES, MODES } from './tuning.ts';
import { roll, seedState } from './rng.ts';
import {
  generateRow,
  garbageAt,
  hasActivePanels,
  isBlocked,
  isToppedOut,
  makePanel,
  shiftRowsUp,
} from './board.ts';
import { findMatches } from './match.ts';

export interface Rules { difficulty: DifficultyPreset; mode: ModePreset }

export function createRules(mode: ModeId, difficulty: DifficultyId): Rules {
  return { difficulty: DIFFICULTIES[difficulty], mode: MODES[mode] };
}

/** Frames between two swaps being accepted. [?] */
export const SWAP_COOLDOWN = 2;
/** Frames the landing bounce lasts; a landed panel is already playable. */
export const LANDING_FRAMES = 8;

// Directions used internally for cursor movement.
const DIR_NONE = 0;
const DIR_UP = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;
const DIR_RIGHT = 4;

/** Starting column for each garbage width, cycled through so pieces spread out. [C] */
const DROP_COLUMNS: number[][] = [
  [0, 1, 2, 3, 4, 5],
  [0, 2, 4],
  [0, 3],
  [0, 1, 2],
  [0, 1],
  [0],
];

export function createPlayer(seed: number, index: number, rules: Rules, startLevel = 1): PlayerState {
  const level = Math.max(1, Math.min(99, Math.floor(startLevel)));
  const player: PlayerState = {
    grid: emptyGrid(BOARD_ROWS, BOARD_COLS),
    garbage: [],
    cursor: { x: 2, y: 6, swapTimer: 0, swapX: -1, swapY: -1, swapDir: 0, heldDir: DIR_NONE, holdTimer: 0, swapCooldown: 0, swapHeld: false },
    riseTimer: 0,
    displacement: RISE_STEPS,
    speed: level,
    panelsToSpeedup: panelsToNextLevel(level, rules),
    health: rules.mode.maxHealth,
    maxHealth: rules.mode.maxHealth,
    shake: 0,
    stopTime: 0,
    preStop: 0,
    incoming: [],
    incomingDelay: [],
    comboSize: 0,
    comboDisplay: 0,
    comboDisplayTimer: 0,
    chainCount: 0,
    chainDisplay: 0,
    chainDisplayTimer: 0,
    chainActive: false,
    chainGrace: 0,
    clearsThisChain: 0,
    score: 0,
    panelsCleared: 0,
    toppedOut: false,
    gameOver: false,
    nextGarbageId: 1,
    stall: 0,
    rng: seedState(seed, index),
  };
  player.grid = buildStartingBoard(player, rules, index);
  return player;
}

/**
 * The opening stack of the original is five full rows with no ready-made matches.
 * Cells are filled bottom-up, left-to-right, and a colour is rejected while it would
 * complete a run of three.
 */
function buildStartingBoard(player: PlayerState, rules: Rules, index: number): (Panel | null)[][] {
  const grid = emptyGrid(BOARD_ROWS, BOARD_COLS);
  const rows = rules.mode.startingRows;
  const colors = colorCountAt(player.speed, rules);
  for (let r = BOARD_ROWS - rows; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const picked = pickSafeColor(player, grid, r, c, colors, rules);
      grid[r][c] = makePanel(picked as Panel['color'], false);
    }
  }
  void index;
  return grid;
}

function pickSafeColor(player: PlayerState, grid: (Panel | null)[][], r: number, c: number, colors: number, rules: Rules): number {
  const banned = new Set<number>();
  const left1 = c >= 1 ? grid[r][c - 1] : null;
  const left2 = c >= 2 ? grid[r][c - 2] : null;
  const up1 = r >= 1 ? grid[r - 1][c] : null;
  const up2 = r >= 2 ? grid[r - 2][c] : null;
  if (left1) banned.add(left1.color);
  if (left1 && left2 && left1.color === left2.color) banned.add(left1.color);
  if (up1 && up2 && up1.color === up2.color) banned.add(up1.color);
  if (rules.mode.adjacentDenial && left1) banned.add(left1.color);
  const options: number[] = [];
  for (let i = 0; i < colors; i++) if (!banned.has(i)) options.push(i);
  if (options.length === 0) return 0;
  const draw = roll(player.rng, options.length);
  player.rng = draw.state;
  return options[draw.value];
}

/** Number of distinct panel colours available at the given speed (level). */
function colorCountAt(speed: number, rules: Rules): number {
  return speed >= rules.mode.sixthColorLevel ? rules.mode.baseColors + 1 : rules.mode.baseColors;
}

export function createMatch(seed: number, mode: ModeId, difficulty: DifficultyId, startLevel = 1): MatchState {
  const rules = createRules(mode, difficulty);
  // The stricter of the two graces wins, so a hard difficulty is actually harder.
  rules.mode = { ...rules.mode, maxHealth: Math.min(rules.mode.maxHealth, rules.difficulty.maxHealth) };
  const state: MatchState = {
    tick: 0,
    seed,
    mode,
    difficulty,
    players: [createPlayer(seed, 0, rules, startLevel), createPlayer(seed, 1, rules, startLevel)],
    winner: null,
    finished: false,
    clock: rules.mode.timeLimit,
  };
  return state;
}

/**
 * Advances the whole match by exactly one 60 Hz tick.
 * Both players are advanced through the same pipeline in the same order, so the result
 * only depends on the seed, the inputs and the tick number.
 */
export function step(state: MatchState, inputs: [PlayerInput, PlayerInput], rules: Rules): void {
  if (state.finished) return;
  const activePlayers = rules.mode.versus ? 2 : 1;
  for (let i = 0; i < activePlayers; i++) {
    tickPlayer(state, i, inputs[i] ?? NO_INPUT, rules);
  }
  if (rules.mode.timeLimit > 0) {
    state.clock -= 1;
    if (state.clock <= 0) {
      state.clock = 0;
      state.finished = true;
      state.winner = -1;
      return;
    }
  }
  const a = state.players[0].gameOver;
  const b = state.players[1].gameOver;
  if (!rules.mode.versus) {
    if (a) { state.finished = true; state.winner = -1; }
  } else if (a && b) {
    state.finished = true;
    state.winner = -1;
  } else if (a) {
    state.finished = true;
    state.winner = 1;
  } else if (b) {
    state.finished = true;
    state.winner = 0;
  }
  state.tick += 1;
}

function tickPlayer(state: MatchState, index: number, input: PlayerInput, rules: Rules): void {
  const p = state.players[index];
  if (p.gameOver) { markDead(p); return; }
  const colors = colorCountAt(p.speed, rules);

  const swapQueued = handleInput(p, input, rules);
  const cleared = updateClears(p, rules);
  updateSwaps(p);
  updateGravity(p, rules);
  const event = detectAndStartClear(p, rules, state, index);
  updateChainState(p);
  updateIncoming(p, rules);
  updateGarbageBlocks(p, rules);
  updateStopTimers(p);
  updateSpeed(p, cleared, rules);
  updateRise(p, rules, swapQueued, colors);
  updateCallouts(p);
  if (p.shake > 0) p.shake -= 1;
  updateGameOver(p);
  void event;
}

function markDead(p: PlayerState): void {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = p.grid[r][c];
      if (panel && panel.phase !== 'dead') panel.phase = 'dead';
    }
  }
}

// ---------------------------------------------------------------------------------
// Input, cursor and swapping
// ---------------------------------------------------------------------------------

function handleInput(p: PlayerState, input: PlayerInput, rules: Rules): boolean {
  const cursor = p.cursor;
  let swapQueued = false;
  const dir = directionOf(input.buttons);
  if (dir !== cursor.heldDir) {
    cursor.heldDir = dir;
    cursor.holdTimer = CURSOR_REPEAT_DELAY;
    if (dir !== DIR_NONE) moveCursor(p, dir);
  } else if (dir !== DIR_NONE) {
    cursor.holdTimer -= 1;
    if (cursor.holdTimer <= 0) {
      cursor.holdTimer = CURSOR_REPEAT_PERIOD;
      moveCursor(p, dir);
    }
  }

  if (cursor.swapCooldown > 0) cursor.swapCooldown -= 1;
  // One press, one swap: the button has to be released before it can fire again.
  const swapDown = (input.buttons & BTN.swap) !== 0;
  if (swapDown && !cursor.swapHeld && cursor.swapCooldown === 0) {
    if (startSwap(p)) {
      swapQueued = true;
      cursor.swapCooldown = SWAP_COOLDOWN;
    }
  }
  cursor.swapHeld = swapDown;

  const raising = (input.buttons & (BTN.raiseLeft | BTN.raiseRight)) !== 0;
  if (raising && p.shake === 0 && !hasActivePanels(p) && !isToppedOut(p)) {
    // Manual raise pushes the stack up on purpose: it cancels your remaining stop time.
    p.stopTime = 0;
    manualRaise(p, rules);
  }
  return swapQueued;
}

function directionOf(buttons: number): number {
  if ((buttons & BTN.up) !== 0) return DIR_UP;
  if ((buttons & BTN.down) !== 0) return DIR_DOWN;
  if ((buttons & BTN.left) !== 0) return DIR_LEFT;
  if ((buttons & BTN.right) !== 0) return DIR_RIGHT;
  return DIR_NONE;
}

function moveCursor(p: PlayerState, dir: number): void {
  const cursor = p.cursor;
  if (dir === DIR_LEFT) cursor.x = Math.max(0, cursor.x - 1);
  else if (dir === DIR_RIGHT) cursor.x = Math.min(BOARD_COLS - 2, cursor.x + 1);
  else if (dir === DIR_UP) cursor.y = Math.max(0, cursor.y - 1);
  else if (dir === DIR_DOWN) cursor.y = Math.min(BOARD_ROWS - 1, cursor.y + 1);
}

function swappable(panel: Panel | null): boolean {
  if (!panel) return true;
  return panel.phase === 'normal' || panel.phase === 'landing';
}

function startSwap(p: PlayerState): boolean {
  const { x, y } = p.cursor;
  if (garbageAt(p, y, x) || garbageAt(p, y, x + 1)) return false;
  const left = p.grid[y][x];
  const right = p.grid[y][x + 1];
  if (!left && !right) return false;
  if (!swappable(left) || !swappable(right)) return false;
  p.grid[y][x] = right;
  p.grid[y][x + 1] = left;
  // `order` doubles as the swap direction for the renderer while the animation runs.
  if (left) { left.phase = 'swapping'; left.timer = SWAP_FRAMES; left.order = -1; }
  if (right) { right.phase = 'swapping'; right.timer = SWAP_FRAMES; right.order = 1; }
  return true;
}

function updateSwaps(p: PlayerState): void {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = p.grid[r][c];
      if (!panel || panel.phase !== 'swapping') continue;
      panel.timer -= 1;
      if (panel.timer <= 0) panel.phase = 'normal';
    }
  }
}

// ---------------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------------

/**
 * Advances every clearing panel and removes the ones whose timer ran out.
 * Returns how many panels were removed this tick.
 */
function updateClears(p: PlayerState, rules: Rules): number {
  let removed = 0;
  let preStop = 0;
  const { flash, face, pop } = rules.difficulty;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = p.grid[r][c];
      if (!panel || !panel.matched) continue;
      if (panel.timer > 0) panel.timer -= 1;
      if (panel.timer <= 0) {
        p.grid[r][c] = null;
        removed += 1;
        p.panelsCleared += 1;
        continue;
      }
      preStop = Math.max(preStop, panel.timer);
      panel.phase = clearPhase(panel.timer, panel.order, flash, face, pop);
    }
  }
  p.preStop = preStop;
  return removed;
}

/**
 * The clear animation of the original: everything flashes, then shows a face, then pops
 * one panel at a time from the top left, so a bigger event takes longer to finish.
 */
function clearPhase(timer: number, order: number, flash: number, face: number, pop: number): Panel['phase'] {
  const popStart = order * pop;
  if (timer <= pop) return 'popping';
  if (timer <= face + popStart + pop) return 'face';
  return 'flash';
}

function detectAndStartClear(p: PlayerState, rules: Rules, state: MatchState, index: number): number {
  const result = findMatches(p);
  if (result.cells.length === 0) return 0;
  const { flash, face, pop } = rules.difficulty;
  const ordered = result.cells.slice().sort((a, b) => {
    const ra = Math.floor(a / BOARD_COLS);
    const rb = Math.floor(b / BOARD_COLS);
    if (ra !== rb) return ra - rb;
    return (a % BOARD_COLS) - (b % BOARD_COLS);
  });
  for (let i = 0; i < ordered.length; i++) {
    const cell = ordered[i];
    const r = Math.floor(cell / BOARD_COLS);
    const c = cell % BOARD_COLS;
    const panel = p.grid[r][c];
    if (!panel) continue;
    panel.matched = true;
    panel.order = i;
    panel.timer = flash + face + i * pop + pop;
    panel.phase = 'flash';
    p.preStop = Math.max(p.preStop, panel.timer);
  }

  const comboSize = ordered.length;

  destroyTouchingGarbage(p, result, rules);

  const isChainLink = p.chainActive;
  p.chainActive = true;
  p.chainCount = isChainLink ? p.chainCount + 1 : 1;
  p.clearsThisChain = p.chainCount;
  p.chainGrace = CHAIN_GRACE_FRAMES;
  p.comboSize = comboSize;
  if (comboSize >= 4) {
    p.comboDisplay = comboSize;
    p.comboDisplayTimer = CALLOUT_FRAMES;
  }
  if (p.chainCount >= 2) {
    p.chainDisplay = p.chainCount;
    p.chainDisplayTimer = CALLOUT_LONG_FRAMES;
  }

  p.score += scoreFor(comboSize, p.chainCount);
  awardStopTime(p, comboSize, rules);

  if (rules.mode.versus) {
    // The block colour is the sender, so each side can tell whose garbage is falling.
    emitAttack(state, index, p, comboSize, result.shockCount, index);
  } else if (rules.mode.timeLimit > 0) {
    state.clock = Math.min(state.clock + comboSize * rules.mode.timePerPanel, rules.mode.timeLimit);
  }
  p.panelsToSpeedup -= comboSize;
  return comboSize;
}

function scoreFor(comboSize: number, chainCount: number): number {
  let score = 0;
  if (comboSize >= 4) score += SCORE_COMBO[Math.min(comboSize, SCORE_COMBO.length - 1)];
  if (chainCount >= 2) score += SCORE_CHAIN[Math.min(chainCount, SCORE_CHAIN.length - 1)];
  return score;
}

function awardStopTime(p: PlayerState, comboSize: number, rules: Rules): void {
  const toppedOut = isToppedOut(p);
  let stop = 0;
  if (toppedOut) stop = rules.difficulty.stopDanger;
  else if (p.chainCount >= 2) stop = rules.difficulty.stopChain;
  else if (comboSize > 3) stop = rules.difficulty.stopCombo;
  p.stopTime = Math.max(p.stopTime, stop);
}

// ---------------------------------------------------------------------------------
// Garbage
// ---------------------------------------------------------------------------------

/** Every garbage block a match is standing next to turns into panels (or just breaks). */
function destroyTouchingGarbage(p: PlayerState, result: ReturnType<typeof findMatches>, rules: Rules): void {
  const hits: GarbageBlock[] = [];
  for (const block of p.garbage) {
    let touched = false;
    for (let c = block.x; c < block.x + block.w && !touched; c++) {
      for (let d = 0; d < 2; d++) {
        const r = d === 0 ? block.y - 1 : block.y + block.h;
        const group = groupAt(p, result, r, c);
        if (group) { touched = true; break; }
      }
    }
    for (let r = block.y; r < block.y + block.h && !touched; r++) {
      for (let d = 0; d < 2; d++) {
        const c = d === 0 ? block.x - 1 : block.x + block.w;
        const group = groupAt(p, result, r, c);
        if (group) { touched = true; break; }
      }
    }
    if (touched) hits.push(block);
  }
  for (const block of hits) breakGarbage(p, block, rules);
}

/**
 * True when the cell holds a panel that is part of the clear event. Any match breaks an
 * adjacent block; the block colour only records who sent it, it is not a match requirement.
 */
function groupAt(p: PlayerState, result: ReturnType<typeof findMatches>, r: number, c: number): boolean {
  void result;
  if (r < 0 || r >= BOARD_ROWS || c < 0 || c >= BOARD_COLS) return false;
  const panel = p.grid[r][c];
  if (!panel || !panel.matched) return false;
  return true;
}

/**
 * A one row thick block turns into panels all at once; a thick chain block loses only its
 * bottom row per match, and metal garbage is destroyed without ever becoming panels.
 */
function breakGarbage(p: PlayerState, block: GarbageBlock, rules: Rules): void {
  const index = p.garbage.indexOf(block);
  if (block.metal) {
    if (index >= 0) p.garbage.splice(index, 1);
    return;
  }
  if (block.h === 1) {
    convertRowToPanels(p, block, block.y, rules);
    if (index >= 0) p.garbage.splice(index, 1);
    return;
  }
  // A thick chain block only loses its bottom row; the rest stays as garbage.
  convertRowToPanels(p, block, block.y + block.h - 1, rules);
  block.h -= 1;
}

/**
 * A broken block turns into ordinary panels with their own colours. The original takes them
 * from a per-level pattern row; we draw them deterministically and never let the conversion
 * hand the player a free run, which is what the pattern row effectively achieves. [?]
 */
function convertRowToPanels(p: PlayerState, block: GarbageBlock, row: number, rules: Rules): void {
  if (row < 0 || row >= BOARD_ROWS) return;
  const colors = colorCountAt(p.speed, rules);
  for (let c = block.x; c < block.x + block.w; c++) {
    if (c < 0 || c >= BOARD_COLS) continue;
    if (p.grid[row][c]) continue;
    const color = pickConvertedColor(p, row, c, colors);
    const panel = makePanel(color as Panel['color'], false);
    panel.matchAnyway = true;
    panel.phase = 'hover';
    panel.timer = rules.difficulty.garbageHover;
    p.grid[row][c] = panel;
  }
}

function pickConvertedColor(p: PlayerState, row: number, col: number, colors: number): number {
  const banned = new Set<number>();
  const left1 = col >= 1 ? p.grid[row][col - 1] : null;
  const left2 = col >= 2 ? p.grid[row][col - 2] : null;
  const below1 = row + 1 < BOARD_ROWS ? p.grid[row + 1][col] : null;
  const below2 = row + 2 < BOARD_ROWS ? p.grid[row + 2][col] : null;
  if (left1 && left2 && left1.color === left2.color && !left1.shock && !left2.shock) banned.add(left1.color);
  if (below1 && below2 && below1.color === below2.color) banned.add(below1.color);
  for (let i = 0; i < 8; i++) {
    const draw = roll(p.rng, colors);
    p.rng = draw.state;
    if (!banned.has(draw.value)) return draw.value;
  }
  return 0;
}

function emitAttack(state: MatchState, index: number, p: PlayerState, comboSize: number, shockCount: number, color: number): void {
  if (index !== 0 && index !== 1) return;
  const target = state.players[1 - index];
  const pieces: GarbagePiece[] = [];

  if (shockCount >= 3) {
    const rows = Math.min(shockCount - SHOCK_GARBAGE_OFFSET, BOARD_ROWS);
    for (let i = 0; i < rows; i++) {
      pieces.push({ w: BOARD_COLS, h: 1, metal: true, isChain: false, order: 0, color });
    }
  }
  const widths = comboWidths(comboSize);
  for (let i = 0; i < widths.length; i++) {
    pieces.push({ w: widths[i], h: 1, metal: false, isChain: false, order: i, color });
  }
  if (p.chainCount >= 2) {
    const height = Math.min(p.chainCount - 1, CHAIN_GARBAGE_MAX_HEIGHT);
    pieces.push({ w: BOARD_COLS, h: height, metal: false, isChain: true, order: 0, color });
  }
  if (pieces.length === 0) return;

  // A fresh attack holds back everything that is already queued, which is why chaining
  // fast keeps your previous garbage in the air.
  const hold = GARBAGE_STAGING_FRAMES + GARBAGE_TELEGRAPH_FRAMES;
  for (let i = 0; i < target.incoming.length; i++) {
    if (target.incomingDelay[i] < hold) target.incomingDelay[i] = hold;
  }
  const delay = hold + GARBAGE_TRANSIT_FRAMES;
  for (const piece of pieces) {
    target.incoming.push(piece);
    target.incomingDelay.push(delay);
  }
}

export function comboWidths(comboSize: number): number[] {
  if (comboSize < 4) return [];
  if (comboSize < COMBO_GARBAGE.length) return COMBO_GARBAGE[comboSize];
  return COMBO_GARBAGE[COMBO_GARBAGE.length - 1];
}

function hasFallingGarbage(p: PlayerState): boolean {
  for (const block of p.garbage) if (block.falling) return true;
  return false;
}

function updateIncoming(p: PlayerState, rules: Rules): void {
  for (let i = 0; i < p.incomingDelay.length; i++) {
    if (p.incomingDelay[i] > 0) p.incomingDelay[i] -= 1;
  }
  if (p.incoming.length === 0) return;
  if (hasFallingGarbage(p)) return;
  if (isToppedOut(p)) return;

  let best = -1;
  let bestChain = 99;
  let bestOrder = 99;
  for (let i = 0; i < p.incoming.length; i++) {
    if (p.incomingDelay[i] > 0) continue;
    const piece = p.incoming[i];
    const kind = piece.metal ? 2 : piece.isChain ? 0 : 1;
    if (kind < bestChain || (kind === bestChain && piece.order < bestOrder)) {
      best = i;
      bestChain = kind;
      bestOrder = piece.order;
    }
  }
  if (best < 0) return;
  const piece = p.incoming[best];
  p.incoming.splice(best, 1);
  p.incomingDelay.splice(best, 1);
  spawnGarbage(p, piece, rules);
}

function spawnGarbage(p: PlayerState, piece: GarbagePiece, rules: Rules): void {
  const width = Math.max(1, Math.min(BOARD_COLS, piece.w));
  const height = Math.max(1, Math.min(BOARD_ROWS, piece.h));
  const columns = DROP_COLUMNS[width - 1] ?? [0];
  const pick = columns[p.nextGarbageId % columns.length];
  void rules;
  p.garbage.push({
    id: p.nextGarbageId,
    x: pick,
    y: -height,
    w: width,
    h: height,
    color: (piece.color & 7) as GarbageBlock['color'],
    metal: piece.metal,
    falling: true,
    justLanded: false,
  });
  p.nextGarbageId += 1;
}

/**
 * Garbage always falls when the cells under it are free, not only while it is still on its way
 * down from the sky. Without that, clearing the panels under a block left it hanging in mid air.
 * Blocks are handled bottom-up so a stack of them drops together instead of one row per frame.
 */
function updateGarbageBlocks(p: PlayerState, rules: Rules): void {
  void rules;
  for (const block of p.garbage) block.justLanded = false;
  const ordered = p.garbage.slice().sort((a, b) => b.y - a.y);
  for (const block of ordered) {
    const nextRow = block.y + block.h;
    let blocked = nextRow >= BOARD_ROWS;
    if (!blocked) {
      for (let c = block.x; c < block.x + block.w; c++) {
        if (c < 0 || c >= BOARD_COLS) continue;
        if (nextRow >= 0 && p.grid[nextRow][c] !== null) { blocked = true; break; }
        for (const other of p.garbage) {
          if (other === block) continue;
          if (c >= other.x && c < other.x + other.w && nextRow >= other.y && nextRow < other.y + other.h) { blocked = true; break; }
        }
        if (blocked) break;
      }
    }
    if (blocked) {
      if (block.falling) {
        block.falling = false;
        block.justLanded = true;
        p.shake = Math.max(p.shake, Math.min(SHAKE_FRAMES_MAX, block.h * SHAKE_FRAMES_PER_ROW));
      }
    } else {
      block.falling = true;
      block.y += 1;
    }
  }
}

// ---------------------------------------------------------------------------------
// Gravity
// ---------------------------------------------------------------------------------

function updateGravity(p: PlayerState, rules: Rules): void {
  for (let c = 0; c < BOARD_COLS; c++) {
    for (let r = BOARD_ROWS - 1; r >= 0; r--) {
      const panel = p.grid[r][c];
      if (!panel) continue;
      if (panel.phase !== 'normal' && panel.phase !== 'landing' && panel.phase !== 'hover' && panel.phase !== 'falling') continue;
      if (r + 1 >= BOARD_ROWS || isBlocked(p, r + 1, c)) {
        if (panel.phase === 'falling') { panel.phase = 'landing'; panel.timer = LANDING_FRAMES; }
        else if (panel.phase === 'landing') {
          panel.timer -= 1;
          if (panel.timer <= 0) { panel.phase = 'normal'; panel.matchAnyway = false; }
        } else if (panel.phase === 'hover') {
          // Nothing below is going anywhere, so settle here instead of hovering for ever.
          // A panel stuck in hover could not be swapped and it froze the rise for good.
          panel.phase = 'landing';
          panel.timer = LANDING_FRAMES;
        }
        continue;
      }
      // the cell below is free, so this panel has to keep dropping
      if (panel.phase === 'falling') {
        p.grid[r + 1][c] = panel;
        p.grid[r][c] = null;
      } else if (panel.phase === 'hover') {
        panel.timer -= 1;
        if (panel.timer <= 0) { panel.phase = 'falling'; p.grid[r + 1][c] = panel; p.grid[r][c] = null; }
      } else {
        panel.phase = 'hover';
        panel.timer = rules.difficulty.hover;
      }
    }
  }
}

// ---------------------------------------------------------------------------------
// Timers, speed, rise
// ---------------------------------------------------------------------------------

function updateStopTimers(p: PlayerState): void {
  if (p.preStop > 0) return;
  if (p.stopTime > 0) p.stopTime -= 1;
}

/** Panels needed to leave the given level, scaled by how brutal the difficulty is. */
export function panelsToNextLevel(level: number, rules: Rules): number {
  const base = PANELS_TO_NEXT_SPEED[Math.min(Math.max(level, 1), PANELS_TO_NEXT_SPEED.length) - 1];
  return Math.max(1, Math.round(base / rules.difficulty.rampMultiplier));
}

function updateSpeed(p: PlayerState, clearedThisTick: number, rules: Rules): void {
  let remaining = p.panelsToSpeedup - clearedThisTick;
  while (remaining <= 0 && p.speed < 99) {
    p.speed += 1;
    remaining += panelsToNextLevel(p.speed, rules);
  }
  p.panelsToSpeedup = remaining;
}

function updateRise(p: PlayerState, rules: Rules, swapQueued: boolean, colors: number): void {
  p.toppedOut = isToppedOut(p);
  if (p.toppedOut) {
    // Touching the ceiling is what loses the match. Stop time protects the rise, not the ceiling,
    // so the grace period can no longer be stretched out by clearing a combo first.
    p.health -= 1;
    return;
  }
  if (swapQueued || p.shake > 0 || hasActivePanels(p) || p.stopTime > 0) return;
  advanceRise(p, rules, 1);
  void colors;
}

/**
 * Rise arithmetic, all in integers. One frame is worth RISE_STEPS units, and a single
 * 1/16 row step costs `framesPerRow` units, so a whole row takes exactly framesPerRow frames.
 */
function advanceRise(p: PlayerState, rules: Rules, frames: number): void {
  const cost = riseStepFrames(p.speed);
  p.riseTimer -= frames * RISE_STEPS;
  let guard = 0;
  while (p.riseTimer <= 0 && guard < 64) {
    p.riseTimer += cost;
    riseOneStep(p, rules);
    guard += 1;
  }
}

/** Manual raise: one deliberate 1/16 step per frame, so a row takes 16 frames. [?] */
function manualRaise(p: PlayerState, rules: Rules): void {
  riseOneStep(p, rules);
}

function riseOneStep(p: PlayerState, rules: Rules): void {
  p.displacement -= 1;
  if (p.displacement <= 0) {
    p.displacement = RISE_STEPS;
    shiftRowsUp(p, colorCountAt(p.speed, rules), rules.mode.shockFrequency, rules.mode.adjacentDenial);
  }
}

function updateChainState(p: PlayerState): void {
  if (hasActivePanels(p)) {
    p.chainGrace = CHAIN_GRACE_FRAMES;
    return;
  }
  if (!p.chainActive) return;
  p.chainGrace -= 1;
  if (p.chainGrace <= 0) {
    p.chainActive = false;
    p.chainCount = 0;
    p.clearsThisChain = 0;
  }
}

function updateCallouts(p: PlayerState): void {
  if (p.comboDisplayTimer > 0) p.comboDisplayTimer -= 1;
  if (p.chainDisplayTimer > 0) p.chainDisplayTimer -= 1;
  else if (p.chainDisplayTimer === 0) p.chainDisplay = 0;
  if (p.comboDisplayTimer === 0) p.comboDisplay = 0;
}

function updateGameOver(p: PlayerState): void {
  if (isToppedOut(p)) {
    if (p.health <= 0 && p.shake === 0) p.gameOver = true;
    return;
  }
  p.health = p.maxHealth;
}

export { findMatches };

