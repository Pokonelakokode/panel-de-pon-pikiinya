import {
  CELL,
  MAX_PIKI_COLS,
  MIN_PIKI_COLS,
  PIKI_COLS,
  PIKI_ROWS,
  PIKI_SPAWN_ROWS,
  type BoardPhase,
  type CellType,
  type ClearSummary,
  type FallingQuad,
  type PikiBoardOptions,
  type PikiBoardState,
  type PikiCell,
  type PikiParticle,
  type PikiPopup,
  type QuadCells,
} from './types.ts';

export function clampPikiCols(cols?: number): number {
  if (cols === undefined || !Number.isFinite(cols)) return PIKI_COLS;
  return Math.max(MIN_PIKI_COLS, Math.min(MAX_PIKI_COLS, Math.round(cols)));
}

export function getGridCols(grid: readonly (readonly unknown[])[]): number {
  return grid[0]?.length ?? PIKI_COLS;
}

export function getSpawnCol(cols: number): number {
  return Math.max(0, Math.floor((cols - 2) / 2));
}

/**
 * Exact 32-byte piece generation table observed at $00:D54A (ROM offset 0x554A)
 * in Pikiinya! (Japan).sfc:
 *  15x Awake Pikiinya (2), 8x Pure Ice (1), 8x Frozen Pikiinya (3), 1x Target Stone (4)
 */
export const ROM_PIECE_TABLE_D54A: readonly CellType[] = [
  2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 4, 3,
  1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2,
] as const;

export function createEmptyCell(): PikiCell {
  return {
    type: CELL.EMPTY,
    groupSize: 0,
    clearing: false,
    thawing: false,
    excitedTimer: 0,
    fallOffset: 0,
  };
}

export function createCell(type: CellType): PikiCell {
  return {
    type,
    groupSize: 0,
    clearing: false,
    thawing: false,
    excitedTimer: 0,
    fallOffset: 0,
  };
}

export function createEmptyGrid(cols: number = PIKI_COLS): PikiCell[][] {
  const safeCols = clampPikiCols(cols);
  const grid: PikiCell[][] = [];
  for (let r = 0; r < PIKI_ROWS; r++) {
    const row: PikiCell[] = [];
    for (let c = 0; c < safeCols; c++) {
      row.push(createEmptyCell());
    }
    grid.push(row);
  }
  return grid;
}

export function cloneGrid(grid: readonly (readonly PikiCell[])[]): PikiCell[][] {
  return grid.map((row) => row.map((cell) => ({ ...cell })));
}

export function cloneBoardState(board: PikiBoardState): PikiBoardState {
  return {
    ...board,
    grid: cloneGrid(board.grid),
    pieceQueue: board.pieceQueue.map((q) => [...q] as QuadCells),
    current: board.current
      ? { ...board.current, cells: [...board.current.cells] as QuadCells }
      : null,
    next: [...board.next] as QuadCells,
    lastClearSummary: board.lastClearSummary ? { ...board.lastClearSummary } : null,
    particles: board.particles.map((p) => ({ ...p })),
    popups: board.popups.map((p) => ({ ...p })),
  };
}

/** Deterministic 32-bit xorshift PRNG */
export function nextRngUint32(state: number): number {
  let x = state >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

export function normalizeCellType(raw: number): CellType {
  switch (raw) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 6:
    case 7:
      return raw;
    default:
      return CELL.EMPTY;
  }
}

export function loadGridFromMatrix(
  grid: PikiCell[][],
  matrix: readonly (readonly number[])[],
  opts?: { padSidesWithIce?: boolean }
): void {
  const cols = getGridCols(grid);
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c] = createEmptyCell();
    }
  }
  const startRow = Math.max(0, PIKI_ROWS - matrix.length);
  for (let r = 0; r < matrix.length; r++) {
    const targetR = startRow + r;
    if (targetR >= PIKI_ROWS) continue;
    const srcRow = matrix[r];
    if (srcRow.length <= cols) {
      const colOffset = Math.floor((cols - srcRow.length) / 2);
      for (let c = 0; c < srcRow.length; c++) {
        grid[targetR][colOffset + c] = createCell(normalizeCellType(srcRow[c]));
      }
      if (opts?.padSidesWithIce && srcRow.length < cols && srcRow.some((v) => v !== 0)) {
        for (let c = 0; c < colOffset; c++) {
          grid[targetR][c] = createCell(CELL.ICE);
        }
        for (let c = colOffset + srcRow.length; c < cols; c++) {
          grid[targetR][c] = createCell(CELL.ICE);
        }
      }
    } else {
      const srcOffset = Math.floor((srcRow.length - cols) / 2);
      for (let c = 0; c < cols; c++) {
        grid[targetR][c] = createCell(normalizeCellType(srcRow[srcOffset + c]));
      }
    }
  }
  if (opts?.padSidesWithIce) {
    // Support side-padded Ice columns down to the floor so they never float
    for (let c = 0; c < cols; c++) {
      let seenAbove = false;
      for (let r = 0; r < PIKI_ROWS; r++) {
        if (grid[r][c].type !== CELL.EMPTY) seenAbove = true;
        else if (seenAbove) grid[r][c] = createCell(CELL.ICE);
      }
    }
  }
  updatePikiGroupSizes(grid);
}

