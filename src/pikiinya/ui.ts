import {
  CELL,
  MAX_PIKI_COLS,
  MIN_PIKI_COLS,
  PIKI_COLS,
  PIKI_ROWS,
  PIKI_SPAWN_ROWS,
  PIKI_TILE,
  type CellType,
  type CpuOpponentProfile,
  type PikiBoardState,
  type PikiMode,
  type SnesBridgeApi,
} from './types.ts';
import {
  clampPikiCols,
  cloneBoardState,
  countRemainingPikiOrTargets,
  countRemainingTargets,
  createBoardState,
  createCell,
  createEmptyCell,
  hardDropQuad,
  moveQuadX,
  rotateQuad,
  stepBoard,
  updatePikiGroupSizes,
} from './core.ts';
import {
  getStoryRivalProfile,
  PIKI_PUZZLES,
  STAGE_CLEAR_LEVELS,
  TUTORIAL_STEPS,
} from './modes.ts';
import { createCpuController, stepCpuAgent, type CpuControllerState } from './ai.ts';
import {
  drawPikiCell,
  renderEnduranceRaceCanvas,
  renderNextQuadCanvas,
  renderPikiBoard,
} from './render.ts';

interface PadTracker {
  dirX: -1 | 0 | 1;
  dasTimer: number;
  upHeld: boolean;
  cwHeld: boolean;
  ccwHeld: boolean;
  startHeld: boolean;
}

interface KeyRepeatTracker {
  dirX: -1 | 0 | 1;
  dasTimer: number;
}

const DEFAULT_CUSTOM_STAGE: number[][] = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0],
  [0, 4, 0, 0, 4, 0],
  [1, 3, 2, 2, 3, 1],
];

function safeLoadNumber(key: string, fallback: number): number {
  try {
    const val = Number(localStorage.getItem(key));
    return Number.isFinite(val) && val >= 0 ? val : fallback;
  } catch {
    return fallback;
  }
}

