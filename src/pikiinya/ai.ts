import {
  CELL,
  PIKI_ROWS,
  PIKI_SPAWN_ROWS,
  type CpuOpponentProfile,
  type PikiBoardState,
} from './types.ts';
import {
  cloneBoardState,
  getSpawnCol,
  hardDropQuad,
  isIceBitSet,
  moveQuadX,
  nextRngUint32,
  resolveAllCascadesSync,
  rotateQuad,
  updatePikiGroupSizes,
} from './core.ts';

export interface CpuMoveTarget {
  col: number;
  rot: number; // 0..3 CW rotations
  score: number;
}

export interface CpuControllerState {
  target: CpuMoveTarget | null;
  forPieceIndex: number;
  thinkCooldown: number;
  moveClock: number;
  rotationsLeft: number;
  rngState: number;
}

export function createCpuController(seed = 8881997): CpuControllerState {
  return {
    target: null,
    forPieceIndex: -1,
    thinkCooldown: 0.25,
    moveClock: 0,
    rotationsLeft: 0,
    rngState: seed >>> 0 || 8881997,
  };
}

function measureColumnHeights(board: PikiBoardState): number[] {
  const cols = board.cols;
  const heights = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < PIKI_ROWS; r++) {
      if (board.grid[r][c].type !== CELL.EMPTY) {
        heights[c] = PIKI_ROWS - r;
        break;
      }
    }
  }
  return heights;
}

function evaluateResultingBoard(
  beforePendingGarbage: number,
  sim: PikiBoardState,
  summaries: readonly ReturnType<typeof resolveAllCascadesSync>[number][],
  profile: CpuOpponentProfile
): number {
  let score = 0;
  const cols = sim.cols;
  const sc = getSpawnCol(cols);
  const heights = measureColumnHeights(sim);
  const maxHeight = Math.max(...heights);

  // Check top-out hazard in spawn/ceiling rows 0..1
  for (let r = 0; r < PIKI_SPAWN_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (sim.grid[r][c].type !== CELL.EMPTY) {
        return -90000 - r * 1000;
      }
    }
  }
  if (sim.grid[2][sc].type !== CELL.EMPTY || sim.grid[2][sc + 1].type !== CELL.EMPTY) {
    score -= 18000;
  }

  let clearedPiki = 0;
  let clearedTargets = 0;
  let iceRows = 0;
  let thawed = 0;
  let garbageSent = 0;
  let allClear = false;
  for (const s of summaries) {
    clearedPiki += s.clearedPiki;
    clearedTargets += s.clearedTargets;
    iceRows += s.iceRows;
    thawed += s.thawedCount;
    garbageSent += s.garbageSent;
    if (s.allClear) allClear = true;
  }

  const emergencyDig = maxHeight >= 8 || beforePendingGarbage >= 4 ? 1.85 : 1.0;

  const garbageOffset = Math.max(0, beforePendingGarbage - sim.pendingGarbage);

  // 1. Immediate cascade, clear & attack score
  if (summaries.length > 0) {
    const chainBonus = sim.chainStep >= 2 ? sim.chainStep * sim.chainStep * 480 * profile.chainWeight : 0;
    score +=
      (clearedPiki * 240 +
        iceRows * 340 +
        clearedTargets * 280 +
        thawed * 150 +
        (garbageSent + garbageOffset) * 140 +
        chainBonus +
        (allClear ? 5000 : 0)) *
      emergencyDig;
  }

  // 2. Almost-full Ice row setups & Pikiinya group potentials
  for (let r = PIKI_SPAWN_ROWS; r < PIKI_ROWS; r++) {
    let iceBits = 0;
    let blocked = false;
    for (let c = 0; c < cols; c++) {
      const t = sim.grid[r][c].type;
      if (isIceBitSet(t)) {
        iceBits++;
      } else if (t !== CELL.EMPTY) {
        blocked = true;
      }
    }
    if (!blocked) {
      if (iceBits === cols - 1) score += 190 * emergencyDig;
      else if (iceBits === cols - 2) score += 75;
    } else if (iceBits >= cols - 2) {
      score += 18;
    }
  }

  // 3. Connected Pikiinya cluster evaluation + adjacent Frozen Pikiinya thaw synergy
  updatePikiGroupSizes(sim.grid);
  const dirs: readonly [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = sim.grid[r][c];
      if (cell.type === CELL.PIKI) {
        const gs = cell.groupSize;
        if (gs >= 4) score += gs * 11 * Math.min(1.5, profile.chainWeight);
        else if (gs >= 2) score += gs * 9;
        else score -= 8;
      } else if (cell.type === CELL.FROZEN_PIKI) {
        let bestAdj = 0;
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < PIKI_ROWS && nc >= 0 && nc < cols) {
            if (sim.grid[nr][nc].type === CELL.PIKI) {
              bestAdj = Math.max(bestAdj, sim.grid[nr][nc].groupSize);
            }
          }
        }
        score += 18 + bestAdj * 18 * Math.min(1.5, profile.chainWeight);
      }
    }
  }

  // 4. Stack height & bumpiness penalties
  let heightPenalty = 0;
  let bumpiness = 0;
  for (let c = 0; c < cols; c++) {
    heightPenalty += heights[c] * heights[c] * (c === sc || c === sc + 1 ? 6.5 : 4.0);
    if (c > 0) {
      bumpiness += Math.abs(heights[c] - heights[c - 1]) * 18;
    }
  }
  score -= heightPenalty + bumpiness;

  return score;
}

