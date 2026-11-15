// Every tunable number lives here, with a note about how trustworthy it is.
//
// [P] = documented in the original game's manual / official material / reputable wiki
// [C] = reverse engineered by the community (Panel Attack engine data, speedrun RAM maps)
// [?] = not confirmed anywhere; chosen so the game feels right, tune by playtesting

import type { DifficultyId, ModeId } from './types.ts';

export const BOARD_COLS = 6;
export const BOARD_ROWS = 12;
export const FPS = 60;

/** Rise is applied in 1/16 row steps, exactly like the original. */
export const RISE_STEPS = 16;

/** How many rows above the playfield garbage may wait in before it drops. */
export const SKY_ROWS = 12;

// ---------------------------------------------------------------------------
// Difficulty presets (Vs. mode, "classic" rules)
// ---------------------------------------------------------------------------

export interface DifficultyPreset {
  /** Frames a panel hovers before it begins to fall. [C] */
  hover: number;
  /** Frames panels flash / show a face / pop, per cleared panel. [C] */
  flash: number;
  face: number;
  pop: number;
  /** Stop time earned by a combo, a chain, and by either while topped out. [C] */
  stopCombo: number;
  stopChain: number;
  stopDanger: number;
  /** Frames a garbage block hovers after being broken into panels before it drops. [C] */
  garbageHover: number;
  /** Grace frames before a topped out stack loses. [C], Vs. value unconfirmed. */
  maxHealth: number;
  /**
   * Divides the number of panels needed for the next level, so a bigger value means the stack
   * speeds up sooner. This is what makes the difficulty setting felt in the solo modes. [?]
   */
  rampMultiplier: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyPreset> = {
  easy:   { hover: 12, face: 17, flash: 44, pop: 9, stopCombo: 120, stopChain: 300, stopDanger: 600, garbageHover: 41, maxHealth: 60, rampMultiplier: 0.7 },
  normal: { hover: 9,  face: 13, flash: 36, pop: 8, stopCombo: 120, stopChain: 180, stopDanger: 420, garbageHover: 41, maxHealth: 50, rampMultiplier: 1 },
  hard:   { hover: 6,  face: 15, flash: 22, pop: 7, stopCombo: 120, stopChain: 120, stopDanger: 240, garbageHover: 41, maxHealth: 40, rampMultiplier: 1.5 },
  shard:  { hover: 3,  face: 10, flash: 16, pop: 6, stopCombo: 90,  stopChain: 90,  stopDanger: 180, garbageHover: 41, maxHealth: 30, rampMultiplier: 2.2 },
};

/** Display names for the difficulty ladder of the original (EASY/NORMAL/HARD/S-HARD). */
export const DIFFICULTY_LABELS: Record<DifficultyId, string> = {
  easy: 'Easy', normal: 'Normal', hard: 'Hard', shard: 'S-Hard',
};

// ---------------------------------------------------------------------------
// Rise speed. Index = level (1..100). Value = frames per whole row. [C]
// "Yes, 2 is slower than 1 and 50..99 are the same" - straight from the reference
// engine data; the level 50 speed cap is independently confirmed by TCRF.
// ---------------------------------------------------------------------------

export const RISE_FRAMES_PER_ROW: number[] = [
  942, 983, 838, 790, 755, 695, 649, 604, 570, 515,
  474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
  240, 227, 213, 201, 189, 178, 169, 158, 148, 138,
  129, 120, 112, 105, 99, 92, 86, 82, 77, 73,
  69, 66, 62, 59, 56, 54, 52, 50, 48, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
];

/** Frames per single 1/16 row step at the given level. */
export function riseStepFrames(speed: number): number {
  const i = Math.min(Math.max(speed, 1), RISE_FRAMES_PER_ROW.length) - 1;
  return RISE_FRAMES_PER_ROW[i];
}

/** Panels to clear before the speed increases, classic Vs. rule. [C] */
export const PANELS_TO_NEXT_SPEED: number[] = [
  9, 12, 12, 12, 12, 12, 15, 15, 18, 18,
  24, 24, 24, 24, 24, 24, 21, 18, 18, 18,
  36, 36, 36, 36, 36, 36, 36, 36, 36, 36,
  39, 39, 39, 39, 39, 39, 39, 39, 39, 39,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
];

// ---------------------------------------------------------------------------
// Attacks. [C] both tables come straight from the reference engine.
// ---------------------------------------------------------------------------

/**
 * Garbage sent by a combo: 1 row tall pieces of the given widths.
 * Widths are columns; the original splits anything above 7 panels into several pieces.
 * Index = number of panels cleared in one event (3 or fewer sends nothing).
 */
export const COMBO_GARBAGE: number[][] = [
  [], [], [], [],
  [3], [4], [5],
  [6], [3, 4], [4, 4],
  [5, 5], [5, 6], [6, 6],
  [6, 6, 6], [6, 6, 6, 6],
  [6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6], [6, 6, 6, 6],
  [6, 6, 6, 6, 6, 6], [6, 6, 6, 6, 6, 6], [6, 6, 6, 6, 6, 6], [6, 6, 6, 6, 6, 6],
  [6, 6, 6, 6, 6, 6], [6, 6, 6, 6, 6, 6], [6, 6, 6, 6, 6, 6],
  [6, 6, 6, 6, 6, 6, 6, 6],
];

/** Chain garbage is always 6 wide; only its thickness grows, and it is capped at 12 rows. */
export const CHAIN_GARBAGE_MAX_HEIGHT = 12;

/** Clearing N shock ("!") panels sends N-2 rows of metal garbage. */
export const SHOCK_GARBAGE_OFFSET = 2;

/**
 * Frames a freshly earned attack waits before it starts travelling towards the opponent.
 * The reference engine uses 45 frames of staging plus 45 frames of telegraph. [C] [?]
 */
export const GARBAGE_STAGING_FRAMES = 45;
export const GARBAGE_TELEGRAPH_FRAMES = 45;
/** Frames a piece takes to cross to the opponent before it may drop. [C] */
export const GARBAGE_TRANSIT_FRAMES = 60;

/** Frames the board shakes when a garbage block lands, per row of thickness. [C] [?] */
export const SHAKE_FRAMES_PER_ROW = 6;
export const SHAKE_FRAMES_MAX = 60;

// ---------------------------------------------------------------------------
// Scoring. [C] (from the reference engine, Tetris Attack tables)
// ---------------------------------------------------------------------------

export const SCORE_CHAIN = [0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800];
export const SCORE_COMBO = [
  0, 0, 0, 20, 30,
  50, 60, 70, 80, 100,
  140, 170, 210, 250, 290,
  340, 390, 440, 490, 550,
  610, 680, 750, 820, 900,
  980, 1060, 1150, 1240, 1330,
];

// ---------------------------------------------------------------------------
// Mode presets
// ---------------------------------------------------------------------------

export interface ModePreset {
  /** Attacks are sent to the opponent. */
  versus: boolean;
  /** The five basic colours, plus the sixth above `sixthColorLevel`. */
  baseColors: number;
  sixthColorLevel: number;
  /** Shock panels per generated row, 0 disables them. 0..1. */
  shockFrequency: number;
  /** Maximum number of shock panels that may sit on the board at once. */
  shockCap: number;
  /** Starting level. */
  startingSpeed: number;
  /** Two identical panels may never be generated next to each other. */
  adjacentDenial: boolean;
  /** Rows of panels the board starts with. */
  startingRows: number;
  /** Frames on the clock, or 0 for no clock. */
  timeLimit: number;
  /** Frames added to the clock per panel cleared. */
  timePerPanel: number;
  /** Grace frames when topped out; the Vs. value is unconfirmed. [?] */
  maxHealth: number;
}

export const MODES: Record<ModeId, ModePreset> = {
  vs: {
    versus: true, baseColors: 5, sixthColorLevel: 9, shockFrequency: 0.03, shockCap: 4,
    startingSpeed: 1, adjacentDenial: true, startingRows: 5, timeLimit: 0, timePerPanel: 0, maxHealth: 60,
  },
  endless: {
    versus: false, baseColors: 6, sixthColorLevel: 1, shockFrequency: 0, shockCap: 0,
    startingSpeed: 1, adjacentDenial: false, startingRows: 5, timeLimit: 0, timePerPanel: 0, maxHealth: 60,
  },
  timeattack: {
    versus: false, baseColors: 6, sixthColorLevel: 1, shockFrequency: 0, shockCap: 0,
    startingSpeed: 1, adjacentDenial: false, startingRows: 5, timeLimit: 120 * FPS, timePerPanel: 12, maxHealth: 60,
  },
};

/** Cursor hold before it starts repeating, and the repeat period, in frames. [?] */
export const CURSOR_REPEAT_DELAY = 20;
export const CURSOR_REPEAT_PERIOD = 1;

/** A swap always takes four frames and cannot be cancelled. [P] */
export const SWAP_FRAMES = 4;

/** Frames a chain stays alive after the board goes quiet, so active chaining works. [?] */
export const CHAIN_GRACE_FRAMES = 20;

/** How long the combo/chain callouts stay on screen. */
export const CALLOUT_FRAMES = 60;
export const CALLOUT_LONG_FRAMES = 96;

export function difficultyOf(id: DifficultyId): DifficultyPreset {
  return DIFFICULTIES[id];
}

export function modePreset(id: ModeId): ModePreset {
  return MODES[id];
}

