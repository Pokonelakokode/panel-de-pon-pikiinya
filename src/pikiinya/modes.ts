import {
  CELL,
  type CpuOpponentProfile,
  type PikiBoardState,
  type PikiPuzzleDef,
  type StageClearDef,
  type TutorialStepDef,
} from './types.ts';
import { countRemainingPikiOrTargets, countRemainingTargets } from './core.ts';

/**
 * 8 Andes Deathmatch Story Mode opponents + infinite Overlord scaling,
 * paying homage to Crea-Tech / Tamakichi Sakura's quirky 1997 campaign
 * defending wild Pikiinyas against poachers & mad scientist Dr. Slagger.
 */
export const STORY_RIVALS: readonly Omit<CpuOpponentProfile, 'stageNumber' | 'tierTag'>[] = [
  {
    name: 'Bongo the Bumbler',
    shortName: 'BONGO',
    title: 'Rookie Penguin Poacher',
    avatar: '🦊',
    quote: '"Hey little birdies, hop right into my butterfly net!"',
    moveInterval: 0.44,
    thinkPause: 0.55,
    mistakeRate: 0.34,
    chainWeight: 0.75,
    fallSpeed: 1.5,
  },
  {
    name: 'Lady Miranda',
    shortName: 'MIRANDA',
    title: 'Posh Exotic Pet Collector',
    avatar: '👒',
    quote: '"A chill penguin would match my crystal chandelier, darling!"',
    moveInterval: 0.36,
    thinkPause: 0.42,
    mistakeRate: 0.26,
    chainWeight: 0.9,
    fallSpeed: 1.65,
  },
  {
    name: 'Shaman Kukuri',
    shortName: 'KUKURI',
    title: 'Andes Totem Mystic',
    avatar: '🎭',
    quote: '"Only six dancing Pikiinyas can awaken the ancient glacier spirit!"',
    moveInterval: 0.30,
    thinkPause: 0.34,
    mistakeRate: 0.20,
    chainWeight: 1.05,
    fallSpeed: 1.85,
  },
  {
    name: 'Captain Hookjaw',
    shortName: 'HOOKJAW',
    title: 'Sky-Blimp Smuggler',
    avatar: '🪝',
    quote: '"Load those ice crates aboard before the blizzard hits!"',
    moveInterval: 0.25,
    thinkPause: 0.28,
    mistakeRate: 0.14,
    chainWeight: 1.2,
    fallSpeed: 2.05,
  },
  {
    name: 'Chef Blancmange',
    shortName: 'CHEF',
    title: 'Five-Star Glacier Patissier',
    avatar: '👨‍🍳',
    quote: '"Freeze-thaw soufflé needs an exact six-column flame row!"',
    moveInterval: 0.20,
    thinkPause: 0.22,
    mistakeRate: 0.10,
    chainWeight: 1.35,
    fallSpeed: 2.25,
  },
  {
    name: 'Mecha-Catcher MK-II',
    shortName: 'MK-II',
    title: 'Automated Cryo-Drone',
    avatar: '🤖',
    quote: '"BEEP-BOOP. OPTIMAL THAW CHAIN COMPUTED. SURRENDER BIRDS."',
    moveInterval: 0.16,
    thinkPause: 0.18,
    mistakeRate: 0.06,
    chainWeight: 1.55,
    fallSpeed: 2.5,
  },
  {
    name: 'Prof. Frostbite',
    shortName: 'FROSTBITE',
    title: 'Sub-Zero Lab Director',
    avatar: '🥽',
    quote: '"Every cascade multiplies our thermal output exponentially!"',
    moveInterval: 0.13,
    thinkPause: 0.13,
    mistakeRate: 0.03,
    chainWeight: 1.75,
    fallSpeed: 2.75,
  },
  {
    name: 'Dr. Slagger',
    shortName: 'SLAGGER',
    title: 'Final Boss • Mad Nobel Chaser',
    avatar: '🧪',
    quote: '"Gwahaha! My Pikiinya-fusion formula will win me the Nobel Prize!"',
    moveInterval: 0.10,
    thinkPause: 0.09,
    mistakeRate: 0.01,
    chainWeight: 2.0,
    fallSpeed: 3.1,
  },
];

