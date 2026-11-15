import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL,
  PIKI_COLS,
  PIKI_ROWS,
  type PikiBoardState,
  type QuadCells,
} from '../src/pikiinya/types.ts';
import {
  ROM_PIECE_TABLE_D54A,
  applyGarbageAttack,
  cloneBoardState,
  countRemainingPikiOrTargets,
  countRemainingTargets,
  createBoardState,
  createEmptyGrid,
  detectBoardClears,
  dropPendingGarbage,
  getSpawnCol,
  hardDropQuad,
  hasFallingCells,
  isBoardCompletelyEmpty,
  isIceBitSet,
  loadGridFromMatrix,
  moveQuadX,
  resolveAllCascadesSync,
  resolveClearPhase,
  rotateQuad,
  rotateQuadCells,
  settleGridGravity,
  spawnNextQuad,
  stepBoard,
  updatePikiGroupSizes,
} from '../src/pikiinya/core.ts';
import {
  PIKI_PUZZLES,
  STAGE_CLEAR_LEVELS,
  STORY_RIVALS,
  TUTORIAL_STEPS,
  getStoryRivalProfile,
} from '../src/pikiinya/modes.ts';
import { chooseCpuPlacement } from '../src/pikiinya/ai.ts';

function emptyMatrix(rows: number = PIKI_ROWS): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(PIKI_COLS).fill(0));
}

function solveWithBfs(
  startBoard: PikiBoardState,
  isGoal: (b: PikiBoardState) => boolean
): boolean {
  if (isGoal(startBoard)) return true;
  const maxDepth = Math.max(1, startBoard.pieceQueue.length);
  const queue: { board: PikiBoardState; depth: number }[] = [
    { board: cloneBoardState(startBoard), depth: 0 },
  ];

  while (queue.length > 0) {
    const { board, depth } = queue.shift()!;
    if (depth >= maxDepth || !board.current) continue;

    for (let rot = 0; rot < 4; rot++) {
      for (let col = 0; col <= PIKI_COLS - 2; col++) {
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
        resolveAllCascadesSync(sim, null);
        if (isGoal(sim)) {
          return true;
        }
        spawnNextQuad(sim);
        if (!sim.toppedOut && sim.current && depth + 1 < maxDepth) {
          queue.push({ board: sim, depth: depth + 1 });
        }
      }
    }
  }
  return false;
}

test('ROM piece table $00:D54A has exact 32-byte distribution and 100th-piece Miracle Bell', () => {
  assert.equal(ROM_PIECE_TABLE_D54A.length, 32);
  let piki = 0;
  let ice = 0;
  let frozen = 0;
  let target = 0;
  for (const t of ROM_PIECE_TABLE_D54A) {
    if (t === CELL.PIKI) piki++;
    else if (t === CELL.ICE) ice++;
    else if (t === CELL.FROZEN_PIKI) frozen++;
    else if (t === CELL.TARGET) target++;
  }
  assert.equal(piki, 15);
  assert.equal(ice, 8);
  assert.equal(frozen, 8);
  assert.equal(target, 1);

  const board = createBoardState(1997, { allowMiracleItem: true, allowTargetInRandom: true });
  while (board.piecesSpawned < 99) {
    hardDropQuad(board);
    // Keep rows clean so we reach the 100th piece cleanly without topping out
    for (let r = 0; r < PIKI_ROWS; r++) {
      for (let c = 0; c < PIKI_COLS; c++) {
        board.grid[r][c].type = CELL.EMPTY;
      }
    }
    spawnNextQuad(board);
  }
  assert.equal(board.piecesSpawned, 99);
  hardDropQuad(board);
  spawnNextQuad(board);
  assert.equal(board.piecesSpawned, 100);
  assert.ok(board.next.includes(CELL.FROZEN_MIRACLE));
});

