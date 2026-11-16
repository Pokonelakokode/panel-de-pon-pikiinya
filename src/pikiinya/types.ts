export const PIKI_COLS = 6 as const;
export const MIN_PIKI_COLS = 6 as const;
export const MAX_PIKI_COLS = 12 as const;
export const PIKI_ROWS = 14 as const;
export const PIKI_SPAWN_ROWS = 2 as const;
export const PIKI_TILE = 36 as const;

export const CELL = {
  EMPTY: 0,
  ICE: 1,
  PIKI: 2,
  FROZEN_PIKI: 3,
  TARGET: 4,
  MIRACLE: 6,
  FROZEN_MIRACLE: 7,
} as const;

export type CellType = (typeof CELL)[keyof typeof CELL];

export type PikiMode =
  | 'story'
  | 'vs2p'
  | 'online'
  | 'stageclear'
  | 'endless'
  | 'endurance'
  | 'timeattack'
  | 'puzzle'
  | 'tutorial';

export type BoardPhase = 'falling' | 'gravity' | 'clearing';

export interface PikiCell {
  type: CellType;
  groupSize: number;
  clearing: boolean;
  thawing: boolean;
  excitedTimer: number;
  fallOffset: number;
}

/**
 * 2x2 falling unit: [TL, TR, BR, BL]
 */
export type QuadCells = [CellType, CellType, CellType, CellType];

export interface FallingQuad {
  col: number;
  row: number;
  subRow: number;
  cells: QuadCells;
  lockTimer: number;
  rotVisual: number;
}

export interface PikiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface PikiPopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface ClearSummary {
  iceRows: number;
  thawedCount: number;
  thawedMiracles: number;
  clearedPiki: number;
  clearedTargets: number;
  clearedMiracles: number;
  allClear: boolean;
  garbageSent: number;
}

export interface PikiBoardOptions {
  cols?: number;
  allowTargetInRandom?: boolean;
  allowMiracleItem?: boolean;
  queue?: QuadCells[];
  initialGrid?: readonly (readonly number[])[];
  padNarrowGridWithIce?: boolean;
  isVsMode?: boolean;
}

export interface PikiBoardState {
  cols: number;
  grid: PikiCell[][];
  rngState: number;
  allowTargetInRandom: boolean;
  allowMiracleItem: boolean;
  isVsMode: boolean;
  pieceQueue: QuadCells[];
  queueCursor: number;

  current: FallingQuad | null;
  next: QuadCells;

  phase: BoardPhase;
  phaseTimer: number;
  chainStep: number;
  maxChain: number;
  score: number;
  piecesSpawned: number;
  clearedPikiCount: number;
  clearedTargetCount: number;
  iceRowsCleared: number;
  allClears: number;
  pendingGarbage: number;
  garbageDroppedThisTurn: boolean;
  lastClearSummary: ClearSummary | null;
  toppedOut: boolean;

  particles: PikiParticle[];
  popups: PikiPopup[];
  elapsedTime: number;
}

export interface CpuOpponentProfile {
  stageNumber: number;
  name: string;
  shortName: string;
  title: string;
  avatar: string;
  quote: string;
  tierTag: string;
  moveInterval: number;
  thinkPause: number;
  mistakeRate: number;
  chainWeight: number;
  fallSpeed: number;
}

export interface StageClearDef {
  id: string;
  course: 'omote' | 'ura';
  stageNumber: number;
  title: string;
  subtitle: string;
  fallSpeed: number;
  grid: readonly (readonly number[])[];
}

export interface PikiPuzzleDef {
  id: string;
  title: string;
  hint: string;
  grid: readonly (readonly number[])[];
  pieceQueue: QuadCells[];
}

export interface TutorialStepDef {
  id: string;
  title: string;
  instruction: string;
  goalText: string;
  grid: readonly (readonly number[])[];
  pieceQueue: QuadCells[];
  checkGoal: (board: PikiBoardState) => boolean;
}

export type PlayerActionKey = 'up' | 'down' | 'left' | 'right' | 'swap' | 'raise';

export interface PlayerKeyBindings {
  up: [string, string];
  down: [string, string];
  left: [string, string];
  right: [string, string];
  swap: [string, string];
  raise: [string, string];
}

export interface ControlsConfig {
  p1: PlayerKeyBindings;
  p2: PlayerKeyBindings;
  padP1: string;
  padP2: string;
}

export interface SnesAudioBridge {
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  isDanger: boolean;
  gameTheme: 'pdp' | 'pikiinya';
  bgmSource?: 'ost' | 'synth';
  setContext?: (game: 'pdp' | 'pikiinya', mode: string, stageIndex?: number) => void;
  unlock: () => void;
  startBGM: () => void;
  playMove: () => void;
  playSwap: () => void;
  playRotate: () => void;
  playIceShatter: () => void;
  playThaw: () => void;
  playPikiClear: (chain?: number) => void;
  playMiracle: () => void;
  playPop: (chain?: number) => void;
  playChain: (chain?: number) => void;
  playGarbageLand: () => void;
  playGameOver: () => void;
  playVictory: () => void;
  syncOstPlayback?: () => void;
}

export interface SnesBridgeApi {
  getActiveGame: () => 'pdp' | 'pikiinya';
  switchAppGame: (game: 'pdp' | 'pikiinya') => void;
  audio: SnesAudioBridge;
  getControlsConfig: () => ControlsConfig;
  codeMatchesSlot: (playerKey: 'p1' | 'p2', actionKey: PlayerActionKey, code: string) => boolean;
  getConnectedGamepadsList: () => Gamepad[];
  resolvePlayerGamepad: (playerSlot: 'p1' | 'p2', connectedPads: Gamepad[]) => Gamepad | null;
  isPadBtnPressed: (pad: Gamepad, idx: number) => boolean;
  formatKeyCode: (code: string) => string;
  openSettingsModal: () => void;
  openRomModal: () => void;
  openOstModal?: () => void;
  toggleMusic: () => void;
  toggleSound: () => void;
  toggleCRT: () => void;
  setActivePauseHandler?: (handler: ((paused: boolean) => void) | null) => void;
}

declare global {
  interface Window {
    activeAppGame?: 'pdp' | 'pikiinya';
    snesBridge?: SnesBridgeApi;
  }
}