export function getStoryRivalProfile(stageIdx: number): CpuOpponentProfile {
  const safeIdx = Math.max(0, stageIdx);
  const loop = Math.floor(safeIdx / STORY_RIVALS.length);
  const base = STORY_RIVALS[safeIdx % STORY_RIVALS.length];
  const tierFactor = Math.pow(0.88, loop);
  return {
    stageNumber: safeIdx + 1,
    name: loop > 0 ? `★ ${base.name} Ω${loop + 1}` : base.name,
    shortName: loop > 0 ? `★${base.shortName}` : base.shortName,
    title: loop > 0 ? `${base.title} (Overlord +${loop})` : base.title,
    avatar: base.avatar,
    quote:
      loop > 0
        ? '"Hyper-Andes Overlord Mode! My cascades never stop!"'
        : base.quote,
    tierTag: loop > 0 ? `LV.${safeIdx + 1} Ω` : `STAGE ${safeIdx + 1}`,
    moveInterval: Math.max(0.06, base.moveInterval * tierFactor),
    thinkPause: Math.max(0.05, base.thinkPause * tierFactor),
    mistakeRate: Math.max(0, base.mistakeRate * Math.pow(0.6, loop)),
    chainWeight: base.chainWeight + loop * 0.25,
    fallSpeed: Math.min(4.8, base.fallSpeed + loop * 0.4),
  };
}

/**
 * 16 Stage Clear Levels: 8 Omote (Surface) + 8 Ura (Hidden) stages.
 * Objective: shatter all Cage/Target blocks (4) by clearing 6+ connected Pikiinyas adjacent to them.
 */