test('2x2 Quad rotation rotates [TL, TR, BR, BL] faithfully CW and CCW', () => {
  const start: QuadCells = [CELL.ICE, CELL.PIKI, CELL.FROZEN_PIKI, CELL.TARGET];
  const cw = rotateQuadCells(start, 1);
  assert.deepEqual(cw, [CELL.TARGET, CELL.ICE, CELL.PIKI, CELL.FROZEN_PIKI]);

  const ccw = rotateQuadCells(start, -1);
  assert.deepEqual(ccw, [CELL.PIKI, CELL.FROZEN_PIKI, CELL.TARGET, CELL.ICE]);

  assert.deepEqual(rotateQuadCells(cw, -1), start);

  let rot = start;
  for (let i = 0; i < 4; i++) rot = rotateQuadCells(rot, 1);
  assert.deepEqual(rot, start);
});

test('6-column Ice Row Clear breaks Ice and thaws Frozen Pikiinyas & Frozen Miracles, while 5-col Ice does not', () => {
  const incomplete = emptyMatrix(2);
  incomplete[1] = [CELL.ICE, CELL.FROZEN_PIKI, CELL.ICE, CELL.ICE, CELL.FROZEN_PIKI, CELL.PIKI];
  const b1 = createBoardState(101, { initialGrid: incomplete });
  const det1 = detectBoardClears(b1);
  assert.equal(det1.hasClears, false);
  assert.equal(det1.iceRows, 0);

  const complete = emptyMatrix(2);
  complete[1] = [
    CELL.ICE,
    CELL.FROZEN_PIKI,
    CELL.ICE,
    CELL.FROZEN_MIRACLE,
    CELL.ICE,
    CELL.FROZEN_PIKI,
  ];
  const b2 = createBoardState(102, { initialGrid: complete });
  const det2 = detectBoardClears(b2);
  assert.equal(det2.hasClears, true);
  assert.equal(det2.iceRows, 1);

  const summary = resolveClearPhase(b2, null, false);
  assert.equal(summary.iceRows, 1);
  assert.equal(summary.thawedCount, 2);
  assert.equal(summary.thawedMiracles, 1);
  assert.equal(b2.grid[PIKI_ROWS - 1][0].type, CELL.EMPTY);
  assert.equal(b2.grid[PIKI_ROWS - 1][1].type, CELL.PIKI);
  assert.equal(b2.grid[PIKI_ROWS - 1][3].type, CELL.MIRACLE);
  assert.equal(b2.grid[PIKI_ROWS - 1][5].type, CELL.PIKI);
});

test('4-neighbor BFS requires 6+ connected Awake Pikiinyas and breaks only orthogonally adjacent Target Cages', () => {
  const five = emptyMatrix(3);
  five[2] = [CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.EMPTY];
  const b5 = createBoardState(201, { initialGrid: five });
  updatePikiGroupSizes(b5.grid);
  assert.equal(b5.grid[PIKI_ROWS - 1][0].groupSize, 5);
  assert.equal(detectBoardClears(b5).hasClears, false);

  // Diagonal target is untouched while orthogonal target breaks when 6 Pikiinyas connect
  const sixWithTargets = emptyMatrix(3);
  sixWithTargets[2] = [CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.TARGET];
  sixWithTargets[1] = [CELL.PIKI, 0, 0, 0, 0, 0];
  sixWithTargets[0] = [0, 0, 0, 0, 0, CELL.TARGET];
  const b6 = createBoardState(202, { initialGrid: sixWithTargets });
  const det6 = detectBoardClears(b6);
  assert.equal(det6.hasClears, true);
  assert.equal(det6.pikiClearCells, 6);

  const summary = resolveClearPhase(b6, null, false);
  assert.equal(summary.clearedPiki, 6);
  assert.equal(summary.clearedTargets, 1);
  assert.equal(countRemainingTargets(b6.grid), 1);
  assert.equal(b6.grid[PIKI_ROWS - 3][5].type, CELL.TARGET);
});