export function chooseCpuPlacement(
  board: PikiBoardState,
  profile: CpuOpponentProfile,
  rngSeed?: number
): CpuMoveTarget {
  const candidates: CpuMoveTarget[] = [];
  const startQuad = board.current;
  const fallbackCol = getSpawnCol(board.cols);
  if (!startQuad) {
    return { col: fallbackCol, rot: 0, score: 0 };
  }

  for (let rot = 0; rot < 4; rot++) {
    for (let col = 0; col <= board.cols - 2; col++) {
      const sim = cloneBoardState(board);
      sim.chainStep = 0;
      for (let r = 0; r < rot; r++) {
        rotateQuad(sim, 1);
      }
      const dx = col - sim.current!.col;
      let reachable = true;
      for (let m = 0; m < Math.abs(dx); m++) {
        if (!moveQuadX(sim, dx > 0 ? 1 : -1)) {
          reachable = false;
          break;
        }
      }
      if (!reachable) continue;

      hardDropQuad(sim);
      const summaries = resolveAllCascadesSync(sim, null);
      const score = evaluateResultingBoard(board.pendingGarbage, sim, summaries, profile);
      candidates.push({ col, rot, score });
    }
  }

  if (candidates.length === 0) {
    return { col: fallbackCol, rot: 0, score: -99999 };
  }

  candidates.sort((a, b) => b.score - a.score);

  if (profile.mistakeRate > 0 && candidates.length > 1) {
    const roll = ((nextRngUint32(rngSeed ?? board.rngState) % 1000) / 1000);
    if (roll < profile.mistakeRate) {
      const altIdx = candidates.length > 2 && roll < profile.mistakeRate * 0.4 ? 2 : 1;
      return candidates[Math.min(altIdx, candidates.length - 1)];
    }
  }

  return candidates[0];
}

export interface CpuStepResult {
  moved: boolean;
  rotated: boolean;
  dropped: boolean;
  softDropping: boolean;
}

export function stepCpuAgent(
  cpuBoard: PikiBoardState,
  ctrl: CpuControllerState,
  profile: CpuOpponentProfile,
  dt: number
): CpuStepResult {
  const res: CpuStepResult = {
    moved: false,
    rotated: false,
    dropped: false,
    softDropping: false,
  };

  if (cpuBoard.toppedOut || cpuBoard.phase !== 'falling' || !cpuBoard.current) {
    ctrl.target = null;
    return res;
  }

  if (ctrl.forPieceIndex !== cpuBoard.piecesSpawned || !ctrl.target) {
    ctrl.rngState = nextRngUint32(ctrl.rngState);
    ctrl.target = chooseCpuPlacement(cpuBoard, profile, ctrl.rngState);
    ctrl.forPieceIndex = cpuBoard.piecesSpawned;
    ctrl.rotationsLeft = ctrl.target.rot;
    ctrl.thinkCooldown = profile.thinkPause;
    ctrl.moveClock = 0;
  }

  if (ctrl.thinkCooldown > 0) {
    ctrl.thinkCooldown -= dt;
    return res;
  }

  ctrl.moveClock += dt;
  if (ctrl.moveClock >= profile.moveInterval) {
    ctrl.moveClock -= profile.moveInterval;

    if (ctrl.rotationsLeft > 0) {
      if (rotateQuad(cpuBoard, 1)) {
        ctrl.rotationsLeft--;
        res.rotated = true;
      }
      return res;
    }

    const q = cpuBoard.current;
    if (q.col < ctrl.target.col) {
      if (moveQuadX(cpuBoard, 1)) {
        res.moved = true;
        return res;
      }
    } else if (q.col > ctrl.target.col) {
      if (moveQuadX(cpuBoard, -1)) {
        res.moved = true;
        return res;
      }
    }

    // Aligned cleanly! High tiers hard-drop once positioned, early tiers soft-drop fast
    if (profile.stageNumber >= 4 && q.subRow >= 1.2) {
      hardDropQuad(cpuBoard);
      res.dropped = true;
      return res;
    }
  }

  if (ctrl.rotationsLeft === 0 && cpuBoard.current && cpuBoard.current.col === ctrl.target.col) {
    res.softDropping = true;
  }

  return res;
}
