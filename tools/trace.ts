// Ad-hoc diagnostics for reported gameplay bugs.
import { fixture, emptyRows, addGarbage } from '../test/helpers.ts';
import { BOARD_COLS, BOARD_ROWS } from '../src/core/tuning.ts';

function dump(player: { grid: unknown[][] }): string[] {
  const rows: string[] = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    let line = '';
    for (let c = 0; c < BOARD_COLS; c++) {
      const panel = player.grid[r][c] as { color: number; phase: string } | null;
      line += panel ? String(panel.color) : '.';
    }
    rows.push(String(r).padStart(2, ' ') + ' ' + line);
  }
  return rows;
}

console.log('A: red match above a red 1-row block');
{
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const f = fixture({ board: rows });
  addGarbage(f.state, 0, { x: 0, y: 11, w: 6, h: 1, color: 0 });
  for (let t = 0; t < 3; t++) f.run(1);
  console.log('  blocks left: ' + f.state.players[0].garbage.length);
  console.log(dump(f.state.players[0]).slice(9).join(String.fromCharCode(10)));
}

console.log('B: red match above a GREEN 1-row block');
{
  const rows = emptyRows();
  rows[10] = 'RRR...';
  const f = fixture({ board: rows });
  addGarbage(f.state, 0, { x: 0, y: 11, w: 6, h: 1, color: 2 });
  for (let t = 0; t < 3; t++) f.run(1);
  console.log('  blocks left: ' + f.state.players[0].garbage.length);
}

console.log('C: landed block, support cleared underneath');
{
  const rows = emptyRows();
  rows[9] = 'RRR...';
  const f = fixture({ board: rows });
  addGarbage(f.state, 0, { x: 0, y: 10, w: 6, h: 1, color: 0, falling: false });
  addGarbage(f.state, 0, { x: 0, y: 11, w: 6, h: 1, color: 3, falling: false });
  for (let t = 0; t < 4; t++) f.run(1);
  console.log('  after 4: ' + JSON.stringify(f.state.players[0].garbage.map((b) => ({ y: b.y, h: b.h, falling: b.falling }))));
  f.run(60);
  console.log('  after 64: ' + JSON.stringify(f.state.players[0].garbage.map((b) => ({ y: b.y, h: b.h, falling: b.falling }))));
}

console.log('D: holding the swap button for 60 frames');
{
  const rows = emptyRows();
  rows[11] = 'RCRCR.';
  const f = fixture({ board: rows, cursor: { x: 0, y: 11 } });
  let swaps = 0;
  for (let t = 0; t < 60; t++) {
    const before = f.state.players[0].cursor.swapCooldown;
    f.run(1, () => [16, 0]);
    const after = f.state.players[0].cursor.swapCooldown;
    if (before === 0 && after > 0) swaps += 1;
  }
  console.log('  swaps started: ' + swaps);
}