function safeSave(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function createTsukuruBlankGrid(cols: number = PIKI_COLS): number[][] {
  const safeCols = clampPikiCols(cols);
  const g: number[][] = Array.from({ length: PIKI_ROWS }, () =>
    new Array<number>(safeCols).fill(0)
  );
  const start = PIKI_ROWS - DEFAULT_CUSTOM_STAGE.length;
  for (let r = 0; r < DEFAULT_CUSTOM_STAGE.length; r++) {
    const src = DEFAULT_CUSTOM_STAGE[r];
    const colOff = Math.max(0, Math.floor((safeCols - src.length) / 2));
    for (let c = 0; c < Math.min(src.length, safeCols); c++) {
      g[start + r][colOff + c] = src[c];
    }
  }
  return g;
}

function resizeMatrixCols(matrix: readonly (readonly number[])[], targetCols: number): number[][] {
  const safeCols = clampPikiCols(targetCols);
  const out: number[][] = Array.from({ length: PIKI_ROWS }, () => new Array<number>(safeCols).fill(0));
  const rowCount = Math.min(PIKI_ROWS, matrix.length);
  const startRow = PIKI_ROWS - rowCount;
  for (let r = 0; r < rowCount; r++) {
    const src = matrix[matrix.length - rowCount + r] ?? [];
    if (src.length <= safeCols) {
      const colOff = Math.floor((safeCols - src.length) / 2);
      for (let c = 0; c < src.length; c++) {
        out[startRow + r][colOff + c] = src[c] ?? 0;
      }
    } else {
      const srcOff = Math.floor((src.length - safeCols) / 2);
      for (let c = 0; c < safeCols; c++) {
        out[startRow + r][c] = src[srcOff + c] ?? 0;
      }
    }
  }
  return out;
}

export class PikiinyaController {
  private readonly root: HTMLElement;
  private readonly bridge: SnesBridgeApi;

  private mode: PikiMode = 'story';
  private active = false;
  private paused = false;
  private roundOver = false;
  private victory = false;
  private stageClearPending = false;
  private helpModalOpen = false;
  private setupPageOpen = false;

  private configuredCols = clampPikiCols(safeLoadNumber('piki_board_cols', PIKI_COLS));
  private showGhostPiece = safeLoadNumber('piki_show_ghost', 1) !== 0;
  private lockScriptedModesTo6Cols = safeLoadNumber('piki_lock_puzzle_cols', 1) !== 0;

  private storyStage = 0;
  private storyStreak = 0;
  private bestStoryStreak = safeLoadNumber('piki_best_streak', 0);

  private stageClearIdx = 0;
  private uraUnlocked = safeLoadNumber('piki_ura_unlocked', 0) === 1;

  private p1MatchWins = 0;
  private p2MatchWins = 0;

  private puzzleIdx = 0;
  private puzzleHistory: PikiBoardState[] = [];
  private turnStartSnapshot: PikiBoardState | null = null;
  private turnSnapshotRecorded = false;
  private tsukuruActive = false;
  private tsukuruEditing = false;
  private tsukuruBrush: CellType = CELL.ICE;
  private tsukuruGrid: number[][] = [];
  private tsukuruSlot = 0;

  private tutorialIdx = 0;
  private tutorialSolvedHold = 0;

  private baseLevel = 1;
  private timeRemainingSec = 120;
  private elapsedSec = 0;

  // Endurance Race metrics
  private raceDistanceM = 0;
  private raceSpeedKmh = 18;
  private raceLap = 1;

  private highScores: Record<string, number> = {
    story: safeLoadNumber('piki_hi_story', 12000),
    vs2p: safeLoadNumber('piki_hi_vs2p', 10000),
    stageclear: safeLoadNumber('piki_hi_stage', 8000),
    endless: safeLoadNumber('piki_hi_endless', 15000),
    endurance: safeLoadNumber('piki_hi_endurance', 1200),
    timeattack: safeLoadNumber('piki_hi_time', 9000),
    puzzle: safeLoadNumber('piki_hi_puzzle', 5000),
    tutorial: 0,
  };

  private board!: PikiBoardState;
  private p2Board!: PikiBoardState;
  private cpuCtrl: CpuControllerState = createCpuController();
  private seedCounter = 19970131;

  // Canvas references
  private p1Canvas!: HTMLCanvasElement;
  private p1Ctx!: CanvasRenderingContext2D;
  private p1NextCanvas!: HTMLCanvasElement;
  private p1NextCtx!: CanvasRenderingContext2D;

  private p2Canvas!: HTMLCanvasElement;
  private p2Ctx!: CanvasRenderingContext2D;
  private p2NextCanvas!: HTMLCanvasElement;
  private p2NextCtx!: CanvasRenderingContext2D;

  private raceCanvas!: HTMLCanvasElement;
  private raceCtx!: CanvasRenderingContext2D;

  private setupPreviewCanvas!: HTMLCanvasElement;
  private setupPreviewCtx!: CanvasRenderingContext2D;

  // Input state
  private heldKeys = new Set<string>();
  private keyRepeatP1: KeyRepeatTracker = { dirX: 0, dasTimer: 0 };
  private keyRepeatP2: KeyRepeatTracker = { dirX: 0, dasTimer: 0 };
  private padP1: PadTracker = { dirX: 0, dasTimer: 0, upHeld: false, cwHeld: false, ccwHeld: false, startHeld: false };
  private padP2: PadTracker = { dirX: 0, dasTimer: 0, upHeld: false, cwHeld: false, ccwHeld: false, startHeld: false };
  private pointerDrag: {
    startX: number;
    startY: number;
    lastStepX: number;
    moved: boolean;
    painting: boolean;
  } | null = null;

  private rafId: number | null = null;
  private lastTickMs = 0;

  constructor(root: HTMLElement, bridge: SnesBridgeApi) {
    this.root = root;
    this.bridge = bridge;
    this.tsukuruGrid = createTsukuruBlankGrid(this.configuredCols);
    this.buildDOM();
    this.bindDOMEvents();
    this.initModeBoard();
    this.syncSetupUI();
    this.startLoop();
  }

  private isExternalModalOpen(): boolean {
    const ostDlg = document.getElementById('ost-dialog') as HTMLDialogElement | null;
    if (ostDlg?.open) return true;
    const settingsDlg = document.getElementById('settings-dialog') as HTMLDialogElement | null;
    if (settingsDlg?.open) return true;
    const romModal = document.getElementById('rom-modal');
    if (romModal && !romModal.classList.contains('hidden')) {
      return window.getComputedStyle(romModal).display !== 'none';
    }
    return false;
  }

  private syncBgmState(): void {
    const win = window as Window & { isPikiBgmPlaying?: boolean };
    const next =
      this.active &&
      !this.paused &&
      !this.roundOver &&
      !this.victory &&
      !this.stageClearPending &&
      !this.helpModalOpen &&
      !this.setupPageOpen &&
      !this.isExternalModalOpen();
    const changed = win.isPikiBgmPlaying !== next;
    win.isPikiBgmPlaying = next;
    if (changed) {
      this.bridge.audio.syncOstPlayback?.();
    }
  }

  private syncOstContext(): void {
    let modeKey: string = this.mode;
    let stageIdx = 0;
    if (this.mode === 'stageclear') {
      const stg = STAGE_CLEAR_LEVELS[this.stageClearIdx];
      modeKey = stg?.course === 'ura' ? 'stageclear_ura' : 'stageclear';
    } else if (this.mode === 'story') {
      stageIdx = this.storyStage;
    }
    this.bridge.audio.setContext?.('pikiinya', modeKey, stageIdx);
  }

  public setActive(isActive: boolean): void {
    this.active = isActive;
    if (isActive) {
      this.bridge.audio.gameTheme = 'pikiinya';
      this.syncOstContext();
      this.lastTickMs = performance.now();
      this.syncBgmState();
      this.syncAudioButtons();
      this.updateHUD();
      this.renderAll();
      try {
        this.p1Canvas.focus();
      } catch {
        // ignore focus restriction
      }
    } else {
      this.heldKeys.clear();
      this.bridge.audio.isDanger = false;
      this.syncBgmState();
    }
  }

  public pauseFromModal(shouldPause: boolean): void {
    if (!this.active) return;
    if (shouldPause && !this.paused && !this.roundOver && !this.victory && !this.stageClearPending) {
      this.paused = true;
      this.showOverlay('⏸️', 'PAUSED', 'Pikiinya! is paused while settings are open.', '▶ RESUME');
    } else if (!shouldPause && this.paused && !this.roundOver && !this.victory && !this.stageClearPending) {
      this.paused = false;
      this.hideOverlay();
    }
    this.syncBgmState();
  }

  private nextSeed(): number {
    this.seedCounter = (this.seedCounter * 1664525 + 1013904223) >>> 0;
    return this.seedCounter || 19970131;
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <!-- Top Bar -->
      <header class="w-full max-w-7xl flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl piki-card mb-2">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-500 to-blue-700 flex items-center justify-center border-2 border-yellow-300 shadow-lg float-anim">
            <span class="text-xl">🐧</span>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="pixel-font text-sm sm:text-base text-yellow-300 drop-shadow">PIKIINYA!</h1>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-cyan-600 border border-cyan-200 text-white font-bold">SNES 1997</span>
            </div>
            <p class="text-xs text-sky-200 hidden sm:block">Crea-Tech / ASCII • Ice Row Thaw &amp; 6-Penguin Action Puzzle</p>
          </div>
        </div>

        <!-- All Original Game Modes -->
        <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Pikiinya Game Modes">
          <button type="button" data-piki-mode="story" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">⚔️ Andes VS</button>
          <button type="button" data-piki-mode="vs2p" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">👥 2P VS</button>
          <button type="button" data-piki-mode="stageclear" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">🔓 Stage Clear</button>
          <button type="button" data-piki-mode="endless" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">♾️ Endless</button>
          <button type="button" data-piki-mode="endurance" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">🏃 Endurance</button>
          <button type="button" data-piki-mode="timeattack" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">⏱️ 2-Min</button>
          <button type="button" data-piki-mode="puzzle" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">🧩 Puzzle/Maker</button>
          <button type="button" data-piki-mode="tutorial" class="piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold">🎓 Lecture</button>
        </div>

        <!-- Utility Buttons -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" id="piki-btn-setup" title="Pályaszélesség &amp; Játék Setup" class="snes-btn px-2.5 h-9 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white border border-yellow-300 text-xs font-bold">🛠️ SETUP</button>
          <button type="button" id="piki-btn-rom" title="Boot Original Pikiinya! SNES ROM" class="snes-btn px-2.5 h-9 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-300 text-xs font-bold">💾 ROM</button>
          <button type="button" id="piki-btn-settings" title="Keyboard & Gamepad Settings" class="snes-btn px-2.5 h-9 rounded-xl bg-fuchsia-700 hover:bg-fuchsia-600 text-white border border-fuchsia-300 text-xs font-bold">⚙️ KEYS</button>
          <button type="button" id="piki-btn-ost" title="Original SNES OST Jukebox &amp; Downloads" class="snes-btn px-2.5 h-9 rounded-xl bg-amber-600 hover:bg-amber-500 text-white border border-amber-300 text-xs font-bold">🎧 OST</button>
          <button type="button" id="piki-btn-bgm" title="Toggle Music" class="snes-btn px-2 h-9 rounded-xl bg-sky-800 hover:bg-sky-700 text-yellow-300 border border-sky-400 text-xs font-bold">🎵</button>
          <button type="button" id="piki-btn-sfx" title="Toggle SFX" class="snes-btn px-2 h-9 rounded-xl bg-sky-800 hover:bg-sky-700 text-cyan-200 border border-sky-400 text-xs font-bold">🔊</button>
          <button type="button" id="piki-btn-crt" title="Toggle CRT" class="snes-btn px-2 h-9 rounded-xl bg-sky-800 hover:bg-sky-700 text-pink-200 border border-sky-400 text-xs font-bold">📺</button>
          <button type="button" id="piki-btn-help" title="How to Play Pikiinya!" class="snes-btn px-2.5 h-9 rounded-xl bg-amber-600 hover:bg-amber-500 text-white border border-amber-300 text-xs font-bold">❓ HELP</button>
        </div>
      </header>

      <!-- Endurance Race Track Strip (visible in Endurance mode) -->
      <section id="piki-race-strip" class="hidden w-full max-w-7xl piki-card rounded-2xl p-2 mb-2">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5 px-1 text-xs">
          <span class="font-bold text-cyan-200">🏃 ANDES ENDURANCE RACE • Clear Ice &amp; Pikiinyas to Sprint Faster!</span>
          <div class="flex items-center gap-3 pixel-font text-[10px]">
            <span class="text-yellow-300" id="piki-race-lap">LAP 1</span>
            <span class="text-emerald-300" id="piki-race-speed">18 km/h</span>
            <span class="text-sky-200" id="piki-race-dist">0 m</span>
          </div>
        </div>
        <canvas id="piki-race-canvas" width="900" height="68" class="w-full h-16 rounded-xl border border-sky-400/50 block"></canvas>
      </section>

      <!-- Main Layout -->
      <main id="piki-arena-main" class="w-full max-w-7xl flex-1 flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-3 my-auto">

        <!-- Left Sidebar -->
        <aside class="w-full lg:w-60 xl:w-64 flex flex-col gap-2.5 order-2 lg:order-1 shrink">
          <!-- Opponent / Stage Card -->
          <div class="piki-card rounded-2xl p-3 space-y-2.5">
            <div class="flex items-center gap-3">
              <div id="piki-char-avatar" class="w-12 h-12 rounded-xl bg-gradient-to-b from-sky-400 to-blue-700 border-2 border-yellow-300 flex items-center justify-center text-2xl shrink-0">🦊</div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-1">
                  <span id="piki-stage-badge" class="text-[10px] px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 font-bold truncate">STAGE 1</span>
                  <span id="piki-danger-pill" class="hidden text-[10px] pixel-font text-rose-400 animate-pulse">DANGER!</span>
                </div>
                <h2 id="piki-char-name" class="font-bold text-sm sm:text-base text-sky-100 truncate mt-0.5">Bongo the Bumbler</h2>
                <p id="piki-char-quote" class="text-[11px] text-sky-300 italic truncate">"Little birdies, hop into my net!"</p>
              </div>
            </div>

            <!-- Story Rival Selector -->
            <div id="piki-story-box" class="bg-slate-950/70 rounded-xl p-2 border border-sky-500/40 space-y-1.5">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-sky-200 font-bold">🏆 Story Streak:</span>
                <span id="piki-story-streak" class="pixel-font text-[10px] text-amber-300">0 WINS (BEST: 0)</span>
              </div>
              <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] text-sky-300">Rival:</span>
                <div class="flex items-center gap-1">
                  <button type="button" id="piki-prev-rival" class="snes-btn px-2 py-0.5 rounded bg-sky-800 text-xs font-bold text-white border border-sky-400">◀</button>
                  <span id="piki-rival-tier" class="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-800 text-yellow-200 min-w-[78px] text-center">STAGE 1</span>
                  <button type="button" id="piki-next-rival" class="snes-btn px-2 py-0.5 rounded bg-emerald-700 text-xs font-bold text-white border border-emerald-400">▶</button>
                </div>
              </div>
            </div>

            <!-- 2P Score Box -->
            <div id="piki-2p-box" class="hidden bg-slate-950/70 rounded-xl p-2 border border-cyan-500/50 space-y-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-cyan-200 font-bold">👥 2P Match Score:</span>
                <span id="piki-2p-tally" class="pixel-font text-[10px] text-yellow-300">1P 0 - 0 2P</span>
              </div>
              <p class="text-[10px] text-sky-300">2P Keys (IJKL / Enter / R-Shift) or 2nd Gamepad active!</p>
            </div>

            <!-- Stage Clear Selector (Omote / Ura) -->
            <div id="piki-stageclear-box" class="hidden bg-slate-950/70 rounded-xl p-2 border border-emerald-500/40 space-y-1.5">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-emerald-200 font-bold">🎯 Cages Left:</span>
                <span id="piki-cages-left" class="pixel-font text-xs text-yellow-300">0</span>
              </div>
              <div class="flex items-center justify-between gap-1">
                <button type="button" id="piki-prev-stage" class="snes-btn px-2 py-0.5 rounded bg-sky-800 text-xs font-bold text-white border border-sky-400">◀ Stage</button>
                <span id="piki-stageclear-label" class="text-[10px] font-bold text-cyan-200">OMOTE 1/8</span>
                <button type="button" id="piki-next-stage" class="snes-btn px-2 py-0.5 rounded bg-emerald-700 text-xs font-bold text-white border border-emerald-400">Stage ▶</button>
              </div>
              <div id="piki-ura-badge" class="text-[10px] text-amber-300 text-center font-semibold"></div>
            </div>

            <!-- Puzzle & Stage Tsukuru Maker Box -->
            <div id="piki-puzzle-box" class="hidden bg-slate-950/75 rounded-xl p-2.5 border border-amber-400/50 space-y-2">
              <div class="flex gap-1">
                <button type="button" id="piki-tab-solve-puz" class="flex-1 snes-btn py-1 rounded-lg bg-amber-600 text-white text-[10px] font-bold border border-amber-300">🧩 Puzzles</button>
                <button type="button" id="piki-tab-maker" class="flex-1 snes-btn py-1 rounded-lg bg-slate-800 text-sky-200 text-[10px] font-bold border border-sky-500">✏️ Tsukuru Maker</button>
              </div>

              <div id="piki-puzzle-solve-controls" class="space-y-1.5">
                <p id="piki-puzzle-hint" class="text-[11px] text-amber-100 leading-snug"></p>
                <div class="flex items-center justify-between gap-1 text-xs">
                  <button type="button" id="piki-puz-undo" class="snes-btn px-2 py-1 rounded bg-amber-700 text-white text-[11px] font-bold border border-amber-300">↩ Undo</button>
                  <button type="button" id="piki-puz-prev" class="snes-btn px-2 py-1 rounded bg-sky-800 text-white text-[11px] font-bold border border-sky-400">◀</button>
                  <span id="piki-puz-num" class="pixel-font text-[10px] text-yellow-300">1/8</span>
                  <button type="button" id="piki-puz-next" class="snes-btn px-2 py-1 rounded bg-emerald-700 text-white text-[11px] font-bold border border-emerald-400">▶</button>
                </div>
              </div>

              <div id="piki-tsukuru-controls" class="hidden space-y-2">
                <div class="text-[10px] text-cyan-200 font-bold">Paint cells onto the board, then Play!</div>
                <div class="grid grid-cols-5 gap-1">
                  <button type="button" data-brush="1" class="piki-brush-btn snes-btn py-1 rounded bg-sky-700 text-[10px] font-bold text-white border border-sky-300" title="Ice">🧊</button>
                  <button type="button" data-brush="2" class="piki-brush-btn snes-btn py-1 rounded bg-blue-800 text-[10px] font-bold text-white border border-blue-400" title="Awake Pikiinya">🐧</button>
                  <button type="button" data-brush="3" class="piki-brush-btn snes-btn py-1 rounded bg-cyan-800 text-[10px] font-bold text-white border border-cyan-400" title="Frozen Pikiinya">🥶</button>
                  <button type="button" data-brush="4" class="piki-brush-btn snes-btn py-1 rounded bg-rose-800 text-[10px] font-bold text-white border border-rose-400" title="Cage Target">🧱</button>
                  <button type="button" data-brush="0" class="piki-brush-btn snes-btn py-1 rounded bg-slate-800 text-[10px] font-bold text-white border border-slate-400" title="Eraser">⬜</button>
                </div>
                <div class="flex items-center justify-between gap-1 text-[10px]">
                  <button type="button" id="piki-maker-slot-0" class="piki-slot-btn snes-btn flex-1 py-1 rounded bg-sky-800 border border-sky-400 font-bold">Slot 1</button>
                  <button type="button" id="piki-maker-slot-1" class="piki-slot-btn snes-btn flex-1 py-1 rounded bg-slate-800 border border-slate-500 font-bold">Slot 2</button>
                  <button type="button" id="piki-maker-slot-2" class="piki-slot-btn snes-btn flex-1 py-1 rounded bg-slate-800 border border-slate-500 font-bold">Slot 3</button>
                </div>
                <div class="flex gap-1">
                  <button type="button" id="piki-maker-clear" class="snes-btn px-2 py-1 rounded bg-rose-700 text-white text-[10px] font-bold border border-rose-300">🗑 Clear</button>
                  <button type="button" id="piki-maker-save" class="snes-btn px-2 py-1 rounded bg-indigo-700 text-white text-[10px] font-bold border border-indigo-300">💾 Save</button>
                  <button type="button" id="piki-maker-play" class="snes-btn flex-1 py-1 rounded bg-emerald-600 text-white text-[10px] font-bold border border-emerald-300">▶ Test Play</button>
                </div>
              </div>
            </div>

            <!-- Tutorial Lecture Box -->
            <div id="piki-tutorial-box" class="hidden bg-slate-950/75 rounded-xl p-2.5 border border-cyan-400/50 space-y-2">
              <div id="piki-tut-instruction" class="text-[11px] text-sky-100 leading-snug"></div>
              <div id="piki-tut-goal" class="text-[10px] font-bold text-yellow-300 bg-sky-900/60 px-2 py-1 rounded"></div>
              <div class="flex items-center justify-between gap-1">
                <button type="button" id="piki-tut-prev" class="snes-btn px-2 py-1 rounded bg-sky-800 text-[11px] font-bold text-white border border-sky-400">◀ Prev</button>
                <span id="piki-tut-num" class="pixel-font text-[10px] text-cyan-200">1/4</span>
                <button type="button" id="piki-tut-next" class="snes-btn px-2 py-1 rounded bg-emerald-700 text-[11px] font-bold text-white border border-emerald-400">Next ▶</button>
              </div>
            </div>
          </div>

          <!-- Scoreboard & Speed -->
          <div class="piki-card rounded-2xl p-3 grid grid-cols-2 lg:grid-cols-1 gap-2">
            <div class="bg-slate-950/65 rounded-xl p-2 border border-sky-600/40 flex items-center justify-between">
              <span class="text-xs text-sky-300 font-semibold uppercase">Score</span>
              <span id="piki-hud-score" class="pixel-font text-xs sm:text-sm text-yellow-300">000000</span>
            </div>
            <div class="bg-slate-950/65 rounded-xl p-2 border border-sky-600/40 flex items-center justify-between">
              <span class="text-xs text-sky-300 font-semibold uppercase">Best</span>
              <span id="piki-hud-best" class="pixel-font text-xs sm:text-sm text-cyan-300">012000</span>
            </div>
            <div class="bg-slate-950/65 rounded-xl p-2 border border-sky-600/40 flex items-center justify-between">
              <span id="piki-hud-time-label" class="text-xs text-sky-300 font-semibold uppercase">Time</span>
              <span id="piki-hud-time" class="pixel-font text-xs text-emerald-300">00:00</span>
            </div>
            <div class="bg-slate-950/65 rounded-xl p-2 border border-sky-600/40 flex items-center justify-between">
              <span class="text-xs text-sky-300 font-semibold uppercase">Speed / Chain</span>
              <div class="flex items-center gap-1">
                <button type="button" id="piki-spd-down" class="snes-btn px-2 py-0.5 rounded bg-sky-800 text-xs font-bold border border-sky-400">-</button>
                <span id="piki-hud-speed" class="pixel-font text-[10px] text-white min-w-[34px] text-center">Lv.1</span>
                <button type="button" id="piki-spd-up" class="snes-btn px-2 py-0.5 rounded bg-emerald-700 text-xs font-bold border border-emerald-400">+</button>
                <span class="text-sky-600">|</span>
                <span id="piki-hud-maxchain" class="pixel-font text-[10px] text-pink-300">1x</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="piki-btn-pause" class="snes-btn py-2 rounded-xl bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs border border-sky-300">⏸ PAUSE</button>
            <button type="button" id="piki-btn-restart" class="snes-btn py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs border border-amber-300">🔄 RESTART</button>
          </div>
        </aside>

        <!-- Center Arena: 1P Canvas + Next + 2P/CPU Board -->
        <section class="flex flex-row flex-nowrap items-start justify-center gap-2 sm:gap-3 order-1 lg:order-2 shrink-0 max-w-full">

          <!-- 1P Frame -->
          <div id="piki-1p-frame" class="relative snes-frame rounded-2xl p-2 sm:p-2.5 flex flex-col items-center bg-[#091529]">
            <div class="w-full flex items-center justify-between px-1 pb-1.5 gap-2">
              <div class="flex items-center gap-1.5">
                <span class="pixel-font text-[10px] text-yellow-300">1P PIKIINYA</span>
                <button type="button" id="piki-board-dim-badge" title="Change Board Width in Setup" class="snes-btn text-[10px] px-1.5 py-0.5 rounded bg-sky-800 hover:bg-sky-700 text-cyan-200 border border-sky-400/70 font-bold">📏 ${this.configuredCols}×${PIKI_ROWS}</button>
                <span id="piki-p1-garbage-badge" class="hidden text-[10px] px-1.5 py-0.5 rounded bg-rose-700 text-white font-bold border border-rose-300 animate-pulse">🧊 0</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-sky-300 font-bold">NEXT</span>
                <canvas id="piki-next-canvas" width="52" height="52" class="rounded-lg border border-sky-400/70 bg-[#081529]"></canvas>
              </div>
            </div>

            <div class="relative rounded-xl overflow-hidden border-2 border-sky-400/70 shadow-2xl">
              <canvas id="piki-canvas" width="${PIKI_COLS * PIKI_TILE}" height="${PIKI_ROWS * PIKI_TILE}" tabindex="0" class="block bg-[#091933] touch-none cursor-pointer" style="max-height:min(65vh,504px);max-width:43vw;width:auto;height:auto;"></canvas>
              <div id="piki-crt-layer" class="crt-overlay absolute inset-0"></div>

              <!-- Overlay -->
              <div id="piki-overlay" class="hidden absolute inset-0 bg-[#081427]/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center z-20">
                <div id="piki-ov-icon" class="text-4xl mb-2">🐧</div>
                <h2 id="piki-ov-title" class="pixel-font text-sm sm:text-base text-yellow-300 mb-2">PAUSED</h2>
                <p id="piki-ov-sub" class="text-xs text-sky-100 mb-4 max-w-[200px] leading-relaxed"></p>
                <div class="bg-slate-900/90 border border-sky-500/60 rounded-xl p-2.5 w-full mb-4 text-xs space-y-1">
                  <div class="flex justify-between"><span class="text-sky-300">Score:</span><span id="piki-ov-score" class="pixel-font text-yellow-300">0</span></div>
                  <div class="flex justify-between"><span class="text-sky-300">Max Chain:</span><span id="piki-ov-chain" class="pixel-font text-pink-300">1x</span></div>
                  <div class="flex justify-between"><span class="text-sky-300">Rescued:</span><span id="piki-ov-rescued" class="pixel-font text-cyan-300">0</span></div>
                </div>
                <button type="button" id="piki-ov-primary" class="snes-btn w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-xs text-white border border-cyan-200 mb-2">▶ CONTINUE</button>
                <button type="button" id="piki-ov-secondary" class="snes-btn w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-sky-200 border border-sky-500">🔄 Restart Mode</button>
              </div>
            </div>

            <!-- Mobile / Touch On-Screen Controller -->
            <div class="w-full mt-2 flex items-center justify-between gap-2 sm:hidden px-1">
              <div class="flex items-center gap-1">
                <button type="button" id="piki-touch-left" class="snes-btn w-10 h-10 rounded-xl bg-slate-800 border border-sky-400 font-bold">◀</button>
                <button type="button" id="piki-touch-down" class="snes-btn w-10 h-10 rounded-xl bg-slate-800 border border-sky-400 font-bold">▼</button>
                <button type="button" id="piki-touch-right" class="snes-btn w-10 h-10 rounded-xl bg-slate-800 border border-sky-400 font-bold">▶</button>
              </div>
              <div class="flex items-center gap-1">
                <button type="button" id="piki-touch-ccw" class="snes-btn px-2.5 h-10 rounded-xl bg-indigo-700 border border-indigo-300 text-xs font-bold">⟲</button>
                <button type="button" id="piki-touch-cw" class="snes-btn px-2.5 h-10 rounded-xl bg-cyan-600 border border-cyan-200 text-xs font-bold">⟳</button>
                <button type="button" id="piki-touch-drop" class="snes-btn px-2.5 h-10 rounded-xl bg-amber-600 border border-amber-200 text-xs font-bold">⬇</button>
              </div>
            </div>
          </div>

          <!-- 2P / CPU Rival Frame -->
          <div id="piki-cpu-frame" class="relative snes-frame rounded-2xl p-2 sm:p-2.5 flex flex-col items-center bg-[#091529]">
            <div class="w-full flex items-center justify-between px-1 pb-1.5 gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-1">
                  <span id="piki-cpu-avatar" class="text-base">🦊</span>
                  <span id="piki-cpu-name" class="pixel-font text-[10px] text-rose-300 truncate">2P BONGO</span>
                </div>
                <span id="piki-p2-garbage-badge" class="hidden text-[10px] px-1.5 py-0.5 rounded bg-amber-700 text-white font-bold border border-amber-300">🧊 0</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-sky-300 font-bold">NEXT</span>
                <canvas id="piki-cpu-next-canvas" width="52" height="52" class="rounded-lg border border-sky-400/70 bg-[#081529]"></canvas>
              </div>
            </div>

            <div class="relative rounded-xl overflow-hidden border-2 border-rose-400/70 shadow-2xl">
              <canvas id="piki-cpu-canvas" width="${PIKI_COLS * PIKI_TILE}" height="${PIKI_ROWS * PIKI_TILE}" class="block bg-[#091933]" style="max-height:min(65vh,504px);max-width:43vw;width:auto;height:auto;"></canvas>
            </div>
            <div class="w-full mt-1.5 flex items-center justify-between px-1 text-[10px] text-sky-200">
              <span id="piki-cpu-role-tag">STAGE 1 CPU</span>
              <span id="piki-cpu-score" class="pixel-font text-yellow-300">0</span>
            </div>
          </div>
        </section>

        <!-- Right Sidebar: Controls & Live Log -->
        <aside class="w-full lg:w-56 xl:w-60 flex flex-col gap-2.5 order-3 shrink">
          <div class="piki-card rounded-2xl p-3 space-y-2 text-xs">
            <h3 class="pixel-font text-[10px] text-yellow-300 border-b border-sky-500/40 pb-1.5">PIKIINYA! RULES</h3>
            <ul class="space-y-1.5 text-sky-100 text-[11px] leading-snug">
              <li>🧊 <strong>Ice Row Clear:</strong> Fill all <strong id="piki-rule-cols-label">${this.configuredCols} columns</strong> with Ice or Frozen Pikiinyas to melt the row and wake frozen penguins!</li>
              <li>🐧 <strong>6+ Penguin Group:</strong> Link <strong>6 or more</strong> awake Pikiinyas orthogonally (any shape!) to rescue them and build chains!</li>
              <li>🧱 <strong>Break Cages:</strong> Clearing 6+ Pikiinyas shatters adjacent gray Poacher Cages.</li>
              <li>⭐ <strong>Miracle Bell:</strong> Every 100 pieces drops a Frozen Bell — thaw it to rescue all awake Pikiinyas!</li>
            </ul>
            <div class="bg-slate-950/70 rounded-xl p-2 border border-sky-500/40 text-[10px] text-sky-200 space-y-1">
              <div class="font-bold text-cyan-300">🎮 Controls (1P / Gamepad):</div>
              <div>• <strong>← / →</strong>: Move 2×2</div>
              <div>• <strong>Space / Z / A,B</strong>: Rotate CW ⟳</div>
              <div>• <strong>Shift / X / X,Y,L,R</strong>: Rotate CCW ⟲</div>
              <div>• <strong>↓ / ↑</strong>: Soft Drop / Hard Drop</div>
            </div>
          </div>

          <div class="piki-card rounded-2xl p-3 flex-1 flex flex-col min-h-[150px]">
            <div class="text-xs font-bold text-cyan-200 uppercase mb-1.5">❄️ Andes Log</div>
            <div id="piki-log" class="flex-1 overflow-y-auto space-y-1 text-[11px] text-sky-200 max-h-48 pr-1">
              <div class="text-sky-300">Ready! Welcome to Pikiinya!</div>
            </div>
          </div>
        </aside>
      </main>

      <!-- Pikiinya Dedicated Setup Page -->
      <section id="piki-setup-page" aria-label="Pikiinya Board Setup" class="hidden w-full max-w-4xl flex-1 my-auto">
        <div class="piki-card rounded-2xl p-4 sm:p-6 space-y-5 border-2 border-cyan-300/70 shadow-2xl">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/40 pb-3">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl">🛠️</span>
              <div>
                <h2 class="pixel-font text-xs sm:text-sm text-yellow-300">PÁLYA &amp; JÁTÉK SETUP</h2>
                <p class="text-xs text-sky-200 mt-0.5">Állítsd be a pálya szélességét (6–12 oszlop), a kezdő sebességet és a megjelenítést!</p>
              </div>
            </div>
            <button type="button" id="piki-setup-close" class="snes-btn px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-100 border border-sky-400 text-xs font-bold">✕ Vissza a játékhoz</button>
          </div>

          <!-- Board Width Slider & Presets -->
          <div class="bg-slate-950/70 rounded-2xl p-4 border border-sky-500/40 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label for="piki-setup-cols-slider" class="text-sm font-bold text-cyan-200 flex items-center gap-2">
                <span>📏 Pályaszélesség (Oszlopok száma):</span>
              </label>
              <span id="piki-setup-cols-readout" class="pixel-font text-xs px-3 py-1 rounded-lg bg-sky-900 text-yellow-300 border border-cyan-300/70">${this.configuredCols} OSZLOP × ${PIKI_ROWS} SOR</span>
            </div>

            <input
              type="range"
              id="piki-setup-cols-slider"
              class="piki-range-slider w-full"
              min="${MIN_PIKI_COLS}"
              max="${MAX_PIKI_COLS}"
              step="1"
              value="${this.configuredCols}"
            />

            <div class="flex justify-between text-[10px] text-sky-300 px-1 font-mono">
              <span>6 (SNES)</span>
              <span>7</span>
              <span>8 (Széles)</span>
              <span>9</span>
              <span>10 (XL)</span>
              <span>11</span>
              <span>12 (Óriás)</span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button type="button" data-cols-preset="6" class="piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border">SNES Eredeti (6×14)</button>
              <button type="button" data-cols-preset="8" class="piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border">Széles / Wide (8×14)</button>
              <button type="button" data-cols-preset="10" class="piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border">Arcade XL (10×14)</button>
              <button type="button" data-cols-preset="12" class="piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border">Óriás / Giant (12×14)</button>
            </div>

            <p id="piki-setup-cols-note" class="text-xs text-sky-200/90 leading-relaxed">
              Egy teljes jég-sor töréséhez mind a(z) <strong class="text-yellow-300">${this.configuredCols} oszlopot</strong> ki kell tölteni jéggel vagy jeges pingvinekkel — a 2×2-es blokkok középen jelennek meg, és a CPU is teljes szélességben gondolkodik!
            </p>
          </div>

          <!-- Gameplay Toggles -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="bg-slate-950/70 rounded-xl p-3 border border-sky-500/40 flex flex-col justify-between gap-2">
              <div class="text-xs font-bold text-cyan-200">⚡ Kezdő Sebesség (Speed)</div>
              <div class="flex items-center justify-between gap-2">
                <button type="button" id="piki-setup-spd-down" class="snes-btn px-3 py-1.5 rounded-lg bg-sky-800 text-sm font-bold border border-sky-400">◀</button>
                <span id="piki-setup-spd-label" class="pixel-font text-xs text-yellow-300">Lv.${this.baseLevel}</span>
                <button type="button" id="piki-setup-spd-up" class="snes-btn px-3 py-1.5 rounded-lg bg-emerald-700 text-sm font-bold border border-emerald-400">▶</button>
              </div>
              <p class="text-[11px] text-sky-300">Magasabb szinten gyorsabban esnek a 2×2 blokkok.</p>
            </div>

            <div class="bg-slate-950/70 rounded-xl p-3 border border-sky-500/40 flex flex-col justify-between gap-2">
              <div class="text-xs font-bold text-cyan-200">👻 Ghost Árnyék-keret</div>
              <button type="button" id="piki-setup-ghost-btn" class="snes-btn w-full py-2 rounded-lg text-xs font-bold border">✓ BEKAPCSOLVA</button>
              <p class="text-[11px] text-sky-300">Mutatja lent, hova fog esni a 2×2-es egység.</p>
            </div>

            <div class="bg-slate-950/70 rounded-xl p-3 border border-sky-500/40 flex flex-col justify-between gap-2">
              <div class="text-xs font-bold text-cyan-200">🧩 Fix 6 oszlop Feladványnál</div>
              <button type="button" id="piki-setup-lockpuz-btn" class="snes-btn w-full py-2 rounded-lg text-xs font-bold border">✓ 6 OSZLOP (Eredeti)</button>
              <p class="text-[11px] text-sky-300">Ha kikapcsolod, a Puzzle / Lecture sorokat jéggel egészíti ki a választott szélességre.</p>
            </div>
          </div>

          <!-- Live Contrast & Width Preview -->
          <div class="bg-slate-950/75 rounded-2xl p-4 border border-sky-500/40 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-bold text-cyan-200">🐧 Élő Jég / Pingvin Kontraszt &amp; Szélesség Előnézet</span>
              <span class="text-[11px] text-sky-300">Sima jég vs. nagy kontrasztú jeges pingvin • élő előnézet</span>
            </div>
            <canvas id="piki-setup-preview-canvas" width="560" height="148" class="w-full max-w-[560px] h-auto rounded-xl border-2 border-sky-400/60 bg-[#091933] mx-auto block"></canvas>
          </div>

          <!-- Action Footer -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button type="button" id="piki-setup-reset" class="snes-btn px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-200 border border-sky-500 text-xs font-bold">🔄 Alapértelmezett (6 oszlop)</button>
            <button type="button" id="piki-setup-apply" class="snes-btn px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white border border-emerald-200 text-xs sm:text-sm font-bold shadow-lg">✅ Mentés és Játék Indítása</button>
          </div>
        </div>
      </section>

      <!-- Pikiinya Help Modal -->
      <div id="piki-help-modal" class="hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="snes-frame rounded-2xl max-w-lg w-full p-5 bg-[#0a1b34] text-white space-y-4 max-h-[90vh] overflow-y-auto border-2 border-cyan-400">
          <div class="flex items-center justify-between border-b border-sky-600 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-2xl">🐧</span>
              <h2 class="pixel-font text-xs sm:text-sm text-yellow-300">HOW TO PLAY PIKIINYA!</h2>
            </div>
            <button type="button" id="piki-help-close" class="w-8 h-8 rounded-lg bg-rose-600 text-white font-bold">✕</button>
          </div>
          <div class="space-y-3 text-xs text-sky-100 leading-relaxed">
            <p>Released in 1997 for Super Famicom by <strong>ASCII / Crea-Tech</strong> (designed by Tamakichi Sakura), <strong>Pikiinya!</strong> is a 2×2 rotation puzzle where you liberate sleeping &amp; frozen penguins across a 6×14 glacier board.</p>
            <div class="bg-slate-950/75 p-3 rounded-xl border border-sky-500/40 space-y-1.5">
              <div class="font-bold text-cyan-300">Core Mechanics:</div>
              <div>1. <strong>Complete Ice Rows:</strong> Fill all 6 columns of a row with Ice (🧊) or Frozen Pikiinyas (🥶). The ice shatters and <strong>thaws frozen penguins awake!</strong></div>
              <div>2. <strong>Connect 6+ Pikiinyas:</strong> Connect at least 6 awake Pikiinyas orthogonally to clear them! Triggering a thaw into a 6-penguin cluster chains into huge <strong>2x–10x Cascades!</strong></div>
              <div>3. <strong>All Game Modes Included:</strong> Andes Story VS CPU (8 rivals ending in Dr. Slagger), 2P Battle, Stage Clear (Omote &amp; Ura), Endless, Endurance Race, 2-Min Time Attack, Brain-Teaser Puzzles, Stage Tsukuru Maker, and Guided Lecture!</div>
            </div>
          </div>
          <button type="button" id="piki-help-ok" class="snes-btn w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-sm text-white">Let's Go!</button>
        </div>
      </div>
    `;

    this.p1Canvas = this.root.querySelector('#piki-canvas') as HTMLCanvasElement;
    this.p1Ctx = this.p1Canvas.getContext('2d')!;
    this.p1NextCanvas = this.root.querySelector('#piki-next-canvas') as HTMLCanvasElement;
    this.p1NextCtx = this.p1NextCanvas.getContext('2d')!;

    this.p2Canvas = this.root.querySelector('#piki-cpu-canvas') as HTMLCanvasElement;
    this.p2Ctx = this.p2Canvas.getContext('2d')!;
    this.p2NextCanvas = this.root.querySelector('#piki-cpu-next-canvas') as HTMLCanvasElement;
    this.p2NextCtx = this.p2NextCanvas.getContext('2d')!;

    this.raceCanvas = this.root.querySelector('#piki-race-canvas') as HTMLCanvasElement;
    this.raceCtx = this.raceCanvas.getContext('2d')!;

    this.setupPreviewCanvas = this.root.querySelector('#piki-setup-preview-canvas') as HTMLCanvasElement;
    this.setupPreviewCtx = this.setupPreviewCanvas.getContext('2d')!;
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.root.querySelector(`#${id}`) as T;
  }

  private bindDOMEvents(): void {
    // Mode buttons
    this.root.querySelectorAll<HTMLButtonElement>('.piki-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.pikiMode as PikiMode;
        if (nextMode) this.switchMode(nextMode);
      });
    });

    // Utility buttons
    this.el('piki-btn-setup').addEventListener('click', () => this.toggleSetupPage(!this.setupPageOpen));
    this.el('piki-board-dim-badge').addEventListener('click', () => this.toggleSetupPage(true));
    this.el('piki-setup-close').addEventListener('click', () => this.toggleSetupPage(false));
    this.el('piki-setup-apply').addEventListener('click', () => this.applySetupAndRestart());
    this.el('piki-setup-reset').addEventListener('click', () => {
      this.configuredCols = PIKI_COLS;
      this.showGhostPiece = true;
      this.lockScriptedModesTo6Cols = true;
      this.bridge.audio.playMove();
      this.syncSetupUI();
      this.renderSetupPreview(performance.now() / 1000);
    });
    const colsSlider = this.el<HTMLInputElement>('piki-setup-cols-slider');
    colsSlider.addEventListener('input', () => {
      this.configuredCols = clampPikiCols(Number(colsSlider.value));
      this.bridge.audio.playMove();
      this.syncSetupUI();
      this.renderSetupPreview(performance.now() / 1000);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.piki-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.configuredCols = clampPikiCols(Number(btn.dataset.colsPreset ?? PIKI_COLS));
        this.bridge.audio.playMove();
        this.syncSetupUI();
        this.renderSetupPreview(performance.now() / 1000);
      });
    });
    this.el('piki-setup-spd-down').addEventListener('click', () => {
      this.changeLevel(-1);
      this.syncSetupUI();
    });
    this.el('piki-setup-spd-up').addEventListener('click', () => {
      this.changeLevel(1);
      this.syncSetupUI();
    });
    this.el('piki-setup-ghost-btn').addEventListener('click', () => {
      this.showGhostPiece = !this.showGhostPiece;
      this.bridge.audio.playMove();
      this.syncSetupUI();
    });
    this.el('piki-setup-lockpuz-btn').addEventListener('click', () => {
      this.lockScriptedModesTo6Cols = !this.lockScriptedModesTo6Cols;
      this.bridge.audio.playMove();
      this.syncSetupUI();
    });

    this.el('piki-btn-rom').addEventListener('click', () => this.bridge.openRomModal());
    this.el('piki-btn-settings').addEventListener('click', () => this.bridge.openSettingsModal());
    this.el('piki-btn-ost').addEventListener('click', () => {
      this.bridge.audio.unlock();
      this.bridge.openOstModal?.();
    });
    this.el('piki-btn-bgm').addEventListener('click', () => {
      this.bridge.toggleMusic();
      this.syncAudioButtons();
    });
    this.el('piki-btn-sfx').addEventListener('click', () => {
      this.bridge.toggleSound();
      this.syncAudioButtons();
    });
    this.el('piki-btn-crt').addEventListener('click', () => {
      this.bridge.toggleCRT();
      this.syncAudioButtons();
    });
    this.el('piki-btn-help').addEventListener('click', () => this.toggleHelp(true));
    this.el('piki-help-close').addEventListener('click', () => this.toggleHelp(false));
    this.el('piki-help-ok').addEventListener('click', () => this.toggleHelp(false));

    // Rival / Stage / Speed / Pause
    this.el('piki-prev-rival').addEventListener('click', () => this.changeStoryStage(-1));
    this.el('piki-next-rival').addEventListener('click', () => this.changeStoryStage(1));
    this.el('piki-prev-stage').addEventListener('click', () => this.changeStageClear(-1));
    this.el('piki-next-stage').addEventListener('click', () => this.changeStageClear(1));
    this.el('piki-spd-down').addEventListener('click', () => this.changeLevel(-1));
    this.el('piki-spd-up').addEventListener('click', () => this.changeLevel(1));
    this.el('piki-btn-pause').addEventListener('click', () => this.togglePause());
    this.el('piki-btn-restart').addEventListener('click', () => this.restartCurrentMode());
    this.el('piki-ov-primary').addEventListener('click', () => this.handleOverlayPrimary());
    this.el('piki-ov-secondary').addEventListener('click', () => this.restartCurrentMode());

    // Puzzle & Tsukuru Maker controls
    this.el('piki-tab-solve-puz').addEventListener('click', () => this.setTsukuruMode(false));
    this.el('piki-tab-maker').addEventListener('click', () => this.setTsukuruMode(true));
    this.el('piki-puz-undo').addEventListener('click', () => this.undoPuzzleMove());
    this.el('piki-puz-prev').addEventListener('click', () => this.changePuzzle(-1));
    this.el('piki-puz-next').addEventListener('click', () => this.changePuzzle(1));

    this.root.querySelectorAll<HTMLButtonElement>('.piki-brush-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tsukuruBrush = Number(btn.dataset.brush ?? '1') as CellType;
        this.updateTsukuruUI();
      });
    });
    for (let s = 0; s < 3; s++) {
      this.el(`piki-maker-slot-${s}`).addEventListener('click', () => this.selectTsukuruSlot(s));
    }
    this.el('piki-maker-clear').addEventListener('click', () => {
      const cols = this.configuredCols;
      this.tsukuruGrid = Array.from({ length: PIKI_ROWS }, () => new Array<number>(cols).fill(0));
      this.loadTsukuruGridIntoBoard();
      this.log('🧹 Cleared Stage Tsukuru grid!');
    });
    this.el('piki-maker-save').addEventListener('click', () => {
      safeSave(`piki_tsukuru_slot_${this.tsukuruSlot}`, JSON.stringify(this.tsukuruGrid));
      this.bridge.audio.playRotate();
      this.log(`💾 Saved custom stage to Slot ${this.tsukuruSlot + 1}!`);
    });
    this.el('piki-maker-play').addEventListener('click', () => this.testPlayTsukuruStage());

    // Tutorial navigation
    this.el('piki-tut-prev').addEventListener('click', () => this.changeTutorial(-1));
    this.el('piki-tut-next').addEventListener('click', () => this.changeTutorial(1));

    // Mobile Touch D-Pad
    this.el('piki-touch-left').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P() && moveQuadX(this.board, -1)) this.bridge.audio.playMove();
    });
    this.el('piki-touch-right').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P() && moveQuadX(this.board, 1)) this.bridge.audio.playMove();
    });
    this.el('piki-touch-down').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P()) {
        stepBoard(this.board, 0.2, this.getFallSpeed(), { softDropping: true });
      }
    });
    this.el('piki-touch-cw').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P() && rotateQuad(this.board, 1)) this.bridge.audio.playRotate();
    });
    this.el('piki-touch-ccw').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P() && rotateQuad(this.board, -1)) this.bridge.audio.playRotate();
    });
    this.el('piki-touch-drop').addEventListener('click', () => {
      this.bridge.audio.unlock();
      if (this.canControl1P()) {
        hardDropQuad(this.board);
        this.bridge.audio.playSwap();
      }
    });

    // Pointer drag/tap & Stage Tsukuru editor painting on 1P canvas
    this.p1Canvas.addEventListener('pointerdown', (e) => {
      this.bridge.audio.unlock();
      this.p1Canvas.focus();
      if (this.mode === 'puzzle' && this.tsukuruActive && this.tsukuruEditing) {
        this.pointerDrag = {
          startX: e.clientX,
          startY: e.clientY,
          lastStepX: e.clientX,
          moved: true,
          painting: true,
        };
        this.paintTsukuruAtPointer(e);
        return;
      }
      if (!this.canControl1P()) return;
      this.pointerDrag = {
        startX: e.clientX,
        startY: e.clientY,
        lastStepX: e.clientX,
        moved: false,
        painting: false,
      };
    });

    this.p1Canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDrag) return;
      if (this.pointerDrag.painting) {
        this.paintTsukuruAtPointer(e);
        return;
      }
      if (!this.canControl1P()) return;
      const rect = this.p1Canvas.getBoundingClientRect();
      const colStepPx = (rect.width / (this.board.cols || PIKI_COLS)) * 0.85;
      const dx = e.clientX - this.pointerDrag.lastStepX;
      if (Math.abs(dx) >= colStepPx) {
        const dir = dx > 0 ? 1 : -1;
        if (moveQuadX(this.board, dir)) this.bridge.audio.playMove();
        this.pointerDrag.lastStepX = e.clientX;
        this.pointerDrag.moved = true;
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.pointerDrag) return;
      const drag = this.pointerDrag;
      this.pointerDrag = null;
      if (drag.painting || !this.active || !this.canControl1P()) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && dy > 44) {
        hardDropQuad(this.board);
        this.bridge.audio.playSwap();
      } else if (!drag.moved) {
        if (rotateQuad(this.board, 1)) this.bridge.audio.playRotate();
      }
    });

    // Global Keyboard Listeners (only act when Pikiinya is the active tab!)
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.heldKeys.delete(e.code);
    });
  }

  private paintTsukuruAtPointer(e: PointerEvent): void {
    const rect = this.p1Canvas.getBoundingClientRect();
    const cols = this.board.cols || this.configuredCols;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * PIKI_ROWS);
    if (col < 0 || col >= cols || row < PIKI_SPAWN_ROWS || row >= PIKI_ROWS) return;
    if (this.tsukuruGrid[row][col] !== this.tsukuruBrush) {
      this.tsukuruGrid[row][col] = this.tsukuruBrush;
      this.board.grid[row][col] = this.tsukuruBrush === CELL.EMPTY ? createEmptyCell() : createCell(this.tsukuruBrush);
      updatePikiGroupSizes(this.board.grid);
      this.renderAll();
    }
  }

  private selectTsukuruSlot(slot: number): void {
    this.tsukuruSlot = slot;
    try {
      const saved = localStorage.getItem(`piki_tsukuru_slot_${slot}`);
      if (saved) {
        const parsed = JSON.parse(saved) as number[][];
        if (Array.isArray(parsed) && parsed.length === PIKI_ROWS) {
          this.tsukuruGrid = resizeMatrixCols(parsed, this.configuredCols);
        } else {
          this.tsukuruGrid = createTsukuruBlankGrid(this.configuredCols);
        }
      } else {
        this.tsukuruGrid = createTsukuruBlankGrid(this.configuredCols);
      }
    } catch {
      this.tsukuruGrid = createTsukuruBlankGrid(this.configuredCols);
    }
    this.loadTsukuruGridIntoBoard();
    this.updateTsukuruUI();
    this.log(`📂 Loaded Stage Tsukuru Slot ${slot + 1}.`);
  }

  private loadTsukuruGridIntoBoard(): void {
    this.tsukuruGrid = resizeMatrixCols(this.tsukuruGrid, this.configuredCols);
    this.syncCanvasDimensions(this.configuredCols, false);
    this.board = createBoardState(this.nextSeed(), {
      cols: this.configuredCols,
      initialGrid: this.tsukuruGrid,
      allowTargetInRandom: false,
      allowMiracleItem: true,
    });
    this.renderAll();
  }

  private setTsukuruMode(enabled: boolean): void {
    this.tsukuruActive = enabled;
    this.tsukuruEditing = enabled;
    if (enabled) {
      this.selectTsukuruSlot(this.tsukuruSlot);
    } else {
      this.initModeBoard();
    }
    this.updateTsukuruUI();
  }

  private testPlayTsukuruStage(): void {
    this.tsukuruEditing = false;
    this.roundOver = false;
    this.victory = false;
    this.stageClearPending = false;
    this.paused = false;
    this.hideOverlay();
    this.loadTsukuruGridIntoBoard();
    this.updateTsukuruUI();
    this.log('▶ Playing your custom Tsukuru Stage!');
  }

  private updateTsukuruUI(): void {
    const solveBtn = this.el('piki-tab-solve-puz');
    const makerBtn = this.el('piki-tab-maker');
    solveBtn.className = !this.tsukuruActive
      ? 'flex-1 snes-btn py-1 rounded-lg bg-amber-600 text-white text-[10px] font-bold border border-amber-300'
      : 'flex-1 snes-btn py-1 rounded-lg bg-slate-800 text-sky-200 text-[10px] font-bold border border-sky-500';
    makerBtn.className = this.tsukuruActive
      ? 'flex-1 snes-btn py-1 rounded-lg bg-amber-600 text-white text-[10px] font-bold border border-amber-300'
      : 'flex-1 snes-btn py-1 rounded-lg bg-slate-800 text-sky-200 text-[10px] font-bold border border-sky-500';

    this.el('piki-puzzle-solve-controls').classList.toggle('hidden', this.tsukuruActive);
    this.el('piki-tsukuru-controls').classList.toggle('hidden', !this.tsukuruActive);

    this.root.querySelectorAll<HTMLButtonElement>('.piki-brush-btn').forEach((b) => {
      const activeBrush = Number(b.dataset.brush) === this.tsukuruBrush;
      b.classList.toggle('ring-2', activeBrush);
      b.classList.toggle('ring-yellow-300', activeBrush);
    });
    for (let s = 0; s < 3; s++) {
      const btn = this.el(`piki-maker-slot-${s}`);
      btn.className =
        s === this.tsukuruSlot
          ? 'piki-slot-btn snes-btn flex-1 py-1 rounded bg-sky-700 border border-yellow-300 font-bold text-white'
          : 'piki-slot-btn snes-btn flex-1 py-1 rounded bg-slate-800 border border-slate-500 font-bold text-sky-200';
    }
  }

  private syncAudioButtons(): void {
    this.el('piki-btn-bgm').classList.toggle('opacity-40', !this.bridge.audio.bgmEnabled);
    this.el('piki-btn-sfx').classList.toggle('opacity-40', !this.bridge.audio.sfxEnabled);
    const crt = document.getElementById('crt-layer');
    if (crt) {
      const hidden = crt.classList.contains('hidden');
      this.el('piki-btn-crt').classList.toggle('opacity-40', hidden);
      const pikiCrt = document.getElementById('piki-crt-layer');
      if (pikiCrt) pikiCrt.classList.toggle('hidden', hidden);
    }
  }

  private canControl1P(): boolean {
    if (this.paused || this.roundOver || this.victory || this.stageClearPending) return false;
    if (this.mode === 'puzzle' && this.tsukuruActive && this.tsukuruEditing) return false;
    return this.board.phase === 'falling' && !this.board.toppedOut;
  }

  private canControl2P(): boolean {
    if (this.mode !== 'vs2p') return false;
    if (this.paused || this.roundOver || this.victory || this.stageClearPending) return false;
    return this.p2Board.phase === 'falling' && !this.p2Board.toppedOut;
  }

  private getEffectiveColsForCurrentMode(): number {
    const isScriptedFixed = (this.mode === 'puzzle' && !this.tsukuruActive) || this.mode === 'tutorial';
    if (isScriptedFixed && this.lockScriptedModesTo6Cols) {
      return PIKI_COLS;
    }
    return this.configuredCols;
  }

  private syncCanvasDimensions(cols: number, isDual: boolean): void {
    const safeCols = clampPikiCols(cols);
    const widthPx = safeCols * PIKI_TILE;
    const heightPx = PIKI_ROWS * PIKI_TILE;
    const aspect = `${safeCols} / ${PIKI_ROWS}`;
    const maxW = isDual ? 'min(42vw, 432px)' : 'min(86vw, 468px)';

    if (this.p1Canvas.width !== widthPx) this.p1Canvas.width = widthPx;
    if (this.p1Canvas.height !== heightPx) this.p1Canvas.height = heightPx;
    this.p1Canvas.style.aspectRatio = aspect;
    this.p1Canvas.style.maxWidth = maxW;

    if (this.p2Canvas.width !== widthPx) this.p2Canvas.width = widthPx;
    if (this.p2Canvas.height !== heightPx) this.p2Canvas.height = heightPx;
    this.p2Canvas.style.aspectRatio = aspect;
    this.p2Canvas.style.maxWidth = 'min(42vw, 432px)';

    this.el('piki-board-dim-badge').textContent = `📏 ${safeCols}×${PIKI_ROWS}`;
    this.el('piki-rule-cols-label').textContent = `${safeCols} columns`;
  }

  private syncSetupUI(): void {
    const cols = this.configuredCols;
    const slider = this.el<HTMLInputElement>('piki-setup-cols-slider');
    slider.value = String(cols);
    slider.style.setProperty('--attr-min', String(MIN_PIKI_COLS));
    slider.style.setProperty('--attr-max', String(MAX_PIKI_COLS));
    slider.style.setProperty('--control-value', String(cols));
    slider.setAttribute('aria-valuetext', `${cols} oszlop (${cols}×${PIKI_ROWS} pálya)`);

    this.el('piki-setup-cols-readout').textContent = `${cols} OSZLOP × ${PIKI_ROWS} SOR`;
    this.el('piki-setup-cols-note').innerHTML =
      `Egy teljes jég-sor töréséhez mind a(z) <strong class="text-yellow-300">${cols} oszlopot</strong> ki kell tölteni jéggel vagy jeges pingvinekkel — a 2×2-es blokkok középen jelennek meg, és a CPU is teljes szélességben gondolkodik!`;
    this.el('piki-setup-spd-label').textContent = `Lv.${this.baseLevel}`;

    this.root.querySelectorAll<HTMLButtonElement>('.piki-preset-btn').forEach((btn) => {
      const pCols = Number(btn.dataset.colsPreset ?? PIKI_COLS);
      const isSelected = pCols === cols;
      const baseText =
        pCols === 6
          ? 'SNES Eredeti (6×14)'
          : pCols === 8
            ? 'Széles / Wide (8×14)'
            : pCols === 10
              ? 'Arcade XL (10×14)'
              : 'Óriás / Giant (12×14)';
      btn.textContent = isSelected ? `✓ ${baseText}` : baseText;
      btn.className = isSelected
        ? 'piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border bg-cyan-600 text-white border-yellow-300 ring-2 ring-yellow-300/70'
        : 'piki-preset-btn snes-btn px-2.5 py-2 rounded-xl text-xs font-bold border bg-sky-950 text-sky-200 border-sky-600 hover:bg-sky-900';
    });

    const ghostBtn = this.el('piki-setup-ghost-btn');
    ghostBtn.textContent = this.showGhostPiece ? '✓ BEKAPCSOLVA' : '✕ KIKAPCSOLVA';
    ghostBtn.className = this.showGhostPiece
      ? 'snes-btn w-full py-2 rounded-lg text-xs font-bold border bg-emerald-700 text-white border-emerald-300'
      : 'snes-btn w-full py-2 rounded-lg text-xs font-bold border bg-slate-800 text-slate-300 border-slate-500';

    const lockBtn = this.el('piki-setup-lockpuz-btn');
    lockBtn.textContent = this.lockScriptedModesTo6Cols
      ? '✓ 6 OSZLOP (Eredeti)'
      : '↔ SZÉLESÍTETT (Jég-kitöltéssel)';
    lockBtn.className = this.lockScriptedModesTo6Cols
      ? 'snes-btn w-full py-2 rounded-lg text-xs font-bold border bg-cyan-700 text-white border-cyan-300'
      : 'snes-btn w-full py-2 rounded-lg text-xs font-bold border bg-amber-700 text-white border-amber-300';

    const setupBtn = this.el('piki-btn-setup');
    setupBtn.textContent = this.setupPageOpen ? '✓ SETUP' : '🛠️ SETUP';
    setupBtn.classList.toggle('ring-2', this.setupPageOpen);
    setupBtn.classList.toggle('ring-yellow-300', this.setupPageOpen);
  }

  private renderSetupPreview(time: number): void {
    const ctx = this.setupPreviewCtx;
    const w = this.setupPreviewCanvas.width;
    const h = this.setupPreviewCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#07152b');
    bg.addColorStop(1, '#103158');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Top half: high-contrast tile showcase (ICE vs FROZEN_PIKI vs PIKI vs TARGET)
    const sampleSize = 40;
    const samples: readonly { type: CellType; label: string }[] = [
      { type: CELL.ICE, label: 'Sima Jég' },
      { type: CELL.FROZEN_PIKI, label: 'Jeges Pingvin' },
      { type: CELL.PIKI, label: 'Éber Pingvin' },
      { type: CELL.TARGET, label: 'Ketrec' },
    ];
    const groupW = 128;
    const leftPad = 24;
    for (let i = 0; i < samples.length; i++) {
      const sx = leftPad + i * groupW + Math.floor((groupW - sampleSize) * 0.5);
      const sy = 10;
      drawPikiCell(ctx, samples[i].type, sx, sy, sampleSize, time, {
        groupSize: 3,
        seedOffset: i * 0.8,
      });
      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(samples[i].label, leftPad + i * groupW + groupW * 0.5, sy + sampleSize + 15);
    }

    // Bottom half: live N-column glacier row preview
    const cols = this.configuredCols;
    const tile = Math.min(34, Math.floor((w - 48) / cols));
    const rowW = cols * tile;
    const ox = Math.floor((w - rowW) * 0.5);
    const oy = 86;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(ox - 6, oy - 6, rowW + 12, tile + 12);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - 6, oy - 6, rowW + 12, tile + 12);

    for (let c = 0; c < cols; c++) {
      const cellType: CellType =
        c === 1 || c === cols - 2
          ? CELL.FROZEN_PIKI
          : c === Math.floor(cols / 2)
            ? CELL.FROZEN_PIKI
            : CELL.ICE;
      drawPikiCell(ctx, cellType, ox + c * tile, oy, tile, time, {
        groupSize: 1,
        seedOffset: c * 0.6,
      });
    }

    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Teljes jég-sor előnézet: ${cols} oszlop (${cols}×${PIKI_ROWS})`,
      w * 0.5,
      h - 8
    );
  }

  private toggleSetupPage(open: boolean): void {
    this.bridge.audio.unlock();
    this.setupPageOpen = open;
    this.el('piki-setup-page').classList.toggle('hidden', !open);
    this.el('piki-arena-main').classList.toggle('hidden', open);
    this.el('piki-race-strip').classList.toggle('hidden', open || this.mode !== 'endurance');
    this.syncSetupUI();
    this.syncBgmState();
    if (open) {
      this.renderSetupPreview(performance.now() / 1000);
    } else {
      this.renderAll();
      try {
        this.p1Canvas.focus();
      } catch {
        // ignore focus restriction
      }
    }
  }

  private applySetupAndRestart(): void {
    safeSave('piki_board_cols', String(this.configuredCols));
    safeSave('piki_show_ghost', this.showGhostPiece ? '1' : '0');
    safeSave('piki_lock_puzzle_cols', this.lockScriptedModesTo6Cols ? '1' : '0');
    this.tsukuruGrid = resizeMatrixCols(this.tsukuruGrid, this.configuredCols);
    this.bridge.audio.playSwap();
    this.toggleSetupPage(false);
    this.initModeBoard();
    this.log(`🛠️ Board width set to <strong>${this.configuredCols}×${PIKI_ROWS}</strong>!`);
  }

  public switchMode(nextMode: PikiMode): void {
    this.bridge.audio.unlock();
    if (this.setupPageOpen) {
      this.toggleSetupPage(false);
    }
    this.mode = nextMode;
    this.tsukuruActive = false;
    this.tsukuruEditing = false;
    if (nextMode === 'story') {
      this.storyStreak = 0;
    }
    this.initModeBoard();
  }

  private restartCurrentMode(): void {
    this.bridge.audio.unlock();
    if (this.mode === 'puzzle' && this.tsukuruActive) {
      this.testPlayTsukuruStage();
      return;
    }
    this.initModeBoard();
  }

  private initModeBoard(): void {
    this.paused = false;
    this.roundOver = false;
    this.victory = false;
    this.stageClearPending = false;
    this.elapsedSec = 0;
    this.timeRemainingSec = 120;
    this.puzzleHistory = [];
    this.tutorialSolvedHold = 0;
    this.raceDistanceM = 0;
    this.raceSpeedKmh = 18;
    this.raceLap = 1;
    this.hideOverlay();

    // Update mode pills
    this.root.querySelectorAll<HTMLButtonElement>('.piki-mode-btn').forEach((btn) => {
      const isSelected = btn.dataset.pikiMode === this.mode;
      btn.className = isSelected
        ? 'piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold bg-cyan-600 text-white border border-cyan-200'
        : 'piki-mode-btn snes-btn px-2 py-1 rounded-xl text-[11px] font-bold bg-sky-900/80 text-sky-200 border border-sky-600';
    });

    const isDual = this.mode === 'story' || this.mode === 'vs2p';
    const cols = this.getEffectiveColsForCurrentMode();
    this.syncCanvasDimensions(cols, isDual);

    this.el('piki-cpu-frame').classList.toggle('hidden', !isDual);
    this.el('piki-cpu-frame').classList.toggle('flex', isDual);
    this.el('piki-story-box').classList.toggle('hidden', this.mode !== 'story');
    this.el('piki-2p-box').classList.toggle('hidden', this.mode !== 'vs2p');
    this.el('piki-stageclear-box').classList.toggle('hidden', this.mode !== 'stageclear');
    this.el('piki-puzzle-box').classList.toggle('hidden', this.mode !== 'puzzle');
    this.el('piki-tutorial-box').classList.toggle('hidden', this.mode !== 'tutorial');
    this.el('piki-race-strip').classList.toggle('hidden', this.setupPageOpen || this.mode !== 'endurance');

    if (this.mode === 'story') {
      const prof = getStoryRivalProfile(this.storyStage);
      this.board = createBoardState(this.nextSeed(), { cols, isVsMode: true });
      this.p2Board = createBoardState(this.nextSeed(), { cols, isVsMode: true });
      this.cpuCtrl = createCpuController(this.nextSeed());
      this.updateSidebarIdentity(prof.avatar, prof.name, prof.quote, prof.tierTag);
      this.el('piki-cpu-avatar').textContent = prof.avatar;
      this.el('piki-cpu-name').textContent = `CPU ${prof.shortName}`;
      this.el('piki-cpu-role-tag').textContent = `${prof.tierTag} AI`;
      this.el('piki-rival-tier').textContent = prof.tierTag;
      this.log(`⚔️ Andes Deathmatch Stage ${prof.stageNumber}: <strong>${prof.name}</strong>`);
    } else if (this.mode === 'vs2p') {
      this.board = createBoardState(this.nextSeed(), { cols, isVsMode: true });
      this.p2Board = createBoardState(this.nextSeed(), { cols, isVsMode: true });
      this.updateSidebarIdentity('👥', '1P vs 2P Pikiinya', '"Frost your friend with cascade attacks!"', '2P VERSUS');
      this.el('piki-cpu-avatar').textContent = '🐧';
      this.el('piki-cpu-name').textContent = '2P PLAYER';
      this.el('piki-cpu-role-tag').textContent = '2P HUMAN';
    } else if (this.mode === 'stageclear') {
      const maxUnlocked = this.uraUnlocked ? STAGE_CLEAR_LEVELS.length : 8;
      this.stageClearIdx = ((this.stageClearIdx % maxUnlocked) + maxUnlocked) % maxUnlocked;
      const stg = STAGE_CLEAR_LEVELS[this.stageClearIdx];
      this.board = createBoardState(this.nextSeed(), {
        cols,
        initialGrid: stg.grid,
        allowTargetInRandom: false,
      });
      this.updateSidebarIdentity(
        stg.course === 'ura' ? '❄️' : '🔓',
        stg.title,
        `"${stg.subtitle}"`,
        `${stg.course.toUpperCase()} ${stg.stageNumber}/8`
      );
      this.log(`🎯 ${stg.title}: Smash all Cage Targets!`);
    } else if (this.mode === 'endurance') {
      this.board = createBoardState(this.nextSeed(), { cols, allowTargetInRandom: false });
      this.updateSidebarIdentity('🏃', 'Endurance Runner', '"Clear rows & groups to accelerate down the glacier!"', 'ENDURANCE');
    } else if (this.mode === 'timeattack') {
      this.board = createBoardState(this.nextSeed(), { cols, allowTargetInRandom: false });
      this.updateSidebarIdentity('⏱️', '2-Minute Sprint', '"Rack up the highest chain score in 120 seconds!"', 'TIME ATTACK');
    } else if (this.mode === 'puzzle') {
      const puz = PIKI_PUZZLES[this.puzzleIdx];
      this.board = createBoardState(this.nextSeed(), {
        cols,
        initialGrid: puz.grid,
        padNarrowGridWithIce: cols > PIKI_COLS,
        queue: puz.pieceQueue,
        allowTargetInRandom: false,
        allowMiracleItem: false,
      });
      this.turnStartSnapshot = cloneBoardState(this.board);
      this.turnSnapshotRecorded = false;
      this.updateSidebarIdentity('🧩', puz.title, `"${puz.hint}"`, `PUZZLE ${this.puzzleIdx + 1}/${PIKI_PUZZLES.length}`);
      this.updateTsukuruUI();
    } else if (this.mode === 'tutorial') {
      const tut = TUTORIAL_STEPS[this.tutorialIdx];
      this.board = createBoardState(this.nextSeed(), {
        cols,
        initialGrid: tut.grid,
        padNarrowGridWithIce: cols > PIKI_COLS,
        queue: tut.pieceQueue,
        allowTargetInRandom: false,
        allowMiracleItem: false,
      });
      this.updateSidebarIdentity('🎓', tut.title, '"Follow the glacier lecture!"', `LESSON ${this.tutorialIdx + 1}/${TUTORIAL_STEPS.length}`);
    } else {
      // Endless
      this.board = createBoardState(this.nextSeed(), { cols, allowTargetInRandom: true });
      this.updateSidebarIdentity('🐧', 'Pikiinya! Endless', '"Speed jumps every 100 blocks — watch for Miracle Bells!"', 'ENDLESS');
    }

    this.syncOstContext();
    this.updateHUD();
    this.renderAll();
  }

  private updateSidebarIdentity(avatar: string, name: string, quote: string, badge: string): void {
    this.el('piki-char-avatar').textContent = avatar;
    this.el('piki-char-name').textContent = name;
    this.el('piki-char-quote').textContent = quote;
    this.el('piki-stage-badge').textContent = badge;
  }

  private changeStoryStage(delta: number): void {
    this.storyStage = Math.max(0, this.storyStage + delta);
    this.initModeBoard();
  }

  private changeStageClear(delta: number): void {
    const maxCount = this.uraUnlocked ? STAGE_CLEAR_LEVELS.length : 8;
    this.stageClearIdx = (this.stageClearIdx + delta + maxCount) % maxCount;
    this.initModeBoard();
  }

  private changePuzzle(delta: number): void {
    this.puzzleIdx = (this.puzzleIdx + delta + PIKI_PUZZLES.length) % PIKI_PUZZLES.length;
    this.initModeBoard();
  }

  private changeTutorial(delta: number): void {
    this.tutorialIdx = (this.tutorialIdx + delta + TUTORIAL_STEPS.length) % TUTORIAL_STEPS.length;
    this.initModeBoard();
  }

  private changeLevel(delta: number): void {
    this.baseLevel = Math.max(1, Math.min(12, this.baseLevel + delta));
    this.updateHUD();
  }

  private getFallSpeed(): number {
    if (this.mode === 'stageclear') {
      return STAGE_CLEAR_LEVELS[this.stageClearIdx].fallSpeed + (this.baseLevel - 1) * 0.2;
    }
    const pieceBonus = Math.floor(this.board.piecesSpawned / 100) * 0.45;
    return 1.35 + (this.baseLevel - 1) * 0.28 + pieceBonus;
  }

  private undoPuzzleMove(): void {
    if (this.mode !== 'puzzle' || this.tsukuruActive || this.puzzleHistory.length === 0) return;
    this.board = this.puzzleHistory.pop()!;
    this.turnStartSnapshot = cloneBoardState(this.board);
    this.turnSnapshotRecorded = false;
    this.roundOver = false;
    this.stageClearPending = false;
    this.hideOverlay();
    this.bridge.audio.playMove();
    this.syncBgmState();
    this.updateHUD();
    this.renderAll();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.active) return;

    const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
    if (settingsDialog?.open) return;
    if (!document.getElementById('help-modal')?.classList.contains('hidden')) return;
    if (!document.getElementById('rom-modal')?.classList.contains('hidden')) return;

    if (this.helpModalOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.toggleHelp(false);
      }
      return;
    }

    if (this.setupPageOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.toggleSetupPage(false);
      }
      return;
    }

    if (this.roundOver || this.victory || this.stageClearPending || this.paused) {
      if (
        e.key === 'Enter' ||
        e.key === ' ' ||
        this.bridge.codeMatchesSlot('p1', 'swap', e.code)
      ) {
        e.preventDefault();
        this.handleOverlayPrimary();
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        this.togglePause();
      }
      return;
    }

    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      this.togglePause();
      return;
    }

    this.heldKeys.add(e.code);
    this.bridge.audio.unlock();

    let handled = false;
    if (!e.repeat && this.canControl1P()) {
      if (this.bridge.codeMatchesSlot('p1', 'left', e.code)) {
        if (moveQuadX(this.board, -1)) this.bridge.audio.playMove();
        this.keyRepeatP1 = { dirX: -1, dasTimer: 0.16 };
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p1', 'right', e.code)) {
        if (moveQuadX(this.board, 1)) this.bridge.audio.playMove();
        this.keyRepeatP1 = { dirX: 1, dasTimer: 0.16 };
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p1', 'up', e.code)) {
        hardDropQuad(this.board);
        this.bridge.audio.playSwap();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p1', 'swap', e.code) || (this.mode !== 'vs2p' && e.code === 'Enter')) {
        if (rotateQuad(this.board, 1)) this.bridge.audio.playRotate();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p1', 'raise', e.code)) {
        if (rotateQuad(this.board, -1)) this.bridge.audio.playRotate();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p1', 'down', e.code)) {
        handled = true;
      }
    } else if (
      this.bridge.codeMatchesSlot('p1', 'left', e.code) ||
      this.bridge.codeMatchesSlot('p1', 'right', e.code) ||
      this.bridge.codeMatchesSlot('p1', 'down', e.code)
    ) {
      handled = true;
    }

    if (this.mode === 'vs2p' && !e.repeat && this.canControl2P()) {
      if (this.bridge.codeMatchesSlot('p2', 'left', e.code)) {
        if (moveQuadX(this.p2Board, -1)) this.bridge.audio.playMove();
        this.keyRepeatP2 = { dirX: -1, dasTimer: 0.16 };
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p2', 'right', e.code)) {
        if (moveQuadX(this.p2Board, 1)) this.bridge.audio.playMove();
        this.keyRepeatP2 = { dirX: 1, dasTimer: 0.16 };
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p2', 'up', e.code)) {
        hardDropQuad(this.p2Board);
        this.bridge.audio.playSwap();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p2', 'swap', e.code)) {
        if (rotateQuad(this.p2Board, 1)) this.bridge.audio.playRotate();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p2', 'raise', e.code)) {
        if (rotateQuad(this.p2Board, -1)) this.bridge.audio.playRotate();
        handled = true;
      } else if (this.bridge.codeMatchesSlot('p2', 'down', e.code)) {
        handled = true;
      }
    } else if (
      this.mode === 'vs2p' &&
      (this.bridge.codeMatchesSlot('p2', 'left', e.code) ||
        this.bridge.codeMatchesSlot('p2', 'right', e.code) ||
        this.bridge.codeMatchesSlot('p2', 'down', e.code))
    ) {
      handled = true;
    }

    if (handled) e.preventDefault();
  }

  private isActionHeld(player: 'p1' | 'p2', action: 'left' | 'right' | 'down'): boolean {
    const cfg = this.bridge.getControlsConfig();
    const slots = cfg[player][action];
    return slots.some((code) => code && this.heldKeys.has(code));
  }

  private processHeldKeyRepeats(dt: number): void {
    const stepTracker = (board: PikiBoardState, tracker: KeyRepeatTracker, player: 'p1' | 'p2') => {
      const left = this.isActionHeld(player, 'left');
      const right = this.isActionHeld(player, 'right');
      const desired: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
      if (desired === 0) {
        tracker.dirX = 0;
        tracker.dasTimer = 0;
        return;
      }
      if (tracker.dirX !== desired) {
        tracker.dirX = desired;
        tracker.dasTimer = 0.16;
      } else {
        tracker.dasTimer -= dt;
        if (tracker.dasTimer <= 0) {
          tracker.dasTimer = 0.055;
          if (board.phase === 'falling') moveQuadX(board, desired);
        }
      }
    };

    if (this.canControl1P()) stepTracker(this.board, this.keyRepeatP1, 'p1');
    if (this.mode === 'vs2p' && this.canControl2P()) stepTracker(this.p2Board, this.keyRepeatP2, 'p2');
  }

  private pollPlayerGamepad(
    pad: Gamepad | null,
    tracker: PadTracker,
    board: PikiBoardState,
    isP2: boolean,
    dt: number
  ): boolean {
    if (!pad) {
      tracker.dirX = 0;
      tracker.dasTimer = 0;
      tracker.upHeld = false;
      tracker.cwHeld = false;
      tracker.ccwHeld = false;
      tracker.startHeld = false;
      return false;
    }

    const startNow = this.bridge.isPadBtnPressed(pad, 9);
    const cwNow = this.bridge.isPadBtnPressed(pad, 0) || this.bridge.isPadBtnPressed(pad, 1);
    const ccwNow =
      this.bridge.isPadBtnPressed(pad, 2) ||
      this.bridge.isPadBtnPressed(pad, 3) ||
      this.bridge.isPadBtnPressed(pad, 4) ||
      this.bridge.isPadBtnPressed(pad, 5);
    const axX = pad.axes && pad.axes.length > 0 ? pad.axes[0] : 0;
    const axY = pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0;
    const upNow = this.bridge.isPadBtnPressed(pad, 12) || axY < -0.55;
    const downHeld = this.bridge.isPadBtnPressed(pad, 13) || axY > 0.45;
    const leftHeld = this.bridge.isPadBtnPressed(pad, 14) || axX < -0.45;
    const rightHeld = this.bridge.isPadBtnPressed(pad, 15) || axX > 0.45;

    if (!isP2 && startNow && !tracker.startHeld) {
      this.bridge.audio.unlock();
      if (this.roundOver || this.victory || this.stageClearPending) {
        this.handleOverlayPrimary();
      } else {
        this.togglePause();
      }
    }
    tracker.startHeld = startNow;

    if (this.paused || this.roundOver || this.victory || this.stageClearPending) {
      if (!isP2 && cwNow && !tracker.cwHeld && (this.roundOver || this.victory || this.stageClearPending)) {
        this.handleOverlayPrimary();
      }
      tracker.cwHeld = cwNow;
      tracker.ccwHeld = ccwNow;
      tracker.upHeld = upNow;
      return false;
    }

    if (board.phase === 'falling' && !board.toppedOut) {
      const desiredX: -1 | 0 | 1 = leftHeld && !rightHeld ? -1 : rightHeld && !leftHeld ? 1 : 0;
      if (desiredX !== 0) {
        if (tracker.dirX !== desiredX) {
          tracker.dirX = desiredX;
          tracker.dasTimer = 0.17;
          if (moveQuadX(board, desiredX) && !isP2) this.bridge.audio.playMove();
        } else {
          tracker.dasTimer -= dt;
          if (tracker.dasTimer <= 0) {
            tracker.dasTimer = 0.055;
            if (moveQuadX(board, desiredX) && !isP2) this.bridge.audio.playMove();
          }
        }
      } else {
        tracker.dirX = 0;
        tracker.dasTimer = 0;
      }

      if (cwNow && !tracker.cwHeld) {
        if (rotateQuad(board, 1) && !isP2) this.bridge.audio.playRotate();
      }
      if (ccwNow && !tracker.ccwHeld) {
        if (rotateQuad(board, -1) && !isP2) this.bridge.audio.playRotate();
      }
      if (upNow && !tracker.upHeld) {
        hardDropQuad(board);
        if (!isP2) this.bridge.audio.playSwap();
      }
    }

    tracker.cwHeld = cwNow;
    tracker.ccwHeld = ccwNow;
    tracker.upHeld = upNow;
    return downHeld;
  }

  private startLoop(): void {
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTickMs) / 1000));
      this.lastTickMs = now;
      if (this.active) {
        this.stepSimulation(dt);
        this.renderAll();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.lastTickMs = performance.now();
    this.rafId = requestAnimationFrame(tick);
  }

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private stepSimulation(dt: number): void {
    this.syncBgmState();
    if (!this.active || this.isExternalModalOpen()) {
      return;
    }
    const pads = this.bridge.getConnectedGamepadsList();
    const pad1 = this.bridge.resolvePlayerGamepad('p1', pads);
    const p1PadDown = this.pollPlayerGamepad(pad1, this.padP1, this.board, false, dt);

    let p2PadDown = false;
    if (this.mode === 'vs2p') {
      const pad2 = this.bridge.resolvePlayerGamepad('p2', pads);
      p2PadDown = this.pollPlayerGamepad(pad2, this.padP2, this.p2Board, true, dt);
    }

    if (this.paused || this.roundOver || this.victory || this.stageClearPending || this.helpModalOpen || this.setupPageOpen) {
      return;
    }
    if (this.mode === 'puzzle' && this.tsukuruActive && this.tsukuruEditing) {
      return;
    }

    this.processHeldKeyRepeats(dt);
    this.elapsedSec += dt;

    // 2-Minute Time Attack Countdown
    if (this.mode === 'timeattack') {
      this.timeRemainingSec = Math.max(0, this.timeRemainingSec - dt);
      if (this.timeRemainingSec <= 0) {
        this.victory = true;
        this.bridge.audio.playVictory();
        this.recordHighScore();
        this.showOverlay(
          '⏱️',
          'TIME UP!',
          `Great run! You rescued ${this.board.clearedPikiCount} Pikiinyas!`,
          '🔄 PLAY AGAIN'
        );
        return;
      }
    }

    // Endurance Race Acceleration & Distance
    if (this.mode === 'endurance') {
      this.raceSpeedKmh = Math.max(18, this.raceSpeedKmh - dt * 1.4);
      this.raceDistanceM += (this.raceSpeedKmh / 3.6) * dt;
      this.raceLap = 1 + Math.floor(this.raceDistanceM / 500);
      this.board.score = Math.max(this.board.score, Math.floor(this.raceDistanceM));
    }

    const isDual = this.mode === 'story' || this.mode === 'vs2p';
    const p1Soft = this.isActionHeld('p1', 'down') || p1PadDown;

    const p1Events = stepBoard(this.board, dt, this.getFallSpeed(), {
      opponent: isDual ? this.p2Board : null,
      softDropping: p1Soft,
    });
    if (this.mode === 'puzzle' && !this.tsukuruActive) {
      if (!this.board.current && !this.turnSnapshotRecorded && this.turnStartSnapshot) {
        this.puzzleHistory.push(this.turnStartSnapshot);
        this.turnSnapshotRecorded = true;
      }
      if (p1Events.spawned) {
        this.turnStartSnapshot = cloneBoardState(this.board);
        this.turnSnapshotRecorded = false;
      }
    }

    if (p1Events.locked) {
      this.bridge.audio.playMove();
    }
    if (p1Events.miracleAwakened) {
      this.bridge.audio.playMiracle();
    }
    if (p1Events.garbageDropped > 0) {
      this.bridge.audio.playGarbageLand();
      this.log(`❄️ Received <strong>${p1Events.garbageDropped}</strong> garbage blocks!`);
    }
    if (p1Events.cleared) {
      this.handleClearFeedback('1P', p1Events.cleared, this.board.chainStep);
      if (this.mode === 'endurance') {
        const boost =
          p1Events.cleared.iceRows * 6 +
          p1Events.cleared.clearedPiki * 1.4 +
          (this.board.chainStep >= 2 ? this.board.chainStep * 5 : 0);
        this.raceSpeedKmh = Math.min(99, this.raceSpeedKmh + boost);
      }
    }

    // Update danger warning BGM
    let p1NearTop = false;
    const cols = this.board.cols || PIKI_COLS;
    for (let r = PIKI_SPAWN_ROWS; r < PIKI_SPAWN_ROWS + 2; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.board.grid[r][c].type !== CELL.EMPTY) p1NearTop = true;
      }
    }
    this.bridge.audio.isDanger = p1NearTop;
    this.el('piki-danger-pill').classList.toggle('hidden', !p1NearTop);

    // Dual-board CPU or 2P Update
    if (this.mode === 'story') {
      const prof: CpuOpponentProfile = getStoryRivalProfile(this.storyStage);
      const cpuAct = stepCpuAgent(this.p2Board, this.cpuCtrl, prof, dt);
      const p2Events = stepBoard(this.p2Board, dt, prof.fallSpeed, {
        opponent: this.board,
        softDropping: cpuAct.softDropping,
      });
      if (p2Events.cleared && p2Events.cleared.garbageSent > 0) {
        this.log(`${prof.avatar} ${prof.shortName} sent <strong>${p2Events.cleared.garbageSent}</strong> blocks!`);
      }
    } else if (this.mode === 'vs2p') {
      const p2Soft = this.isActionHeld('p2', 'down') || p2PadDown;
      stepBoard(this.p2Board, dt, this.getFallSpeed(), {
        opponent: this.board,
        softDropping: p2Soft,
      });
    }

    // Check Mode Win / Loss States
    this.checkModeOutcome(dt);
    this.updateHUD();
  }

  private handleClearFeedback(who: string, sum: NonNullable<ReturnType<typeof stepBoard>['cleared']>, chain: number): void {
    if (sum.thawedMiracles > 0 || sum.clearedMiracles > 0) {
      this.bridge.audio.playMiracle();
    } else if (sum.thawedCount > 0) {
      this.bridge.audio.playThaw();
    } else if (sum.iceRows > 0) {
      this.bridge.audio.playIceShatter();
    }
    if (sum.clearedPiki > 0) {
      this.bridge.audio.playPikiClear(chain);
    }
    if (sum.allClear) {
      this.log(`✨ <strong>${who} ALL CLEAR!</strong> +5000 pts!`);
    } else if (chain >= 2) {
      this.log(`🔥 <strong>${who} ${chain}x CHAIN!</strong>${sum.garbageSent > 0 ? ` (+${sum.garbageSent} garbage)` : ''}`);
    } else if (sum.garbageSent > 0) {
      this.log(`🐧 ${who} sent <strong>${sum.garbageSent}</strong> garbage blocks!`);
    }
  }

  private checkModeOutcome(dt: number): void {
    // 1. Stage Clear (or Custom Tsukuru test play): Wait until cascades finish, then check Cages == 0
    const settled = this.board.phase === 'falling';
    if (this.mode === 'stageclear' && settled && countRemainingTargets(this.board.grid) === 0) {
      this.stageClearPending = true;
      this.bridge.audio.playVictory();
      this.recordHighScore();
      const stg = STAGE_CLEAR_LEVELS[this.stageClearIdx];
      if (stg.course === 'omote' && stg.stageNumber === 8 && !this.uraUnlocked) {
        this.uraUnlocked = true;
        safeSave('piki_ura_unlocked', '1');
        this.log('🌟 <strong>URA (HIDDEN) STAGES UNLOCKED!</strong>');
      }
      this.showOverlay(
        '🏆',
        'STAGE CLEARED!',
        `${stg.title} complete!`,
        '▶ NEXT STAGE'
      );
      return;
    }

    // Custom Tsukuru Test Play win check
    if (this.mode === 'puzzle' && this.tsukuruActive && !this.tsukuruEditing && settled) {
      const hasTargets = this.tsukuruGrid.some((row) => row.some((v) => v === CELL.TARGET));
      const clearedGoal = hasTargets
        ? countRemainingTargets(this.board.grid) === 0
        : countRemainingPikiOrTargets(this.board.grid) === 0;
      if (clearedGoal) {
        this.victory = true;
        this.bridge.audio.playVictory();
        this.showOverlay('🏆', 'CUSTOM STAGE CLEAR!', 'Your Tsukuru stage works cleanly!', '✏️ BACK TO EDITOR');
        return;
      }
    }

    // 2. Puzzle Mode win / out-of-moves check
    if (this.mode === 'puzzle' && !this.tsukuruActive) {
      if (settled && countRemainingPikiOrTargets(this.board.grid) === 0) {
        this.stageClearPending = true;
        this.bridge.audio.playVictory();
        this.recordHighScore();
        this.showOverlay('🧩', 'PUZZLE SOLVED!', 'Every penguin & cage rescued cleanly!', '▶ NEXT PUZZLE');
        return;
      }
      if (settled && !this.board.current) {
        this.roundOver = true;
        this.bridge.audio.playGameOver();
        this.showOverlay('💨', 'OUT OF PIECES', 'Press Undo (↩) or retry this puzzle!', '↩ UNDO LAST');
        return;
      }
    }

    // 3. Tutorial Goal check
    if (this.mode === 'tutorial' && settled) {
      const tut = TUTORIAL_STEPS[this.tutorialIdx];
      if (tut.checkGoal(this.board)) {
        this.tutorialSolvedHold += dt;
        if (this.tutorialSolvedHold >= 0.45) {
          this.stageClearPending = true;
          this.bridge.audio.playVictory();
          this.showOverlay('🎓', 'LESSON COMPLETE!', 'Nice job! Ready for the next Pikiinya technique!', '▶ NEXT LESSON');
          return;
        }
      } else if (!this.board.current) {
        this.roundOver = true;
        this.showOverlay('🔄', 'TRY LESSON AGAIN', 'Let us reset the pieces for another try!', '🔄 RETRY LESSON');
        return;
      }
    }

    // 4. Story / 2P Dual Outcomes
    if (this.mode === 'story') {
      const prof = getStoryRivalProfile(this.storyStage);
      if (this.p2Board.toppedOut) {
        this.stageClearPending = true;
        this.storyStreak++;
        if (this.storyStreak > this.bestStoryStreak) {
          this.bestStoryStreak = this.storyStreak;
          safeSave('piki_best_streak', String(this.bestStoryStreak));
        }
        this.recordHighScore();
        this.bridge.audio.playVictory();
        this.showOverlay(
          prof.avatar,
          `DEFEATED ${prof.shortName}!`,
          prof.stageNumber === 8
            ? 'Dr. Slagger blasted off! Enter Overlord Ω stages next!'
            : `Onward to Stage ${prof.stageNumber + 1}!`,
          `⚔️ STAGE ${prof.stageNumber + 1}`
        );
        return;
      }
      if (this.board.toppedOut) {
        this.roundOver = true;
        this.storyStreak = 0;
        this.recordHighScore();
        this.bridge.audio.playGameOver();
        this.showOverlay('💔', 'TOPPED OUT!', `${prof.name} trapped the flock! Try again!`, `🔄 RETRY STAGE ${prof.stageNumber}`);
        return;
      }
    }

    if (this.mode === 'vs2p') {
      if (this.p2Board.toppedOut) {
        this.p1MatchWins++;
        this.stageClearPending = true;
        this.bridge.audio.playVictory();
        this.recordHighScore();
        this.showOverlay('🐧', '1P WINS ROUND!', `Series: 1P ${this.p1MatchWins} - ${this.p2MatchWins} 2P`, '⚔️ NEXT ROUND');
        return;
      }
      if (this.board.toppedOut) {
        this.p2MatchWins++;
        this.roundOver = true;
        this.bridge.audio.playVictory();
        this.showOverlay('💧', '2P WINS ROUND!', `Series: 1P ${this.p1MatchWins} - ${this.p2MatchWins} 2P`, '⚔️ NEXT ROUND');
        return;
      }
    }

    // 5. Generic Top-Out for Solo Modes
    if (this.board.toppedOut) {
      this.roundOver = true;
      this.recordHighScore();
      this.bridge.audio.playGameOver();
      this.showOverlay(
        '❄️',
        'ICE OVERFLOW!',
        'The stack reached the spawn ceiling!',
        '🔄 PLAY AGAIN'
      );
    }
  }

  private recordHighScore(): void {
    const cur = this.board.score;
    const prev = this.highScores[this.mode] ?? 0;
    if (cur > prev) {
      this.highScores[this.mode] = cur;
      const keyMap: Record<string, string> = {
        story: 'piki_hi_story',
        vs2p: 'piki_hi_vs2p',
        stageclear: 'piki_hi_stage',
        endless: 'piki_hi_endless',
        endurance: 'piki_hi_endurance',
        timeattack: 'piki_hi_time',
        puzzle: 'piki_hi_puzzle',
      };
      if (keyMap[this.mode]) safeSave(keyMap[this.mode], String(cur));
    }
  }

  private togglePause(): void {
    this.bridge.audio.unlock();
    if (this.roundOver || this.victory || this.stageClearPending) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.showOverlay('⏸️', 'PAUSED', 'Take a glacier breather!', '▶ RESUME');
    } else {
      this.hideOverlay();
    }
  }

  private handleOverlayPrimary(): void {
    this.bridge.audio.unlock();
    if (this.paused && !this.roundOver && !this.victory && !this.stageClearPending) {
      this.paused = false;
      this.hideOverlay();
      return;
    }
    if (this.stageClearPending) {
      if (this.mode === 'story') {
        this.storyStage++;
        this.initModeBoard();
      } else if (this.mode === 'stageclear') {
        this.changeStageClear(1);
      } else if (this.mode === 'puzzle') {
        this.changePuzzle(1);
      } else if (this.mode === 'tutorial') {
        this.changeTutorial(1);
      } else if (this.mode === 'vs2p') {
        this.initModeBoard();
      }
      return;
    }
    if (this.mode === 'puzzle' && this.tsukuruActive && !this.tsukuruEditing) {
      this.tsukuruEditing = true;
      this.victory = false;
      this.hideOverlay();
      this.loadTsukuruGridIntoBoard();
      return;
    }
    if (this.mode === 'puzzle' && this.roundOver && this.puzzleHistory.length > 0) {
      this.undoPuzzleMove();
      return;
    }
    this.initModeBoard();
  }

  private showOverlay(icon: string, title: string, sub: string, btnLabel: string): void {
    this.el('piki-ov-icon').textContent = icon;
    this.el('piki-ov-title').textContent = title;
    this.el('piki-ov-sub').textContent = sub;
    this.el('piki-ov-score').textContent = String(this.board.score);
    this.el('piki-ov-chain').textContent = `${this.board.maxChain}x`;
    this.el('piki-ov-rescued').textContent = String(this.board.clearedPikiCount);
    this.el('piki-ov-primary').textContent = btnLabel;
    this.el('piki-overlay').classList.remove('hidden');
  }

  private hideOverlay(): void {
    this.el('piki-overlay').classList.add('hidden');
  }

  private toggleHelp(show: boolean): void {
    this.helpModalOpen = show;
    this.el('piki-help-modal').classList.toggle('hidden', !show);
  }

  private updateHUD(): void {
    this.el('piki-hud-score').textContent = String(this.board.score).padStart(6, '0');
    this.el('piki-hud-best').textContent = String(this.highScores[this.mode] ?? 0).padStart(6, '0');
    this.el('piki-hud-speed').textContent = `Lv.${this.baseLevel}`;
    this.el('piki-hud-maxchain').textContent = `${this.board.maxChain}x`;

    const tSec = this.mode === 'timeattack' ? Math.ceil(this.timeRemainingSec) : Math.floor(this.elapsedSec);
    const mm = String(Math.floor(tSec / 60)).padStart(2, '0');
    const ss = String(tSec % 60).padStart(2, '0');
    this.el('piki-hud-time-label').textContent = this.mode === 'timeattack' ? 'Left' : 'Time';
    this.el('piki-hud-time').textContent = `${mm}:${ss}`;

    const p1G = this.el('piki-p1-garbage-badge');
    p1G.classList.toggle('hidden', this.board.pendingGarbage <= 0);
    p1G.textContent = `🧊 +${this.board.pendingGarbage}`;

    if (this.mode === 'story') {
      this.el('piki-story-streak').textContent = `${this.storyStreak} WINS (BEST: ${this.bestStoryStreak})`;
    }
    if (this.mode === 'story' || this.mode === 'vs2p') {
      const p2G = this.el('piki-p2-garbage-badge');
      p2G.classList.toggle('hidden', this.p2Board.pendingGarbage <= 0);
      p2G.textContent = `🧊 +${this.p2Board.pendingGarbage}`;
      this.el('piki-cpu-score').textContent = String(this.p2Board.score);
      if (this.mode === 'vs2p') {
        this.el('piki-2p-tally').textContent = `1P ${this.p1MatchWins} - ${this.p2MatchWins} 2P`;
      }
    }

    if (this.mode === 'stageclear') {
      const stg = STAGE_CLEAR_LEVELS[this.stageClearIdx];
      this.el('piki-cages-left').textContent = String(countRemainingTargets(this.board.grid));
      this.el('piki-stageclear-label').textContent = `${stg.course.toUpperCase()} ${stg.stageNumber}/8`;
      this.el('piki-ura-badge').textContent = this.uraUnlocked
        ? '✨ URA Hidden Course Unlocked!'
        : 'Clear Omote Stage 8 to unlock URA stages!';
    }

    if (this.mode === 'puzzle') {
      this.el('piki-puzzle-hint').textContent = PIKI_PUZZLES[this.puzzleIdx].hint;
      this.el('piki-puz-num').textContent = `${this.puzzleIdx + 1}/${PIKI_PUZZLES.length}`;
    }

    if (this.mode === 'tutorial') {
      const tut = TUTORIAL_STEPS[this.tutorialIdx];
      this.el('piki-tut-instruction').textContent = tut.instruction;
      this.el('piki-tut-goal').textContent = `Goal: ${tut.goalText}`;
      this.el('piki-tut-num').textContent = `${this.tutorialIdx + 1}/${TUTORIAL_STEPS.length}`;
    }

    if (this.mode === 'endurance') {
      this.el('piki-race-lap').textContent = `LAP ${this.raceLap}`;
      this.el('piki-race-speed').textContent = `${Math.round(this.raceSpeedKmh)} km/h`;
      this.el('piki-race-dist').textContent = `${Math.floor(this.raceDistanceM)} m`;
    }
  }

  private renderAll(): void {
    if (this.setupPageOpen) {
      this.renderSetupPreview(performance.now() / 1000);
      return;
    }
    const isEditor = this.mode === 'puzzle' && this.tsukuruActive && this.tsukuruEditing;
    renderPikiBoard(this.p1Ctx, this.board, {
      showGhost: this.showGhostPiece && !isEditor,
      dangerHighlight: this.bridge.audio.isDanger && !isEditor,
      editorMode: isEditor,
    });
    renderNextQuadCanvas(this.p1NextCtx, this.board.next, this.board.elapsedTime);

    if (this.mode === 'story' || this.mode === 'vs2p') {
      renderPikiBoard(this.p2Ctx, this.p2Board, { showGhost: false });
      renderNextQuadCanvas(this.p2NextCtx, this.p2Board.next, this.p2Board.elapsedTime);
    }

    if (this.mode === 'endurance') {
      renderEnduranceRaceCanvas(
        this.raceCtx,
        this.raceDistanceM,
        this.raceSpeedKmh,
        this.board.elapsedTime
      );
    }
  }

  private log(html: string): void {
    const logEl = this.el('piki-log');
    const row = document.createElement('div');
    row.innerHTML = html;
    logEl.prepend(row);
    while (logEl.children.length > 18) {
      logEl.lastChild?.remove();
    }
  }
}
