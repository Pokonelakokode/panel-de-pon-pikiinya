import {
  CELL,
  PIKI_COLS,
  PIKI_ROWS,
  PIKI_SPAWN_ROWS,
  PIKI_TILE,
  type CellType,
  type PikiBoardState,
  type QuadCells,
} from './types.ts';
import { getQuadLandingRow } from './core.ts';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawIceCube(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  const pad = 2;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, '#e0f2fe');
  grad.addColorStop(0.45, '#7dd3fc');
  grad.addColorStop(1, '#0284c7');

  roundRectPath(ctx, x + pad, y + pad, w, h, 7);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#bae6fd';
  ctx.stroke();

  // Inner crystal shine + distinct geometric diamond/crystal core icon
  ctx.save();
  roundRectPath(ctx, x + pad + 2, y + pad + 2, w - 4, h - 4, 5);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.beginPath();
  ctx.moveTo(x + 4, y + size * 0.45);
  ctx.lineTo(x + size * 0.45, y + 4);
  ctx.lineTo(x + size * 0.7, y + 4);
  ctx.lineTo(x + 4, y + size * 0.7);
  ctx.closePath();
  ctx.fill();

  const cx = x + size * 0.5;
  const cy = y + size * 0.52;
  const rOuter = size * 0.22;
  ctx.fillStyle = 'rgba(224, 242, 254, 0.48)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - rOuter);
  ctx.lineTo(cx + rOuter * 0.85, cy);
  ctx.lineTo(cx, cy + rOuter);
  ctx.lineTo(cx - rOuter * 0.85, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(x + 6, y + 6, 6, 3);
  ctx.restore();
}

function drawFrozenBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pad = 2;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const cx = x + size * 0.5;
  const cy = y + size * 0.5;

  const rimGrad = ctx.createLinearGradient(x, y, x + size, y + size);
  rimGrad.addColorStop(0, '#cffafe');
  rimGrad.addColorStop(0.5, '#38bdf8');
  rimGrad.addColorStop(1, '#0284c7');
  roundRectPath(ctx, x + pad, y + pad, w, h, 7);
  ctx.fillStyle = rimGrad;
  ctx.fill();

  const cavityGrad = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.48);
  cavityGrad.addColorStop(0, '#082f49');
  cavityGrad.addColorStop(0.75, '#0c4a6e');
  cavityGrad.addColorStop(1, 'rgba(56, 189, 248, 0.45)');
  roundRectPath(ctx, x + pad + 2, y + pad + 2, w - 4, h - 4, 5);
  ctx.fillStyle = cavityGrad;
  ctx.fill();
}

function drawFrozenCrystalFrame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pad = 2;
  const w = size - pad * 2;
  const h = size - pad * 2;

  // Keep central viewing window ultra-clear (~10% tint) so penguin / star pops cleanly
  ctx.save();
  roundRectPath(ctx, x + pad, y + pad, w, h, 7);
  ctx.fillStyle = 'rgba(186, 230, 253, 0.10)';
  ctx.fill();
  ctx.clip();

  // Four icy corner frost facets leaving center unobstructed
  const facet = Math.max(6, Math.round(size * 0.21));
  const corners: readonly [number, number, number, number][] = [
    [x + pad, y + pad, 1, 1],
    [x + size - pad, y + pad, -1, 1],
    [x + pad, y + size - pad, 1, -1],
    [x + size - pad, y + size - pad, -1, -1],
  ];
  ctx.fillStyle = 'rgba(224, 242, 254, 0.88)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * facet, cy);
    ctx.lineTo(cx, cy + dy * facet);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Crisp double ice frame border
  roundRectPath(ctx, x + pad, y + pad, w, h, 7);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ecfeff';
  ctx.stroke();

  roundRectPath(ctx, x + pad + 1.5, y + pad + 1.5, w - 3, h - 3, 5.5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
  ctx.stroke();
}