export const STAGE_CLEAR_LEVELS: readonly StageClearDef[] = [
  // --- OMOTE (SURFACE) 1-8 ---
  {
    id: 'omote-1',
    course: 'omote',
    stageNumber: 1,
    title: 'First Cage Rescue',
    subtitle: 'Connect 6 Pikiinyas next to the cage!',
    fallSpeed: 1.4,
    grid: [
      [0, 0, 2, 0, 0, 0],
      [0, 0, 2, 4, 0, 0],
      [0, 2, 2, 2, 0, 0],
    ],
  },
  {
    id: 'omote-2',
    course: 'omote',
    stageNumber: 2,
    title: 'Melt the Glacier Row',
    subtitle: 'Complete an Ice row to wake Frozen Pikiinyas!',
    fallSpeed: 1.5,
    grid: [
      [0, 0, 0, 4, 0, 0],
      [0, 0, 2, 2, 0, 0],
      [1, 3, 3, 3, 1, 0],
      [1, 4, 2, 2, 1, 0],
    ],
  },
  {
    id: 'omote-3',
    course: 'omote',
    stageNumber: 3,
    title: 'Twin Poacher Traps',
    subtitle: 'Smash both cages on opposite flanks!',
    fallSpeed: 1.65,
    grid: [
      [0, 4, 0, 0, 4, 0],
      [0, 2, 1, 1, 2, 0],
      [2, 2, 3, 3, 2, 2],
    ],
  },
  {
    id: 'omote-4',
    course: 'omote',
    stageNumber: 4,
    title: 'Deep Freeze Bunker',
    subtitle: 'Cages guard the center; thaw through the frost!',
    fallSpeed: 1.8,
    grid: [
      [0, 0, 4, 4, 0, 0],
      [0, 1, 3, 3, 1, 0],
      [1, 3, 2, 2, 3, 1],
      [1, 2, 4, 4, 2, 1],
    ],
  },
  {
    id: 'omote-5',
    course: 'omote',
    stageNumber: 5,
    title: 'Staircase Avalanche',
    subtitle: 'Use gravity drops after breaking the bottom layer!',
    fallSpeed: 1.95,
    grid: [
      [4, 0, 0, 0, 0, 4],
      [3, 1, 0, 0, 1, 3],
      [2, 3, 1, 1, 3, 2],
      [2, 2, 4, 4, 2, 2],
    ],
  },
  {
    id: 'omote-6',
    course: 'omote',
    stageNumber: 6,
    title: 'Crossfire Sanctuary',
    subtitle: 'Bridge the middle split to smash four cages at once!',
    fallSpeed: 2.1,
    grid: [
      [0, 4, 0, 0, 4, 0],
      [0, 2, 1, 1, 2, 0],
      [0, 4, 3, 3, 4, 0],
      [1, 2, 1, 1, 2, 1],
    ],
  },
  {
    id: 'omote-7',
    course: 'omote',
    stageNumber: 7,
    title: 'Slagger Vault A',
    subtitle: 'Locked behind alternating Ice & Cage columns!',
    fallSpeed: 2.25,
    grid: [
      [4, 0, 4, 4, 0, 4],
      [1, 3, 1, 1, 3, 1],
      [3, 2, 3, 3, 2, 3],
      [1, 2, 4, 4, 2, 1],
    ],
  },
  {
    id: 'omote-8',
    course: 'omote',
    stageNumber: 8,
    title: 'Andes Summit Finale',
    subtitle: 'Clear all 6 summit cages to unlock URA Course!',
    fallSpeed: 2.4,
    grid: [
      [0, 4, 0, 0, 4, 0],
      [1, 3, 4, 4, 3, 1],
      [2, 3, 1, 1, 3, 2],
      [4, 2, 3, 3, 2, 4],
      [1, 1, 2, 2, 1, 1],
    ],
  },

  // --- URA (HIDDEN) 1-8 ---
  {
    id: 'ura-1',
    course: 'ura',
    stageNumber: 1,
    title: 'URA 1: Frozen Fortress',
    subtitle: 'Tight quarters! Carve through Ice rows first.',
    fallSpeed: 2.3,
    grid: [
      [4, 1, 0, 0, 1, 4],
      [3, 4, 1, 1, 4, 3],
      [2, 3, 3, 3, 3, 2],
      [1, 2, 4, 4, 2, 1],
    ],
  },
  {
    id: 'ura-2',
    course: 'ura',
    stageNumber: 2,
    title: 'URA 2: Checkerboard Frost',
    subtitle: 'Turn the checkerboard into a single chain wave!',
    fallSpeed: 2.45,
    grid: [
      [1, 4, 1, 1, 4, 1],
      [3, 2, 3, 3, 2, 3],
      [1, 4, 1, 1, 4, 1],
      [2, 3, 2, 2, 3, 2],
    ],
  },
  {
    id: 'ura-3',
    course: 'ura',
    stageNumber: 3,
    title: 'URA 3: Twin Canyons',
    subtitle: 'Fill both icy canyons to awaken the trapped flock.',
    fallSpeed: 2.6,
    grid: [
      [4, 2, 0, 0, 2, 4],
      [3, 4, 0, 0, 4, 3],
      [1, 3, 1, 1, 3, 1],
      [4, 2, 3, 3, 2, 4],
      [1, 2, 2, 2, 2, 1],
    ],
  },
  {
    id: 'ura-4',
    course: 'ura',
    stageNumber: 4,
    title: 'URA 4: Cage Pyramid',
    subtitle: 'Break the base, then trigger upper cascades.',
    fallSpeed: 2.75,
    grid: [
      [0, 0, 4, 4, 0, 0],
      [0, 4, 3, 3, 4, 0],
      [4, 3, 1, 1, 3, 4],
      [3, 2, 3, 3, 2, 3],
      [1, 2, 2, 2, 2, 1],
    ],
  },
  {
    id: 'ura-5',
    course: 'ura',
    stageNumber: 5,
    title: 'URA 5: Glacier Lock',
    subtitle: 'High stack — stay cool and clear row-by-row!',
    fallSpeed: 2.9,
    grid: [
      [4, 0, 4, 4, 0, 4],
      [3, 1, 3, 3, 1, 3],
      [1, 4, 1, 1, 4, 1],
      [2, 3, 2, 2, 3, 2],
      [4, 1, 3, 3, 1, 4],
      [2, 2, 1, 1, 2, 2],
    ],
  },
  {
    id: 'ura-6',
    course: 'ura',
    stageNumber: 6,
    title: 'URA 6: Pendulum Cages',
    subtitle: 'Chain thaws unlock the center monolith!',
    fallSpeed: 3.05,
    grid: [
      [0, 4, 1, 1, 4, 0],
      [4, 3, 4, 4, 3, 4],
      [1, 2, 3, 3, 2, 1],
      [4, 2, 1, 1, 2, 4],
      [3, 2, 2, 2, 2, 3],
    ],
  },
  {
    id: 'ura-7',
    course: 'ura',
    stageNumber: 7,
    title: 'URA 7: Dr. Slagger Core',
    subtitle: 'Double-walled cryo chamber — route big groups carefully!',
    fallSpeed: 3.25,
    grid: [
      [4, 1, 4, 4, 1, 4],
      [1, 3, 2, 2, 3, 1],
      [4, 3, 4, 4, 3, 4],
      [2, 1, 3, 3, 1, 2],
      [4, 2, 1, 1, 2, 4],
      [3, 2, 2, 2, 2, 3],
    ],
  },
  {
    id: 'ura-8',
    course: 'ura',
    stageNumber: 8,
    title: 'URA 8: Legend of Pikiinya',
    subtitle: 'The ultimate 10-cage trial! Claim grand mastery!',
    fallSpeed: 3.5,
    grid: [
      [4, 4, 0, 0, 4, 4],
      [1, 3, 4, 4, 3, 1],
      [4, 2, 3, 3, 2, 4],
      [3, 4, 1, 1, 4, 3],
      [1, 2, 3, 3, 2, 1],
      [4, 2, 2, 2, 2, 4],
    ],
  },
];