test('Thaw-into-Chain produces 2x Cascade and triggers All-Clear bonus when board empties', () => {
  const cascadeGrid = [
    [0, CELL.PIKI, CELL.PIKI, CELL.PIKI, 0, 0],
    [CELL.ICE, CELL.FROZEN_PIKI, CELL.FROZEN_PIKI, CELL.FROZEN_PIKI, CELL.ICE, CELL.ICE],
  ];
  const p1 = createBoardState(301, { initialGrid: cascadeGrid, isVsMode: true });
  const p2 = createBoardState(302, { isVsMode: true });

  const summaries = resolveAllCascadesSync(p1, p2);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].iceRows, 1);
  assert.equal(summaries[0].thawedCount, 3);
  assert.equal(summaries[1].clearedPiki, 6);
  assert.equal(summaries[1].allClear, true);
  assert.equal(p1.maxChain, 2);
  assert.equal(p1.allClears, 1);
  assert.ok(isBoardCompletelyEmpty(p1.grid));
  assert.ok(p2.pendingGarbage > 0);
});

test('Awakened Miracle Bell sweeps all Awake Pikiinyas and orthogonally touching Target Cages', () => {
  const miracleGrid = [
    [CELL.PIKI, CELL.EMPTY, CELL.TARGET, CELL.PIKI, 0, 0],
    [CELL.MIRACLE, CELL.ICE, CELL.PIKI, CELL.EMPTY, CELL.PIKI, 0],
  ];
  const board = createBoardState(401, { initialGrid: miracleGrid });
  const det = detectBoardClears(board);
  assert.equal(det.hasClears, true);
  assert.equal(det.miracleTriggered, true);

  const summary = resolveClearPhase(board, null, false);
  assert.equal(summary.clearedMiracles, 1);
  assert.equal(summary.clearedPiki, 4);
  assert.equal(summary.clearedTargets, 1);
  assert.equal(board.grid[PIKI_ROWS - 1][1].type, CELL.ICE);
});

test('VS garbage attack offsets attacker pending garbage before queueing onto defender and drops max 6 per turn', () => {
  const attacker = createBoardState(501, { isVsMode: true });
  const defender = createBoardState(502, { isVsMode: true });
  attacker.pendingGarbage = 5;

  const sent = applyGarbageAttack(attacker, defender, 8);
  assert.equal(attacker.pendingGarbage, 0);
  assert.equal(sent, 3);
  assert.equal(defender.pendingGarbage, 3);

  defender.pendingGarbage = 9;
  const dropped = dropPendingGarbage(defender);
  assert.equal(dropped, 6);
  assert.equal(defender.pendingGarbage, 3);
  settleGridGravity(defender.grid);

  let occupied = 0;
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < PIKI_COLS; c++) {
      if (defender.grid[r][c].type !== CELL.EMPTY) occupied++;
    }
  }
  assert.equal(occupied, 6);
});

test('All 16 Stage Clear levels (8 Omote + 8 Ura) have targets and zero floating cells', () => {
  assert.equal(STAGE_CLEAR_LEVELS.length, 16);
  for (const stage of STAGE_CLEAR_LEVELS) {
    assert.ok(stage.grid.length > 0, `${stage.id} must have grid rows`);
    const rows = stage.grid.length;
    let targets = 0;
    for (let r = 0; r < rows; r++) {
      assert.equal(stage.grid[r].length, PIKI_COLS, `${stage.id} row ${r} must be 6 cols`);
      for (let c = 0; c < PIKI_COLS; c++) {
        const val = stage.grid[r][c];
        if (val === CELL.TARGET) targets++;
        if (val !== CELL.EMPTY && r < rows - 1) {
          assert.notEqual(
            stage.grid[r + 1][c],
            CELL.EMPTY,
            `${stage.id} has floating cell at r=${r}, c=${c}`
          );
        }
      }
    }
    assert.ok(targets > 0, `${stage.id} must contain Target cages`);
  }
});