function rollQuadCells(board: {
  rngState: number;
  allowTargetInRandom: boolean;
  allowMiracleItem: boolean;
  piecesSpawned: number;
}): QuadCells {
  const cells: [CellType, CellType, CellType, CellType] = [
    CELL.ICE,
    CELL.PIKI,
    CELL.FROZEN_PIKI,
    CELL.PIKI,
  ];
  let hasTarget = false;

  for (let i = 0; i < 4; i++) {
    board.rngState = nextRngUint32(board.rngState);
    let picked = ROM_PIECE_TABLE_D54A[board.rngState & 0x1f];
    if (picked === CELL.TARGET) {
      if (!board.allowTargetInRandom || hasTarget) {
        picked = i % 2 === 0 ? CELL.ICE : CELL.FROZEN_PIKI;
      } else {
        hasTarget = true;
      }
    }
    cells[i] = picked;
  }

  // Ensure a 2x2 block never degenerates into 4 identical Target blocks or boring 4 Ice without character
  if (
    cells[0] === CELL.ICE &&
    cells[1] === CELL.ICE &&
    cells[2] === CELL.ICE &&
    cells[3] === CELL.ICE
  ) {
    board.rngState = nextRngUint32(board.rngState);
    cells[board.rngState & 3] = CELL.FROZEN_PIKI;
  }

  // Every 100 pieces ($0B97 == 0x64 in ROM), inject a Frozen Miracle Bell (7)
  if (board.allowMiracleItem && board.piecesSpawned > 0 && board.piecesSpawned % 100 === 0) {
    board.rngState = nextRngUint32(board.rngState);
    cells[board.rngState & 3] = CELL.FROZEN_MIRACLE;
  }

  return cells;
}

export function createBoardState(seed = 19970131, options: PikiBoardOptions = {}): PikiBoardState {
  const cols = clampPikiCols(options.cols);
  const grid = createEmptyGrid(cols);
  const queue = (options.queue ?? []).map((q) => [...q] as QuadCells);

  const board: PikiBoardState = {
    cols,
    grid,
    rngState: seed >>> 0 || 19970131,
    allowTargetInRandom: options.allowTargetInRandom ?? true,
    allowMiracleItem: options.allowMiracleItem ?? true,
    isVsMode: options.isVsMode ?? false,
    pieceQueue: queue,
    queueCursor: 0,
    current: null,
    next: [CELL.ICE, CELL.PIKI, CELL.FROZEN_PIKI, CELL.PIKI],
    phase: 'falling',
    phaseTimer: 0,
    chainStep: 0,
    maxChain: 1,
    score: 0,
    piecesSpawned: 0,
    clearedPikiCount: 0,
    clearedTargetCount: 0,
    iceRowsCleared: 0,
    allClears: 0,
    pendingGarbage: 0,
    garbageDroppedThisTurn: false,
    lastClearSummary: null,
    toppedOut: false,
    particles: [],
    popups: [],
    elapsedTime: 0,
  };

  if (options.initialGrid) {
    loadGridFromMatrix(board.grid, options.initialGrid, {
      padSidesWithIce: options.padNarrowGridWithIce,
    });
  }

  if (queue.length > 0) {
    board.next = [...queue[0]] as QuadCells;
  } else {
    board.next = rollQuadCells(board);
  }

  spawnNextQuad(board);
  return board;
}