/**
 * 8 Solvable Brain-Teaser Puzzles with fixed 2x2 queues (all verified by exhaustive solver).
 * Goal: Eliminate all Pikiinyas, Frozen Pikiinyas, and Target Cages on the grid!
 */
export const PIKI_PUZZLES: readonly PikiPuzzleDef[] = [
  {
    id: 'puz-1',
    title: '1. Glacier Thaw (1 Move)',
    hint: 'Complete the bottom Ice row on the right to thaw the Frozen Pikiinyas into a 6-group!',
    grid: [
      [0, 0, 0, 0, 0, 0],
      [1, 3, 3, 3, 0, 0],
    ],
    pieceQueue: [[CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.FROZEN_PIKI]],
  },
  {
    id: 'puz-2',
    title: '2. Rotate & Smash (1 Move)',
    hint: 'Rotate 180° so both Pikiinyas face LEFT, then drop on the right to smash the cage!',
    grid: [
      [0, 1, 2, 4, 0, 0],
      [1, 2, 2, 2, 0, 0],
    ],
    pieceQueue: [[CELL.ICE, CELL.PIKI, CELL.PIKI, CELL.ICE]],
  },
  {
    id: 'puz-3',
    title: '3. Twin Cage Sweep (1 Move)',
    hint: 'Drop Pikiinyas across the center chasm to link 6 penguins & break both cages!',
    grid: [
      [0, 4, 0, 0, 4, 0],
      [2, 2, 0, 0, 2, 2],
    ],
    pieceQueue: [[CELL.ICE, CELL.ICE, CELL.PIKI, CELL.PIKI]],
  },
  {
    id: 'puz-4',
    title: '4. Miracle Awakening (1 Move)',
    hint: 'Thaw the Golden Miracle Bell inside the Ice row on cols 4-5 to clear everything!',
    grid: [
      [2, 4, 2, 0, 0, 0],
      [4, 2, 4, 2, 0, 0],
      [1, 1, 1, 1, 0, 0],
    ],
    pieceQueue: [[CELL.ICE, CELL.ICE, CELL.ICE, CELL.FROZEN_MIRACLE]],
  },
  {
    id: 'puz-5',
    title: '5. Double Thaw Bridge (2 Moves)',
    hint: 'First complete the bottom Ice row on the right, then drop the solo Pikiinya onto the left to reach 6!',
    grid: [
      [0, 0, 2, 2, 0, 0],
      [1, 1, 3, 3, 0, 0],
    ],
    pieceQueue: [
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.FROZEN_PIKI],
      [CELL.ICE, CELL.PIKI, CELL.ICE, CELL.ICE],
    ],
  },
  {
    id: 'puz-6',
    title: '6. Cliffside Drop (2 Moves)',
    hint: 'Melt the bottom frost layer first, then connect 3 more Pikiinyas above to smash the cage!',
    grid: [
      [2, 2, 2, 4, 0, 0],
      [1, 1, 1, 1, 0, 0],
    ],
    pieceQueue: [
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
      [CELL.ICE, CELL.PIKI, CELL.PIKI, CELL.PIKI],
    ],
  },
  {
    id: 'puz-7',
    title: '7. Cryo Cage Cascade (2 Moves)',
    hint: 'Extend the bottom Ice bridge, then thaw the Golden Miracle Bell to liberate both cages!',
    grid: [
      [0, 4, 0, 0, 0, 0],
      [4, 2, 0, 0, 0, 0],
      [1, 3, 0, 0, 0, 0],
    ],
    pieceQueue: [
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.FROZEN_MIRACLE],
    ],
  },
  {
    id: 'puz-8',
    title: '8. Grand Pikiinya Finale (3 Moves)',
    hint: 'Line up the two Ice+Pikiinya pairs across row 13 to melt it, then cap the 5 penguins with a 6th!',
    grid: [
      [4, 2, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0],
    ],
    pieceQueue: [
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.ICE],
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.ICE],
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.PIKI],
    ],
  },
];