test('All 8 Brain-Teaser puzzles and 4 Tutorial steps are solvable via legal BFS moves', () => {
  assert.equal(PIKI_PUZZLES.length, 8);
  for (const puz of PIKI_PUZZLES) {
    const start = createBoardState(1997, {
      initialGrid: puz.grid,
      queue: puz.pieceQueue,
      allowTargetInRandom: false,
      allowMiracleItem: false,
    });
    const solved = solveWithBfs(start, (b) => countRemainingPikiOrTargets(b.grid) === 0);
    assert.equal(solved, true, `Puzzle ${puz.id} must be solvable`);
  }

  // Ensure puz-2 rejects an unrotated far-left column drop at col=0
  const puz2 = PIKI_PUZZLES[1];
  const bad = createBoardState(1997, {
    initialGrid: puz2.grid,
    queue: puz2.pieceQueue,
    allowTargetInRandom: false,
    allowMiracleItem: false,
  });
  moveQuadX(bad, -1);
  moveQuadX(bad, -1);
  hardDropQuad(bad);
  resolveAllCascadesSync(bad, null);
  assert.ok(countRemainingPikiOrTargets(bad.grid) > 0, 'Wrong placement at col 0 on puz-2 should not clear');

  assert.equal(TUTORIAL_STEPS.length, 4);
  for (const tut of TUTORIAL_STEPS) {
    const start = createBoardState(1997, {
      initialGrid: tut.grid,
      queue: tut.pieceQueue,
      allowTargetInRandom: false,
      allowMiracleItem: false,
    });
    const passed = solveWithBfs(start, tut.checkGoal);
    assert.equal(passed, true, `Tutorial ${tut.id} must be passable`);
  }
});

test('Story rivals & chooseCpuPlacement pick winning 6-Piki clear placements when mistakeRate is 0', () => {
  assert.equal(STORY_RIVALS.length, 8);
  const s0 = getStoryRivalProfile(0);
  const s7 = getStoryRivalProfile(7);
  const s8 = getStoryRivalProfile(8);
  assert.equal(s0.stageNumber, 1);
  assert.equal(s7.stageNumber, 8);
  assert.equal(s7.shortName, 'SLAGGER');
  assert.ok(s7.fallSpeed > s0.fallSpeed);
  assert.equal(s8.stageNumber, 9);
  assert.ok(s8.name.startsWith('★'));

  const profile = { ...s7, mistakeRate: 0 };
  const board = createBoardState(601, {
    initialGrid: [
      [0, 0, CELL.PIKI, CELL.PIKI, 0, 0],
      [0, 0, CELL.PIKI, CELL.PIKI, 0, 0],
    ],
    queue: [[CELL.ICE, CELL.ICE, CELL.PIKI, CELL.PIKI]],
    isVsMode: true,
  });

  const move = chooseCpuPlacement(board, profile, 123);
  const verify = cloneBoardState(board);
  for (let r = 0; r < move.rot; r++) rotateQuad(verify, 1);
  const dx = move.col - verify.current!.col;
  for (let m = 0; m < Math.abs(dx); m++) moveQuadX(verify, dx > 0 ? 1 : -1);
  hardDropQuad(verify);
  const summaries = resolveAllCascadesSync(verify, null);
  assert.ok(summaries.length >= 1, 'AI should pick an immediate clearing placement');
  assert.ok(summaries[0].clearedPiki >= 6);
});