export function canPlaceQuad(grid: readonly (readonly PikiCell[])[], col: number, row: number): boolean {
  const cols = getGridCols(grid);
  if (col < 0 || col + 1 >= cols) return false;
  if (row < 0 || row + 1 >= PIKI_ROWS) return false;
  return (
    grid[row][col].type === CELL.EMPTY &&
    grid[row][col + 1].type === CELL.EMPTY &&
    grid[row + 1][col].type === CELL.EMPTY &&
    grid[row + 1][col + 1].type === CELL.EMPTY
  );
}

/**
 * Top-out rule faithful to $00:E560 (CPX #$000E on $7E:F000):
 * Any settled cell inside rows 0..1 OR blocked spawn center prevents next spawn.
 */
export function isBoardToppedOut(grid: readonly (readonly PikiCell[])[]): boolean {
  const cols = getGridCols(grid);
  for (let r = 0; r < PIKI_SPAWN_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type !== CELL.EMPTY) return true;
    }
  }
  return !canPlaceQuad(grid, getSpawnCol(cols), 0);
}

export function spawnNextQuad(board: PikiBoardState): boolean {
  if (isBoardToppedOut(board.grid)) {
    board.current = null;
    board.toppedOut = true;
    return false;
  }

  const spawnCol = getSpawnCol(board.cols);

  if (board.pieceQueue.length > 0) {
    if (board.queueCursor >= board.pieceQueue.length) {
      board.current = null;
      board.next = [CELL.EMPTY, CELL.EMPTY, CELL.EMPTY, CELL.EMPTY];
      return false;
    }
    const cells = [...board.pieceQueue[board.queueCursor]] as QuadCells;
    board.queueCursor++;
    board.piecesSpawned++;
    board.current = {
      col: spawnCol,
      row: 0,
      subRow: 0,
      cells,
      lockTimer: 0,
      rotVisual: 0,
    };
    board.next =
      board.queueCursor < board.pieceQueue.length
        ? ([...board.pieceQueue[board.queueCursor]] as QuadCells)
        : [CELL.EMPTY, CELL.EMPTY, CELL.EMPTY, CELL.EMPTY];
    board.garbageDroppedThisTurn = false;
    board.phase = 'falling';
    return true;
  }

  const cells = [...board.next] as QuadCells;
  board.piecesSpawned++;
  board.next = rollQuadCells(board);
  board.current = {
    col: spawnCol,
    row: 0,
    subRow: 0,
    cells,
    lockTimer: 0,
    rotVisual: 0,
  };
  board.garbageDroppedThisTurn = false;
  board.phase = 'falling';
  return true;
}

export function moveQuadX(board: PikiBoardState, dx: -1 | 1): boolean {
  if (board.toppedOut || board.phase !== 'falling' || !board.current) return false;
  const q = board.current;
  const targetCol = q.col + dx;
  const topRow = Math.floor(q.subRow);
  const botRow = Math.min(PIKI_ROWS - 2, Math.ceil(q.subRow));
  if (!canPlaceQuad(board.grid, targetCol, topRow) || !canPlaceQuad(board.grid, targetCol, botRow)) {
    return false;
  }
  q.col = targetCol;
  return true;
}

/**
 * 90-degree rotation of the 2x2 unit [TL, TR, BR, BL]:
 * dir =  1 (CW) : [BL, TL, TR, BR]
 * dir = -1 (CCW): [TR, BR, BL, TL]
 */
export function rotateQuadCells(cells: QuadCells, dir: 1 | -1): QuadCells {
  if (dir === 1) {
    return [cells[3], cells[0], cells[1], cells[2]];
  }
  return [cells[1], cells[2], cells[3], cells[0]];
}

export function rotateQuad(board: PikiBoardState, dir: 1 | -1): boolean {
  if (board.toppedOut || board.phase !== 'falling' || !board.current) return false;
  board.current.cells = rotateQuadCells(board.current.cells, dir);
  board.current.rotVisual = -dir * (Math.PI * 0.5);
  return true;
}

export function getQuadLandingRow(board: PikiBoardState, colOverride?: number): number {
  const q = board.current;
  if (!q) return 0;
  const c = colOverride ?? q.col;
  let r = Math.max(0, Math.floor(q.subRow));
  while (canPlaceQuad(board.grid, c, r + 1)) {
    r++;
  }
  return r;
}

