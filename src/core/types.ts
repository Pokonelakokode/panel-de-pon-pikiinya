// Core deterministic game state. Everything in here must be plain JSON-serialisable data:
// no class instances, no floats, no functions. The same code runs on the server and on
// every client, so the simulation has to be bit-for-bit reproducible.

/** Panel colours. 0..4 are the five basic panels, 5 is the blue inverted triangle that only
 *  appears from a certain level onward (Vs. mode). */
export type PanelColor = 0 | 1 | 2 | 3 | 4 | 5;

/** Where a panel is in its life cycle. Only `normal` and `landing` panels can be matched or
 *  swapped, mirroring the original ("panels must be in place for the alignment to count"). */
export type PanelPhase =
  | 'normal'     // settled, playable
  | 'swapping'   // mid-swap animation (4 frames)
  | 'hover'      // floating in place after its support vanished
  | 'falling'    // actively dropping one cell per frame
  | 'landing'    // just landed, bounce animation, already matchable
  | 'flash'      // part of a matched group, white flash
  | 'face'       // part of a matched group, character face
  | 'popping'    // being removed
  | 'dead';      // game over decoration

export interface Panel {
  color: PanelColor;
  phase: PanelPhase;
  timer: number;
  /** Panels freed from a destroyed garbage block may match while still hovering. */
  matchAnyway: boolean;
  /** True while this panel is part of the currently resolving clear event. */
  matched: boolean;
  /** Swap partner identifier while `phase === 'swapping'`. */
  swapId: number;
  /** Shock ("!") panels only match other shock panels and send metal garbage. */
  shock: boolean;
  /** Position in the pop order of the clear event this panel belongs to. */
  order: number;
}

export interface GarbageBlock {
  id: number;
  /** Column of the left edge, 0-based. */
  x: number;
  /** Row of the top edge; may be negative while the block is still above the playfield. */
  y: number;
  w: number;
  h: number;
  /** Colour of the panels this block turns into; owned by the player who sent it. */
  color: PanelColor;
  /** Metal (shock) garbage is destroyed by a match but never turns into panels. */
  metal: boolean;
  falling: boolean;
  /** Set when the block has just landed and the board should shake. */
  justLanded: boolean;
}

export interface GarbagePiece {
  w: number;
  h: number;
  metal: boolean;
  /** Chain garbage is delivered before combo garbage. */
  isChain: boolean;
  /** Combo pieces are delivered smallest first. */
  order: number;
  /** Colour of the panels the block turns into; owned by whoever sent it. */
  color: number;
}

export interface Cursor {
  x: number;
  y: number;
  /** Frames left in the current swap animation. */
  swapTimer: number;
  /** Cell coordinates of the two panels currently swapping, or -1. */
  swapX: number;
  swapY: number;
  swapDir: number;
  /** Held direction and its repeat countdown, for DAS-like cursor movement. */
  heldDir: number;
  holdTimer: number;
  /** Frames before another swap may be started. */
  swapCooldown: number;
  /** True while the swap button is already down, so holding it does not repeat. */
  swapHeld: boolean;
}

export interface PlayerState {
  /** 12 visible rows x 6 columns. Row 0 is the ceiling. */
  grid: (Panel | null)[][];
  garbage: GarbageBlock[];
  cursor: Cursor;
  /** Frames accumulated towards the next 1/16 row of rise, in 1/16 units. */
  riseTimer: number;
  /** Sub-row displacement, 16..0; purely cosmetic but kept in state so replays match. */
  displacement: number;
  /** Index into the rise table (1-based level, capped at 99). */
  speed: number;
  /** Panels still to clear before the speed goes up (classic Vs. rule). */
  panelsToSpeedup: number;
  /** Grace frames left before a topped-out stack loses the match. */
  health: number;
  maxHealth: number;
  /** Frames the board shakes after a heavy garbage block lands. */
  shake: number;
  /** Rise freeze earned with combos and chains (frames). */
  stopTime: number;
  /** Remaining duration of the current clear animation; blocks stopTime from ticking. */
  preStop: number;
  /** Garbage that has been earned by the opponent but has not started falling yet. */
  incoming: GarbagePiece[];
  /** Frames each queued piece still has to wait in transit before it may fall. */
  incomingDelay: number[];
  /** Panels cleared by the clear event that is currently resolving. */
  comboSize: number;
  comboDisplay: number;
  comboDisplayTimer: number;
  chainCount: number;
  chainDisplay: number;
  chainDisplayTimer: number;
  /** True while a chain is being built; the chain survives for `chainGrace` frames of calm. */
  chainActive: boolean;
  chainGrace: number;
  /** Set when the current clear event is a link in a chain rather than a fresh attack. */
  clearsThisChain: number;
  score: number;
  panelsCleared: number;
  toppedOut: boolean;
  gameOver: boolean;
  /** Free-running counter used to give garbage blocks unique ids. */
  nextGarbageId: number;
  /** Frames the player has been waiting for the opponent input to arrive (diagnostics). */
  stall: number;
  /** Deterministic PRNG state, advanced only by the simulation. */
  rng: number;
}

export type ModeId = 'vs' | 'endless' | 'timeattack';
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'shard';

export interface MatchState {
  tick: number;
  seed: number;
  mode: ModeId;
  difficulty: DifficultyId;
  players: [PlayerState, PlayerState];
  /** null while the match is running; -1 signals a draw. */
  winner: number | null;
  finished: boolean;
  /** Time-attack clock, in frames. */
  clock: number;
}

/** Buttons are transmitted as a bitmask, never as positions. */
export const BTN = {
  up: 1,
  down: 2,
  left: 4,
  right: 8,
  swap: 16,
  raiseLeft: 32,
  raiseRight: 64,
  start: 128,
} as const;

export interface PlayerInput { buttons: number }

export const NO_INPUT: PlayerInput = { buttons: 0 };

export function emptyGrid(rows: number, cols: number): (Panel | null)[][] {
  const grid: (Panel | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: (Panel | null)[] = [];
    for (let c = 0; c < cols; c++) row.push(null);
    grid.push(row);
  }
  return grid;
}