test('Overhanging Ice falling via gravity triggers immediate 6-col Ice Row Clear before next piece spawns', () => {
  const board = createBoardState(701, {
    initialGrid: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.EMPTY]],
    queue: [
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.PIKI],
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
    ],
  });

  // Drop at col=4 so BL=PIKI stops on [13][4]=ICE while BR=ICE overhangs [13][5]=EMPTY
  assert.equal(moveQuadX(board, 1), true);
  assert.equal(moveQuadX(board, 1), true);
  hardDropQuad(board);
  assert.equal(board.phase, 'gravity');

  let sawFallingInGravity = false;
  let clearedBeforeSpawn = false;
  let spawned = false;

  for (let frame = 0; frame < 180; frame++) {
    const ev = stepBoard(board, 1 / 60, 2);
    if (board.phase === 'gravity' && hasFallingCells(board.grid)) {
      sawFallingInGravity = true;
    }
    if (ev.cleared && ev.cleared.iceRows >= 1 && !spawned) {
      clearedBeforeSpawn = true;
    }
    if (ev.spawned) {
      spawned = true;
      break;
    }
  }

  assert.equal(sawFallingInGravity, true, 'Overhanging Ice should pass through animated gravity fall');
  assert.equal(clearedBeforeSpawn, true, 'Ice Row Clear must fire before next quad spawns');
  assert.equal(spawned, true);
  assert.equal(board.iceRowsCleared, 1);
  // All 5 initial bottom Ice cells cleared; cols 0..3 of bottom row are now empty
  assert.equal(board.grid[PIKI_ROWS - 1][0].type, CELL.EMPTY);
  assert.equal(board.grid[PIKI_ROWS - 1][4].type, CELL.PIKI);
});

test('Falling VS garbage completing a 6-col Ice row triggers immediate clear on the same turn', () => {
  let verifiedSeed = 0;

  for (let seed = 1; seed <= 32; seed++) {
    const board = createBoardState(seed, {
      initialGrid: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.EMPTY]],
      queue: [
        [CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI],
        [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
      ],
      isVsMode: true,
    });
    board.pendingGarbage = 6;
    moveQuadX(board, -1);
    moveQuadX(board, -1);
    hardDropQuad(board);

    let garbageCol5HasIce = false;
    let clearedBeforeSpawn = false;
    let spawned = false;

    for (let frame = 0; frame < 240; frame++) {
      const ev = stepBoard(board, 1 / 60, 2);
      if (ev.garbageDropped > 0) {
        garbageCol5HasIce = isIceBitSet(board.grid[PIKI_ROWS - 1][5].type);
        if (!garbageCol5HasIce) break;
      }
      if (ev.cleared && ev.cleared.iceRows >= 1 && !spawned) {
        clearedBeforeSpawn = true;
      }
      if (ev.spawned) {
        spawned = true;
        break;
      }
    }

    if (garbageCol5HasIce) {
      assert.equal(spawned, true);
      assert.equal(clearedBeforeSpawn, true, 'Garbage completing an Ice row must clear before next spawn');
      assert.ok(board.iceRowsCleared >= 1);
      verifiedSeed = seed;
      break;
    }
  }

  assert.ok(verifiedSeed > 0, 'Expected at least one deterministic seed to drop Ice/Frozen Piki into col 5');
});

test('Wide boards (8, 10, 12 cols) spawn 2x2 quads horizontally centered', () => {
  for (const [cols, expectedCol] of [
    [8, 3],
    [10, 4],
    [12, 5],
  ] as const) {
    const board = createBoardState(7, { cols });
    assert.equal(board.cols, cols);
    assert.equal(getSpawnCol(cols), expectedCol);
    assert.ok(board.current !== null);
    assert.equal(board.current!.col, expectedCol);
  }
});