export function lockQuad(board: PikiBoardState): void {
  const q = board.current;
  if (!q) return;
  const baseRow = Math.max(0, Math.min(PIKI_ROWS - 2, Math.floor(q.subRow)));
  const coords: readonly [number, number, CellType][] = [
    [baseRow, q.col, q.cells[0]],
    [baseRow, q.col + 1, q.cells[1]],
    [baseRow + 1, q.col + 1, q.cells[2]],
    [baseRow + 1, q.col, q.cells[3]],
  ];

  for (const [r, c, cellType] of coords) {
    if (cellType !== CELL.EMPTY && r >= 0 && r < PIKI_ROWS && c >= 0 && c < board.cols) {
      board.grid[r][c] = createCell(cellType);
    }
  }

  board.current = null;
  board.chainStep = 0;
  board.garbageDroppedThisTurn = false;
  board.phase = 'gravity';
  board.phaseTimer = 0.04;
}

export function hardDropQuad(board: PikiBoardState): number {
  if (board.toppedOut || board.phase !== 'falling' || !board.current) return 0;
  const startRow = board.current.row;
  const landRow = getQuadLandingRow(board);
  const droppedRows = Math.max(0, landRow - startRow);
  board.current.row = landRow;
  board.current.subRow = landRow;
  board.score += droppedRows * 2;
  lockQuad(board);
  return droppedRows;
}

/**
 * Collapses all unsupported cells downward row by row (column gravity).
 * Returns true if at least one cell moved.
 */
export function settleGridGravity(grid: PikiCell[][]): boolean {
  const cols = getGridCols(grid);
  let moved = false;
  for (let c = 0; c < cols; c++) {
    let writeR = PIKI_ROWS - 1;
    for (let r = PIKI_ROWS - 1; r >= 0; r--) {
      if (grid[r][c].type !== CELL.EMPTY) {
        if (r !== writeR) {
          const dist = writeR - r;
          grid[writeR][c] = {
            ...grid[r][c],
            fallOffset: Math.min(8, (grid[r][c].fallOffset || 0) + dist),
          };
          grid[r][c] = createEmptyCell();
          moved = true;
        }
        writeR--;
      }
    }
  }
  updatePikiGroupSizes(grid);
  return moved;
}

export function hasFallingCells(grid: readonly (readonly PikiCell[])[]): boolean {
  const cols = getGridCols(grid);
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type !== CELL.EMPTY && grid[r][c].fallOffset > 0.001) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes 4-neighbor connected component sizes for every awake Pikiinya (CELL.PIKI).
 * Used both for >=6 clear detection ($00:E9D0) and animated penguin mood:
 * 1 = lonely sleeping ("Zzz"), 2..3 = alert, 4..5 = excited gyrating!
 */
export function updatePikiGroupSizes(grid: PikiCell[][]): number[][][] {
  const cols = getGridCols(grid);
  const visited: boolean[][] = Array.from({ length: PIKI_ROWS }, () =>
    Array<boolean>(cols).fill(false)
  );
  const components: number[][][] = [];
  const dirs: readonly [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c].groupSize = 0;
    }
  }

  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (visited[r][c] || grid[r][c].type !== CELL.PIKI) continue;
      const queue: [number, number][] = [[r, c]];
      visited[r][c] = true;
      const comp: number[][] = [];

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        comp.push([cr, cc]);
        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (
            nr >= 0 &&
            nr < PIKI_ROWS &&
            nc >= 0 &&
            nc < cols &&
            !visited[nr][nc] &&
            grid[nr][nc].type === CELL.PIKI
          ) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }

      for (const [cr, cc] of comp) {
        grid[cr][cc].groupSize = comp.length;
      }
      components.push(comp);
    }
  }

  return components;
}

export function isIceBitSet(type: CellType): boolean {
  return type !== CELL.EMPTY && (type & 1) === 1;
}

export interface DetectedClears {
  hasClears: boolean;
  iceRows: number;
  pikiClearCells: number;
  miracleTriggered: boolean;
}

/**
 * Dual clearing detector faithful to $00:E988 (full-row Ice BIT #$01) + $00:E9D0 (6+ BFS)
 * + $00:EC6A (Miracle Bell clear) + $00:E947 (adjacent TARGET stone destruction):
 */