/**
 * 4 Interactive Lecture / Tutorial Lessons demonstrating Pikiinya!'s core mechanics.
 */
export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  {
    id: 'tut-1-six-group',
    title: 'Lesson 1: Connect 6 Pikiinyas!',
    instruction:
      'Use Left/Right to move and Space / Z to rotate the 2×2 piece. Land 2 awake Pikiinyas touching the 4 waiting penguins below to make a group of 6!',
    goalText: 'Clear at least 6 awake Pikiinyas together.',
    grid: [
      [0, 0, 2, 2, 0, 0],
      [0, 0, 2, 2, 0, 0],
    ],
    pieceQueue: [
      [CELL.ICE, CELL.ICE, CELL.PIKI, CELL.PIKI],
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.ICE],
      [CELL.PIKI, CELL.PIKI, CELL.PIKI, CELL.PIKI],
    ],
    checkGoal: (b: PikiBoardState) => b.clearedPikiCount >= 6,
  },
  {
    id: 'tut-2-ice-row',
    title: 'Lesson 2: Melt a 6-Column Ice Row!',
    instruction:
      'Fill all 6 columns of a horizontal row with Ice or Frozen Pikiinyas! Completing the Ice row shatters the ice and thaws frozen penguins awake!',
    goalText: 'Trigger an Ice Row Clear to thaw frozen Pikiinyas.',
    grid: [
      [1, 3, 3, 1, 0, 0],
    ],
    pieceQueue: [
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.FROZEN_PIKI],
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
    ],
    checkGoal: (b: PikiBoardState) => b.iceRowsCleared >= 1,
  },
  {
    id: 'tut-3-break-cage',
    title: 'Lesson 3: Smash Poacher Cages!',
    instruction:
      'Gray Cage blocks (Target) cannot be cleared by themselves. Connect 6+ Pikiinyas orthogonally touching a Cage to shatter it!',
    goalText: 'Break all Target Cages on the board.',
    grid: [
      [0, 4, 0, 0, 4, 0],
      [2, 2, 0, 0, 2, 2],
    ],
    pieceQueue: [
      [CELL.ICE, CELL.ICE, CELL.PIKI, CELL.PIKI],
      [CELL.PIKI, CELL.PIKI, CELL.ICE, CELL.ICE],
    ],
    checkGoal: (b: PikiBoardState) =>
      b.clearedTargetCount >= 2 && countRemainingTargets(b.grid) === 0,
  },
  {
    id: 'tut-4-thaw-chain',
    title: 'Lesson 4: Thaw-Into-Chain (2x Chain)!',
    instruction:
      'Drop the Ice pair onto cols 4–5 of the bottom row! Melting the Ice thaws 3 Frozen Pikiinyas directly into 3 waiting penguins for an instant 2x CHAIN!',
    goalText: 'Pull off a 2x Chain cascade!',
    grid: [
      [0, 2, 2, 0, 0, 0],
      [1, 3, 3, 3, 0, 0],
    ],
    pieceQueue: [
      [CELL.PIKI, CELL.ICE, CELL.ICE, CELL.ICE],
      [CELL.ICE, CELL.ICE, CELL.ICE, CELL.ICE],
    ],
    checkGoal: (b: PikiBoardState) =>
      b.maxChain >= 2 || countRemainingPikiOrTargets(b.grid) === 0,
  },
];
