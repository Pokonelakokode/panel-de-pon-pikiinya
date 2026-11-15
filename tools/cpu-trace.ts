import { createMatch, createRules, step } from '../src/core/simulate.ts';
import { CpuPlayer } from '../src/ai/cpu.ts';
const seed = 1234;
const rules = createRules('vs', 'normal');
const state = createMatch(seed, 'vs', 'normal');
const cpu = new CpuPlayer('normal', seed);
for (let t = 1; t <= 1800; t++) {
  const buttons = cpu.sample(state.players[1]);
  step(state, [{ buttons: 0 }, { buttons }], rules);
  if (t % 300 === 0) {
    const b = state.players[1];
    console.log('t=' + String(t).padStart(4) + ' buttons=' + String(buttons).padStart(3) + ' cursor=(' + b.cursor.x + ',' + b.cursor.y + ') cleared=' + b.panelsCleared + ' level=' + b.speed + ' outgoing=' + state.players[0].incoming.length + ' garbage=' + state.players[0].garbage.length);
  }
}