export function detectBoardClears(board: PikiBoardState): DetectedClears {
  const { grid, cols } = board;
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c].clearing = false;
      grid[r][c].thawing = false;
    }
  }

  const components = updatePikiGroupSizes(grid);
  let iceRows = 0;
  let pikiClearCells = 0;
  let miracleTriggered = false;

  // 1. Full-width Ice horizontal row clear ($00:E988 generalized to board.cols)
  for (let r = 0; r < PIKI_ROWS; r++) {
    let fullIce = true;
    for (let c = 0; c < cols; c++) {
      if (!isIceBitSet(grid[r][c].type)) {
        fullIce = false;
        break;
      }
    }
    if (fullIce) {
      iceRows++;
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.type === CELL.ICE) {
          cell.clearing = true;
        } else {
          // FROZEN_PIKI (3) -> PIKI (2), FROZEN_MIRACLE (7) -> MIRACLE (6)
          cell.thawing = true;
        }
      }
    }
  }

  const dirs: readonly [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  // 2. 6+ orthogonal connected Awake Pikiinya clear ($00:E9D0)
  for (const comp of components) {
    if (comp.length >= 6) {
      for (const [r, c] of comp) {
        if (!grid[r][c].clearing) {
          grid[r][c].clearing = true;
          pikiClearCells++;
        }
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < PIKI_ROWS && nc >= 0 && nc < cols) {
            if (grid[nr][nc].type === CELL.TARGET) {
              grid[nr][nc].clearing = true;
            }
          }
        }
      }
    }
  }

  // 3. Awakened Miracle Bell (6) clears every awake Pikiinya on the board ($00:EC6A)
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type === CELL.MIRACLE) {
        miracleTriggered = true;
        grid[r][c].clearing = true;
      }
    }
  }
  if (miracleTriggered) {
    for (let r = 0; r < PIKI_ROWS; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].type === CELL.PIKI) {
          if (!grid[r][c].clearing) {
            grid[r][c].clearing = true;
            pikiClearCells++;
          }
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < PIKI_ROWS && nc >= 0 && nc < cols) {
              if (grid[nr][nc].type === CELL.TARGET) {
                grid[nr][nc].clearing = true;
              }
            }
          }
        }
      }
    }
  }

  let hasAnyMark = false;
  for (let r = 0; r < PIKI_ROWS && !hasAnyMark; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].clearing || grid[r][c].thawing) {
        hasAnyMark = true;
        break;
      }
    }
  }

  return { hasClears: hasAnyMark, iceRows, pikiClearCells, miracleTriggered };
}

function addParticle(board: PikiBoardState, p: PikiParticle): void {
  if (board.particles.length < 180) {
    board.particles.push(p);
  }
}

function addPopup(board: PikiBoardState, p: PikiPopup): void {
  if (board.popups.length < 24) {
    board.popups.push(p);
  }
}

export function isBoardCompletelyEmpty(grid: readonly (readonly PikiCell[])[]): boolean {
  const cols = getGridCols(grid);
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type !== CELL.EMPTY) return false;
    }
  }
  return true;
}

export function countRemainingTargets(grid: readonly (readonly PikiCell[])[]): number {
  const cols = getGridCols(grid);
  let count = 0;
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type === CELL.TARGET) count++;
    }
  }
  return count;
}

export function countRemainingPikiOrTargets(grid: readonly (readonly PikiCell[])[]): number {
  const cols = getGridCols(grid);
  let count = 0;
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c].type;
      if (t === CELL.PIKI || t === CELL.FROZEN_PIKI || t === CELL.TARGET) count++;
    }
  }
  return count;
}

/**
 * Transitions thawed/cleared cells via $00:E853, awards score/chain/All-Clear,
 * and sends/counters VS garbage.
 */