function drawPenguin(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  options: {
    groupSize: number;
    excited: boolean;
    frozen: boolean;
    seedOffset: number;
  }
): void {
  const { groupSize, excited, frozen, seedOffset } = options;
  const isHappy = !frozen && (groupSize >= 4 || excited);
  const isAwake = !frozen && (groupSize >= 2 || excited);
  const bounceY = isHappy
    ? -Math.abs(Math.sin(time * 13 + seedOffset)) * 3.2
    : isAwake
      ? Math.sin(time * 5 + seedOffset) * 1.1
      : 0;
  const shiverX = frozen ? Math.sin(time * 34 + seedOffset) * 0.9 : 0;

  ctx.save();
  ctx.translate(cx + shiverX, cy + bounceY);

  // Feet
  ctx.fillStyle = frozen ? '#fb923c' : '#f59e0b';
  ctx.beginPath();
  ctx.ellipse(-radius * 0.36, radius * 0.82, radius * 0.25, radius * 0.14, -0.15, 0, Math.PI * 2);
  ctx.ellipse(radius * 0.36, radius * 0.82, radius * 0.25, radius * 0.14, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Flippers
  const flap = isHappy ? Math.sin(time * 20 + seedOffset) * 0.55 : 0.2;
  ctx.fillStyle = frozen ? '#0f172a' : isHappy ? '#2563eb' : '#1d4ed8';
  ctx.beginPath();
  ctx.ellipse(-radius * 0.82, radius * 0.12, radius * 0.22, radius * 0.42, -0.4 - flap, 0, Math.PI * 2);
  ctx.fill();
  if (frozen) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#bae6fd';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(radius * 0.82, radius * 0.12, radius * 0.22, radius * 0.42, 0.4 + flap, 0, Math.PI * 2);
  ctx.fill();
  if (frozen) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#bae6fd';
    ctx.stroke();
  }

  // Outer Plump Body (Obsidian-navy tuxedo coat when frozen for >7:1 contrast!)
  const bodyGrad = ctx.createRadialGradient(-radius * 0.25, -radius * 0.3, radius * 0.15, 0, 0, radius);
  if (frozen) {
    bodyGrad.addColorStop(0, '#334155');
    bodyGrad.addColorStop(0.55, '#0f172a');
    bodyGrad.addColorStop(1, '#020617');
  } else {
    bodyGrad.addColorStop(0, '#60a5fa');
    bodyGrad.addColorStop(0.65, '#2563eb');
    bodyGrad.addColorStop(1, '#1e3a8a');
  }
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.88, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = frozen ? 1.8 : 1.5;
  ctx.strokeStyle = frozen ? '#e0f2fe' : isHappy ? '#fde047' : '#0f172a';
  ctx.stroke();

  // White Belly & Face Patch
  ctx.fillStyle = frozen ? '#ffffff' : '#f8fafc';
  ctx.beginPath();
  ctx.ellipse(
    0,
    radius * 0.2,
    radius * (frozen ? 0.6 : 0.56),
    radius * (frozen ? 0.56 : 0.54),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Cheeks when awake/excited
  if (!frozen && (isAwake || isHappy)) {
    ctx.fillStyle = isHappy ? 'rgba(244, 114, 182, 0.8)' : 'rgba(251, 146, 60, 0.5)';
    ctx.beginPath();
    ctx.arc(-radius * 0.45, radius * 0.04, radius * 0.14, 0, Math.PI * 2);
    ctx.arc(radius * 0.45, radius * 0.04, radius * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes
  if (!isAwake && !frozen) {
    // Lonely sleeping penguin (groupSize === 1)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(-radius * 0.28, -radius * 0.16, radius * 0.13, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(radius * 0.28, -radius * 0.16, radius * 0.13, 0.15, Math.PI - 0.15);
    ctx.stroke();
  } else {
    const eyeRad = radius * (frozen ? 0.165 : 0.15);
    ctx.fillStyle = frozen ? '#020617' : '#0f172a';
    ctx.beginPath();
    ctx.arc(-radius * 0.28, -radius * 0.18, eyeRad, 0, Math.PI * 2);
    ctx.arc(radius * 0.28, -radius * 0.18, eyeRad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-radius * 0.32, -radius * 0.22, radius * 0.06, 0, Math.PI * 2);
    ctx.arc(radius * 0.24, -radius * 0.22, radius * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  // Beak
  ctx.fillStyle = frozen ? '#f97316' : '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(-radius * 0.23, -radius * 0.02);
  ctx.lineTo(radius * 0.23, -radius * 0.02);
  ctx.lineTo(0, radius * 0.24);
  ctx.closePath();
  ctx.fill();
  if (frozen) {
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(-radius * 0.14, -radius * 0.01);
    ctx.lineTo(radius * 0.14, -radius * 0.01);
    ctx.lineTo(0, radius * 0.09);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = frozen ? '#7c2d12' : '#b45309';
  ctx.stroke();

  // Sleepy "z" bubble when isolated (groupSize === 1)
  if (!frozen && groupSize === 1 && !excited) {
    const zFloat = ((time * 1.4 + seedOffset) % 1);
    ctx.globalAlpha = 1 - zFloat * 0.85;
    ctx.fillStyle = '#e0f2fe';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('z', radius * 0.65, -radius * 0.55 - zFloat * 6);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawTargetCage(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pad = 2;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, '#64748b');
  grad.addColorStop(0.5, '#334155');
  grad.addColorStop(1, '#1e293b');

  roundRectPath(ctx, x + pad, y + pad, w, h, 6);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f87171';
  ctx.stroke();

  // Diagonal warning bars / cage grate
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 6);
  ctx.lineTo(x + 8, y + size - 6);
  ctx.moveTo(x + size * 0.5, y + 6);
  ctx.lineTo(x + size * 0.5, y + size - 6);
  ctx.moveTo(x + size - 8, y + 6);
  ctx.lineTo(x + size - 8, y + size - 6);
  ctx.stroke();

  // Lock emblem
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.5, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(x + size * 0.5 - 1.5, y + size * 0.5 - 2, 3, 4.5);
}

function drawMiracleBell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  frozen: boolean
): void {
  if (frozen) {
    drawFrozenBackdrop(ctx, x, y, size);
  }
  const cx = x + size * 0.5;
  const cy = y + size * 0.5;
  const pulse = 1 + Math.sin(time * 8) * 0.08;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);

  ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // 5-point star / Miracle bell core
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const outer = size * 0.34;
  const inner = size * 0.16;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const ang = -Math.PI / 2 + (Math.PI / 5) * i;
    if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (frozen) {
    drawFrozenCrystalFrame(ctx, x, y, size);
  }
}

export function drawPikiCell(
  ctx: CanvasRenderingContext2D,
  type: CellType,
  x: number,
  y: number,
  size: number,
  time: number,
  opts: {
    groupSize?: number;
    excited?: boolean;
    clearing?: boolean;
    thawing?: boolean;
    seedOffset?: number;
  } = {}
): void {
  if (type === CELL.EMPTY) return;

  ctx.save();
  if (opts.clearing) {
    const flash = Math.sin(time * 42) > 0;
    ctx.globalAlpha = flash ? 0.95 : 0.45;
    const cx = x + size * 0.5;
    const cy = y + size * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(flash ? 1.08 : 0.9, flash ? 1.08 : 0.9);
    ctx.translate(-cx, -cy);
  } else if (opts.thawing) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
  }

  switch (type) {
    case CELL.ICE:
      drawIceCube(ctx, x, y, size);
      break;
    case CELL.PIKI:
      drawPenguin(ctx, x + size * 0.5, y + size * 0.5, size * 0.42, time, {
        groupSize: opts.groupSize ?? 2,
        excited: opts.excited ?? false,
        frozen: false,
        seedOffset: opts.seedOffset ?? 0,
      });
      if (!opts.clearing && (opts.groupSize ?? 0) >= 4) {
        ctx.fillStyle = (opts.groupSize ?? 0) >= 5 ? '#f43f5e' : '#eab308';
        ctx.beginPath();
        ctx.arc(x + size - 7, y + 7, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(opts.groupSize), x + size - 7, y + 7.5);
      }
      break;
    case CELL.FROZEN_PIKI:
      drawFrozenBackdrop(ctx, x, y, size);
      drawPenguin(ctx, x + size * 0.5, y + size * 0.51, size * 0.4, time, {
        groupSize: 1,
        excited: false,
        frozen: true,
        seedOffset: opts.seedOffset ?? 0,
      });
      drawFrozenCrystalFrame(ctx, x, y, size);
      break;
    case CELL.TARGET:
      drawTargetCage(ctx, x, y, size);
      break;
    case CELL.MIRACLE:
      drawMiracleBell(ctx, x, y, size, time, false);
      break;
    case CELL.FROZEN_MIRACLE:
      drawMiracleBell(ctx, x, y, size, time, true);
      break;
  }

  ctx.restore();
}

export function renderPikiBoard(
  ctx: CanvasRenderingContext2D,
  board: PikiBoardState,
  options: {
    showGhost?: boolean;
    dangerHighlight?: boolean;
    editorMode?: boolean;
  } = {}
): void {
  const cols = board.cols || board.grid[0]?.length || PIKI_COLS;
  const w = cols * PIKI_TILE;
  const h = PIKI_ROWS * PIKI_TILE;
  const t = board.elapsedTime;

  // Glacier Backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#091933');
  bg.addColorStop(0.55, '#0f294a');
  bg.addColorStop(1, '#163d64');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Top 2 rows = spawn / deadline zone
  ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
  ctx.fillRect(0, 0, w, PIKI_SPAWN_ROWS * PIKI_TILE);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.12)';
  ctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * PIKI_TILE, 0);
    ctx.lineTo(c * PIKI_TILE, h);
    ctx.stroke();
  }
  for (let r = 1; r < PIKI_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * PIKI_TILE);
    ctx.lineTo(w, r * PIKI_TILE);
    ctx.stroke();
  }

  // Danger Warning Pulse & Spawn Deadline
  const ceilingY = PIKI_SPAWN_ROWS * PIKI_TILE;
  ctx.save();
  ctx.strokeStyle = options.dangerHighlight ? '#fb7185' : 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = options.dangerHighlight ? 2.5 : 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, ceilingY);
  ctx.lineTo(w, ceilingY);
  ctx.stroke();
  ctx.restore();

  if (options.dangerHighlight) {
    const pulse = 0.08 + 0.08 * Math.sin(t * 10);
    ctx.fillStyle = `rgba(244, 63, 94, ${pulse.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Connected Pikiinya subtle Ice/Aura bridges between adjacent PIKI cells
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board.grid[r][c];
      if (cell.type !== CELL.PIKI) continue;
      const cx = (c + 0.5) * PIKI_TILE;
      const cy = (r + 0.5 - cell.fallOffset) * PIKI_TILE;
      if (c + 1 < cols && board.grid[r][c + 1].type === CELL.PIKI) {
        const ny = (r + 0.5 - board.grid[r][c + 1].fallOffset) * PIKI_TILE;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo((c + 1.5) * PIKI_TILE, ny);
        ctx.stroke();
      }
      if (r + 1 < PIKI_ROWS && board.grid[r + 1][c].type === CELL.PIKI) {
        const ny = (r + 1.5 - board.grid[r + 1][c].fallOffset) * PIKI_TILE;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, ny);
        ctx.stroke();
      }
    }
  }

  // Settled Cells
  for (let r = 0; r < PIKI_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board.grid[r][c];
      if (cell.type === CELL.EMPTY) continue;
      const x = c * PIKI_TILE;
      const y = (r - cell.fallOffset) * PIKI_TILE;
      drawPikiCell(ctx, cell.type, x, y, PIKI_TILE, t, {
        groupSize: cell.groupSize,
        excited: cell.excitedTimer > 0,
        clearing: cell.clearing,
        thawing: cell.thawing,
        seedOffset: r * 0.7 + c * 1.1,
      });
    }
  }

  // Active 2x2 Falling Quad + Ghost Outline
  if (!options.editorMode && board.phase === 'falling' && board.current) {
    const q = board.current;
    if (options.showGhost !== false) {
      const landR = getQuadLandingRow(board);
      if (landR > q.subRow + 0.25) {
        ctx.save();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        roundRectPath(
          ctx,
          q.col * PIKI_TILE + 2,
          landR * PIKI_TILE + 2,
          PIKI_TILE * 2 - 4,
          PIKI_TILE * 2 - 4,
          6
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    const qx = q.col * PIKI_TILE;
    const qy = q.subRow * PIKI_TILE;
    const pivotX = qx + PIKI_TILE;
    const pivotY = qy + PIKI_TILE;

    ctx.save();
    ctx.translate(pivotX, pivotY);
    if (Math.abs(q.rotVisual) > 0.005) {
      ctx.rotate(q.rotVisual);
    }
    drawPikiCell(ctx, q.cells[0], -PIKI_TILE, -PIKI_TILE, PIKI_TILE, t, { groupSize: 2, seedOffset: 0.1 });
    drawPikiCell(ctx, q.cells[1], 0, -PIKI_TILE, PIKI_TILE, t, { groupSize: 2, seedOffset: 0.5 });
    drawPikiCell(ctx, q.cells[2], 0, 0, PIKI_TILE, t, { groupSize: 2, seedOffset: 0.9 });
    drawPikiCell(ctx, q.cells[3], -PIKI_TILE, 0, PIKI_TILE, t, { groupSize: 2, seedOffset: 1.3 });

    // Glowing 2x2 unit frame
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, -PIKI_TILE + 1, -PIKI_TILE + 1, PIKI_TILE * 2 - 2, PIKI_TILE * 2 - 2, 7);
    ctx.stroke();
    ctx.restore();
  }

  // Particles
  for (const p of board.particles) {
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * PIKI_TILE - p.size * 0.5, p.y * PIKI_TILE - p.size * 0.5, p.size, p.size);
    ctx.restore();
  }

  // Popups (CHAIN / THAWED / ALL CLEAR)
  for (const pop of board.popups) {
    const alpha = Math.max(0, Math.min(1, pop.life / pop.maxLife));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    const px = Math.max(54, Math.min(w - 54, pop.x * PIKI_TILE));
    const py = Math.max(22, Math.min(h - 10, pop.y * PIKI_TILE));
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#0f172a';
    ctx.strokeText(pop.text, px, py);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, px, py);
    ctx.restore();
  }
}

export function renderNextQuadCanvas(
  ctx: CanvasRenderingContext2D,
  next: QuadCells,
  time: number
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#081529';
  ctx.fillRect(0, 0, w, h);

  const cellSize = Math.floor((Math.min(w, h) - 8) / 2);
  const ox = Math.floor((w - cellSize * 2) * 0.5);
  const oy = Math.floor((h - cellSize * 2) * 0.5);

  drawPikiCell(ctx, next[0], ox, oy, cellSize, time, { groupSize: 2, seedOffset: 0.1 });
  drawPikiCell(ctx, next[1], ox + cellSize, oy, cellSize, time, { groupSize: 2, seedOffset: 0.4 });
  drawPikiCell(ctx, next[2], ox + cellSize, oy + cellSize, cellSize, time, { groupSize: 2, seedOffset: 0.7 });
  drawPikiCell(ctx, next[3], ox, oy + cellSize, cellSize, time, { groupSize: 2, seedOffset: 1.0 });
}

export function renderEnduranceRaceCanvas(
  ctx: CanvasRenderingContext2D,
  distanceMeters: number,
  speedKmh: number,
  time: number
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0ea5e9');
  sky.addColorStop(0.65, '#7dd3fc');
  sky.addColorStop(0.66, '#e0f2fe');
  sky.addColorStop(1, '#bae6fd');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Parallax Andes Peaks
  const scroll = (distanceMeters * 2.5) % 120;
  ctx.fillStyle = '#0369a1';
  for (let x = -120; x < w + 120; x += 120) {
    const px = x - scroll;
    ctx.beginPath();
    ctx.moveTo(px, h * 0.66);
    ctx.lineTo(px + 60, h * 0.18);
    ctx.lineTo(px + 120, h * 0.66);
    ctx.closePath();
    ctx.fill();

    // Snow cap
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(px + 42, h * 0.34);
    ctx.lineTo(px + 60, h * 0.18);
    ctx.lineTo(px + 78, h * 0.34);
    ctx.lineTo(px + 66, h * 0.3);
    ctx.lineTo(px + 54, h * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0369a1';
  }

  // Track distance markers
  const markerScroll = (distanceMeters * 6) % 60;
  ctx.fillStyle = '#0284c7';
  for (let x = -60; x < w + 60; x += 60) {
    ctx.fillRect(x - markerScroll, h * 0.72, 3, h * 0.2);
  }

  // Sprinting Pikiinya Runner
  const runnerX = Math.min(w - 36, Math.max(36, 48 + (speedKmh - 15) * 1.4));
  const stride = Math.abs(Math.sin(time * (6 + speedKmh * 0.15))) * 4;
  drawPenguin(ctx, runnerX, h * 0.68 - stride, 15, time * 1.6, {
    groupSize: speedKmh >= 40 ? 5 : 3,
    excited: speedKmh >= 35,
    frozen: false,
    seedOffset: 0,
  });

  // Speed lines when dashing
  if (speedKmh >= 30) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const ly = h * 0.45 + i * 8;
      const lx = runnerX - 24 - ((time * 90 + i * 17) % 28);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - 18, ly);
      ctx.stroke();
    }
  }
}