test('8-column Ice Row Clear requires all 8 ice/frozen cells and thaws Frozen Pikiinya', () => {
  const b6 = createBoardState(11, {
    cols: 8,
    initialGrid: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.EMPTY, CELL.EMPTY]],
  });
  assert.equal(detectBoardClears(b6).iceRows, 0, '6 ice cells must not clear an 8-col board');

  const b7 = createBoardState(11, {
    cols: 8,
    initialGrid: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.EMPTY]],
  });
  assert.equal(detectBoardClears(b7).iceRows, 0, '7 ice cells must not clear an 8-col board');

  const b8 = createBoardState(11, {
    cols: 8,
    initialGrid: [[CELL.ICE, CELL.ICE, CELL.FROZEN_PIKI, CELL.ICE, CELL.ICE, CELL.FROZEN_PIKI, CELL.ICE, CELL.ICE]],
  });
  const detected = detectBoardClears(b8);
  assert.equal(detected.iceRows, 1);
  assert.equal(detected.hasClears, true);

  const summary = resolveClearPhase(b8);
  assert.equal(summary.iceRows, 1);
  assert.equal(b8.grid[PIKI_ROWS - 1][0].type, CELL.EMPTY);
  assert.equal(b8.grid[PIKI_ROWS - 1][2].type, CELL.PIKI);
  assert.equal(b8.grid[PIKI_ROWS - 1][5].type, CELL.PIKI);
  assert.equal(b8.grid[PIKI_ROWS - 1][7].type, CELL.EMPTY);
});

test('loadGridFromMatrix centers 6-col layouts on 10-col grid and supports padSidesWithIce', () => {
  const row6 = [CELL.ICE, CELL.FROZEN_PIKI, CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.ICE];
  const gridDefault = createEmptyGrid(10);
  loadGridFromMatrix(gridDefault, [row6]);

  assert.equal(gridDefault[PIKI_ROWS - 1][0].type, CELL.EMPTY);
  assert.equal(gridDefault[PIKI_ROWS - 1][1].type, CELL.EMPTY);
  assert.equal(gridDefault[PIKI_ROWS - 1][2].type, CELL.ICE);
  assert.equal(gridDefault[PIKI_ROWS - 1][3].type, CELL.FROZEN_PIKI);
  assert.equal(gridDefault[PIKI_ROWS - 1][4].type, CELL.PIKI);
  assert.equal(gridDefault[PIKI_ROWS - 1][7].type, CELL.ICE);
  assert.equal(gridDefault[PIKI_ROWS - 1][8].type, CELL.EMPTY);
  assert.equal(gridDefault[PIKI_ROWS - 1][9].type, CELL.EMPTY);

  const gridPadded = createEmptyGrid(10);
  loadGridFromMatrix(gridPadded, [row6], { padSidesWithIce: true });
  assert.equal(gridPadded[PIKI_ROWS - 1][0].type, CELL.ICE);
  assert.equal(gridPadded[PIKI_ROWS - 1][1].type, CELL.ICE);
  assert.equal(gridPadded[PIKI_ROWS - 1][3].type, CELL.FROZEN_PIKI);
  assert.equal(gridPadded[PIKI_ROWS - 1][8].type, CELL.ICE);
  assert.equal(gridPadded[PIKI_ROWS - 1][9].type, CELL.ICE);
});

test('chooseCpuPlacement targets rightmost columns (col >= 5) to complete 8-col Ice Row Clear', () => {
  const board = createBoardState(1, {
    cols: 8,
    initialGrid: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE, CELL.EMPTY, CELL.EMPTY]],
    queue: [
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
      [CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI],
    ],
  });
  const move = chooseCpuPlacement(board, getStoryRivalProfile(5), 1);
  assert.equal(move.col, 6);
  assert.ok(move.col >= 5);
});

test('VS garbage attack and drop scale cleanly to 8-col boards (cap 48, drop 8 per turn)', () => {
  const attacker = createBoardState(5, { cols: 8, isVsMode: true });
  const defender = createBoardState(6, { cols: 8, isVsMode: true });

  const sent = applyGarbageAttack(attacker, defender, 60);
  assert.equal(sent, 60);
  assert.equal(defender.pendingGarbage, 48);

  const dropped = dropPendingGarbage(defender);
  assert.equal(dropped, 8);
  assert.equal(defender.pendingGarbage, 40);
});