export function resolveClearPhase(
  board: PikiBoardState,
  opponent?: PikiBoardState | null,
  emitVfx = true
): ClearSummary {
  const { grid, cols } = board;
  let fullIceRows = 0;
  let clearedIceCells = 0;
  let thawedCount = 0;
  let thawedMiracles = 0;
  let clearedPiki = 0;
  let clearedTargets = 0;
  let clearedMiracles = 0;

  let avgCol = 0;
  let avgRow = 0;
  let totalAffected = 0;

  for (let r = 0; r < PIKI_ROWS; r++) {
    let rowWasIceClear = true;
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.clearing && !cell.thawing) {
        rowWasIceClear = false;
      } else if (cell.type === CELL.PIKI || cell.type === CELL.TARGET || cell.type === CELL.MIRACLE) {
        rowWasIceClear = false;
      }
    }
    if (rowWasIceClear) fullIceRows++;

    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.clearing && !cell.thawing) continue;

      avgCol += c + 0.5;
      avgRow += r + 0.5;
      totalAffected++;

      if (cell.thawing) {
        if (cell.type === CELL.FROZEN_MIRACLE) {
          cell.type = CELL.MIRACLE;
          cell.excitedTimer = 1.1;
          thawedMiracles++;
        } else {
          // 3 (Frozen Pikiinya) -> 2 (Awake Pikiinya) per $00:E853
          cell.type = CELL.PIKI;
          cell.excitedTimer = 1.25;
          thawedCount++;
        }
        cell.thawing = false;
        cell.clearing = false;
        if (emitVfx) {
          for (let k = 0; k < 4; k++) {
            const ang = (Math.PI * 2 * k) / 4 + 0.4;
            addParticle(board, {
              x: c + 0.5,
              y: r + 0.5,
              vx: Math.cos(ang) * 2.2,
              vy: Math.sin(ang) * 2.2 - 0.8,
              color: '#7dd3fc',
              size: 4,
              life: 0.42,
              maxLife: 0.42,
            });
          }
        }
      } else if (cell.clearing) {
        if (cell.type === CELL.ICE) clearedIceCells++;
        else if (cell.type === CELL.PIKI) clearedPiki++;
        else if (cell.type === CELL.TARGET) clearedTargets++;
        else if (cell.type === CELL.MIRACLE) clearedMiracles++;

        if (emitVfx) {
          const burstColor =
            cell.type === CELL.ICE
              ? '#bae6fd'
              : cell.type === CELL.TARGET
                ? '#fca5a5'
                : cell.type === CELL.MIRACLE
                  ? '#fde047'
                  : '#38bdf8';
          for (let k = 0; k < 5; k++) {
            const ang = (Math.PI * 2 * k) / 5 + (r + c) * 0.3;
            addParticle(board, {
              x: c + 0.5,
              y: r + 0.5,
              vx: Math.cos(ang) * 2.8,
              vy: Math.sin(ang) * 2.8 - 1.0,
              color: burstColor,
              size: cell.type === CELL.PIKI ? 5 : 4,
              life: 0.48,
              maxLife: 0.48,
            });
          }
        }

        grid[r][c] = createEmptyCell();
      }
    }
  }

  const allClear = totalAffected > 0 && isBoardCompletelyEmpty(grid);
  if (allClear) {
    board.allClears++;
  }

  const chainMult = Math.max(1, board.chainStep);
  const pikiExtra = clearedPiki > 6 ? (clearedPiki - 6) * 60 : 0;
  const gained =
    (clearedIceCells * 40 +
      thawedCount * 85 +
      clearedPiki * 120 +
      pikiExtra +
      clearedTargets * 260 +
      (thawedMiracles + clearedMiracles) * 800) *
      chainMult +
    (allClear ? 5000 : 0);

  board.score += gained;
  board.clearedPikiCount += clearedPiki;
  board.clearedTargetCount += clearedTargets;
  board.iceRowsCleared += fullIceRows;

  // Attack strength derived from chain step ($54) + extra cleared size ($55) + ice rows + All-Clear
  let attack = 0;
  if (totalAffected > 0) {
    const chainAtk = board.chainStep >= 2 ? (board.chainStep - 1) * 3 : 0;
    const pikiAtk = clearedPiki >= 6 ? 2 + Math.floor((clearedPiki - 6) / 2) : 0;
    const iceAtk = fullIceRows * 2;
    const targetAtk = clearedTargets;
    const allClearAtk = allClear ? 6 : 0;
    attack = chainAtk + pikiAtk + iceAtk + targetAtk + allClearAtk;
  }

  const netSent = applyGarbageAttack(board, opponent ?? null, attack);

  if (emitVfx && totalAffected > 0) {
    const cx = avgCol / totalAffected;
    const cy = avgRow / totalAffected;
    if (allClear) {
      addPopup(board, {
        x: cols * 0.5,
        y: PIKI_ROWS * 0.45,
        text: 'ALL CLEAR! +5000',
        color: '#fde047',
        life: 1.4,
        maxLife: 1.4,
      });
    } else if (board.chainStep >= 2) {
      addPopup(board, {
        x: cx,
        y: cy,
        text: `${board.chainStep}x CHAIN!`,
        color: '#f472b6',
        life: 1.0,
        maxLife: 1.0,
      });
    } else if (clearedPiki >= 6) {
      addPopup(board, {
        x: cx,
        y: cy,
        text: `${clearedPiki} PIKI CLEAR!`,
        color: '#fde047',
        life: 0.9,
        maxLife: 0.9,
      });
    } else if (thawedCount > 0) {
      addPopup(board, {
        x: cx,
        y: cy,
        text: `THAWED x${thawedCount}!`,
        color: '#7dd3fc',
        life: 0.8,
        maxLife: 0.8,
      });
    }
  }

  updatePikiGroupSizes(grid);

  const summary: ClearSummary = {
    iceRows: fullIceRows,
    thawedCount,
    thawedMiracles,
    clearedPiki,
    clearedTargets,
    clearedMiracles,
    allClear,
    garbageSent: netSent,
  };
  board.lastClearSummary = summary;
  return summary;
}

export function applyGarbageAttack(
  attacker: PikiBoardState,
  defender: PikiBoardState | null,
  rawAttack: number
): number {
  if (rawAttack <= 0) return 0;
  let remaining = rawAttack;
  if (attacker.pendingGarbage > 0) {
    const offset = Math.min(attacker.pendingGarbage, remaining);
    attacker.pendingGarbage -= offset;
    remaining -= offset;
  }
  if (remaining > 0 && defender && defender.isVsMode) {
    defender.pendingGarbage = Math.min(defender.cols * 6, defender.pendingGarbage + remaining);
    return remaining;
  }
  return 0;
}

/**
 * Drops up to board.cols pending garbage blocks (Ice & Frozen Pikiinya mix) onto the top
 * of the board before spawning the next falling quad ($00:E022).
 */
export function dropPendingGarbage(board: PikiBoardState): number {
  if (!board.isVsMode || board.pendingGarbage <= 0) return 0;
  const boardCols = board.cols;
  const count = Math.min(boardCols, board.pendingGarbage);
  board.pendingGarbage -= count;

  // Build shuffled column order using PRNG
  const cols = Array.from({ length: boardCols }, (_, i) => i);
  for (let i = cols.length - 1; i > 0; i--) {
    board.rngState = nextRngUint32(board.rngState);
    const j = board.rngState % (i + 1);
    const tmp = cols[i];
    cols[i] = cols[j];
    cols[j] = tmp;
  }

  let dropped = 0;
  for (let i = 0; i < count; i++) {
    const col = cols[i];
    // Drop into lowest available empty cell in the column so it settles cleanly
    let placeR = -1;
    for (let r = PIKI_ROWS - 1; r >= 0; r--) {
      if (board.grid[r][col].type === CELL.EMPTY) {
        placeR = r;
        break;
      }
    }
    if (placeR < 0) {
      // Column completely full to ceiling
      board.toppedOut = true;
      continue;
    }

    board.rngState = nextRngUint32(board.rngState);
    const garbageType: CellType =
      board.rngState % 6 === 0
        ? CELL.PIKI
        : board.rngState % 2 === 0
          ? CELL.ICE
          : CELL.FROZEN_PIKI;
    board.grid[placeR][col] = {
      ...createCell(garbageType),
      fallOffset: Math.min(6, placeR + 1),
    };
    dropped++;
  }

  updatePikiGroupSizes(board.grid);
  return dropped;
}

export interface StepEvents {
  locked: boolean;
  cleared: ClearSummary | null;
  spawned: boolean;
  garbageDropped: number;
  miracleAwakened: boolean;
}

/**
 * Advances one board frame cleanly through falling -> gravity -> clearing -> spawn.
 */
export function stepBoard(
  board: PikiBoardState,
  dt: number,
  fallSpeedRowsPerSec: number,
  options?: {
    opponent?: PikiBoardState | null;
    softDropping?: boolean;
    preventAutoSpawn?: boolean;
  }
): StepEvents {
  const events: StepEvents = {
    locked: false,
    cleared: null,
    spawned: false,
    garbageDropped: 0,
    miracleAwakened: false,
  };

  board.elapsedTime += dt;

  // Decay visual timers
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.grid[r][c];
      if (cell.excitedTimer > 0) {
        cell.excitedTimer = Math.max(0, cell.excitedTimer - dt);
      }
      if (cell.fallOffset > 0) {
        cell.fallOffset = Math.max(0, cell.fallOffset - dt * 22);
      }
    }
  }

  for (let i = board.particles.length - 1; i >= 0; i--) {
    const p = board.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 6.5 * dt;
    p.life -= dt;
    if (p.life <= 0) board.particles.splice(i, 1);
  }
  for (let i = board.popups.length - 1; i >= 0; i--) {
    const pop = board.popups[i];
    pop.y -= 0.9 * dt;
    pop.life -= dt;
    if (pop.life <= 0) board.popups.splice(i, 1);
  }

  if (board.toppedOut) return events;

  if (board.phase === 'falling') {
    const q = board.current;
    if (!q) return events;

    if (Math.abs(q.rotVisual) > 0.01) {
      q.rotVisual *= Math.max(0, 1 - dt * 18);
    } else {
      q.rotVisual = 0;
    }

    const mult = options?.softDropping ? 4.5 : 1.0;
    const speed = Math.max(1.2, fallSpeedRowsPerSec * mult);
    const nextSubRow = q.subRow + speed * dt;
    const nextIntRow = Math.floor(nextSubRow);

    if (canPlaceQuad(board.grid, q.col, nextIntRow) && canPlaceQuad(board.grid, q.col, Math.ceil(nextSubRow))) {
      q.subRow = nextSubRow;
      q.row = Math.floor(q.subRow);
      q.lockTimer = 0;
    } else {
      // Snap cleanly onto highest supported integer row
      const landRow = getQuadLandingRow(board);
      const maxValidSub = Math.min(nextSubRow, landRow);
      q.subRow = maxValidSub;
      q.row = landRow;
      q.lockTimer += dt * (options?.softDropping ? 2.5 : 1.0);
      if (q.lockTimer >= 0.24) {
        lockQuad(board);
        events.locked = true;
      }
    }
    return events;
  }

  if (board.phase === 'gravity') {
    board.phaseTimer -= dt;
    if (board.phaseTimer > 0) return events;

    settleGridGravity(board.grid);
    if (hasFallingCells(board.grid)) {
      return events;
    }

    const detected = detectBoardClears(board);
    if (detected.hasClears) {
      board.chainStep++;
      if (board.chainStep > board.maxChain) {
        board.maxChain = board.chainStep;
      }
      if (detected.miracleTriggered) {
        events.miracleAwakened = true;
      }
      board.phase = 'clearing';
      board.phaseTimer = 0.26;
      return events;
    }

    if (
      !options?.preventAutoSpawn &&
      board.isVsMode &&
      board.pendingGarbage > 0 &&
      !board.garbageDroppedThisTurn
    ) {
      board.garbageDroppedThisTurn = true;
      board.chainStep = 0;
      events.garbageDropped = dropPendingGarbage(board);
      if (events.garbageDropped > 0) {
        settleGridGravity(board.grid);
        return events;
      }
    }

    // Settled with no more clears!
    if (isBoardToppedOut(board.grid)) {
      board.toppedOut = true;
      return events;
    }

    if (!options?.preventAutoSpawn) {
      events.spawned = spawnNextQuad(board);
    } else {
      board.phase = 'falling';
    }
    return events;
  }

  if (board.phase === 'clearing') {
    board.phaseTimer -= dt;
    if (board.phaseTimer > 0) return events;

    const summary = resolveClearPhase(board, options?.opponent ?? null, true);
    events.cleared = summary;
    board.phase = 'gravity';
    board.phaseTimer = 0.14;
    return events;
  }

  return events;
}

/**
 * Synchronously settles gravity + clears until the board reaches rest.
 * Useful for AI lookahead and deterministic unit tests.
 */
export function resolveAllCascadesSync(
  board: PikiBoardState,
  opponent?: PikiBoardState | null
): ClearSummary[] {
  const summaries: ClearSummary[] = [];
  for (let guard = 0; guard < 32; guard++) {
    settleGridGravity(board.grid);
    const detected = detectBoardClears(board);
    if (!detected.hasClears) break;
    board.chainStep++;
    if (board.chainStep > board.maxChain) {
      board.maxChain = board.chainStep;
    }
    summaries.push(resolveClearPhase(board, opponent ?? null, false));
  }
  settleGridGravity(board.grid);
  return summaries;
}
