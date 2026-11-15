import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBrrBlock, SnesApuSystem, Spc700 } from '../tools/snes-apu.ts';
import { detectAudioLoop, type OstManifest } from '../tools/rip-snes-audio.ts';

describe('SNES SPC700 + S-DSP Audio Ripper Core', () => {
  it('decodes BRR blocks accurately across filters 0..3 and shift 13 clipping', () => {
    const aram = new Uint8Array(0x100);
    const out = new Int16Array(16);

    // Filter 0, shift 4: nibbles +3 and -2 -> d = (3 << 4)>>1 = 24, (-2 << 4)>>1 = -16; stored << 1
    aram[0] = (4 << 4) | (0 << 2);
    aram[1] = 0x3e; // hi=3, lo=-2 (0xE = -2)
    const r0 = decodeBrrBlock(aram, 0, 0, 0, out, 0);
    assert.equal(out[0], 48);
    assert.equal(out[1], -32);
    assert.equal(r0.end, false);
    assert.equal(r0.loop, false);

    // Filter 1 with p1=1000: sample adds p1 + ((-p1) >> 4) = 937
    aram[0] = (0 << 4) | (1 << 2) | 0x03; // end+loop set
    aram[1] = 0x00;
    const r1 = decodeBrrBlock(aram, 0, 1000, 0, out, 0);
    assert.equal(out[0], 1874);
    assert.equal(r1.end, true);
    assert.equal(r1.loop, true);

    // Filter 2 & 3 exact IIR prediction (61/32*p1 - 15/16*p2 and 115/64*p1 - 13/16*p2)
    aram[0] = (5 << 4) | (2 << 2);
    aram[1] = 0x71;
    const r2 = decodeBrrBlock(aram, 0, 500, 200, out, 0);
    assert.equal(out[0], 1754);
    assert.equal(r2.prev1, 129);
    assert.equal(r2.prev2, 402);

    aram[0] = (5 << 4) | (3 << 2);
    const r3 = decodeBrrBlock(aram, 0, 500, 200, out, 0);
    assert.equal(out[0], 1694);
    assert.equal(r3.prev1, 1021);
    assert.equal(r3.prev2, 1116);

    // Shift 13..15 hardware quirk: negative nibble -> -2048, positive/zero -> 0
    aram[0] = (13 << 4);
    aram[1] = 0x7f; // hi=+7 -> 0, lo=-1 -> -2048 (*2 = -4096)
    decodeBrrBlock(aram, 0, 0, 0, out, 0);
    assert.equal(out[0], 0);
    assert.equal(out[1], -4096);
  });

  it('boots Nintendo IPL ROM to $AA/$BB handshake and handles $F1 port clears & MUL YA', () => {
    const spc = new Spc700();
    spc.stepCycles(4000);
    assert.equal(spc.apuToCpu[0], 0xaa);
    assert.equal(spc.apuToCpu[1], 0xbb);

    // Writing $F1 bits 4 & 5 clears cpuToApu latches
    spc.cpuToApu.set([0x11, 0x22, 0x33, 0x44]);
    spc.write8(0x00f1, 0x30);
    assert.deepEqual(Array.from(spc.cpuToApu), [0, 0, 0, 0]);

    // Timer 0 (8 kHz): divider 128 * target 2 = 256 cycles per increment, cleared on read
    spc.write8(0x00fa, 2);
    spc.write8(0x00f1, 0x81); // enable Timer 0
    spc.stepCycles(560);
    const cnt = spc.read8(0x00fd);
    assert.ok(cnt >= 2, `Expected timer 0 count >= 2, got ${cnt}`);
    assert.equal(spc.read8(0x00fd), 0);

    // Hardware quirk: MUL YA ($CF) sets N and Z strictly from Y (high byte)
    spc.reset();
    spc.iplEnabled = false;
    spc.pc = 0x0200;
    spc.aram[0x0200] = 0xcf; // MUL YA
    spc.a = 0x80;
    spc.y = 0x01; // 0x0080 -> Y = 0x00, so Z=1, N=0 even though YA=0x0080 != 0!
    spc.stepInstruction();
    assert.equal(spc.a, 0x80);
    assert.equal(spc.y, 0x00);
    assert.equal((spc.psw & 0x02) !== 0, true);
    assert.equal((spc.psw & 0x80) !== 0, false);
  });

  it('synthesizes stereo PCM output on KON and exports valid 66048-byte .spc snapshot', () => {
    const dummyRom = new Uint8Array(0x8000);
    const sys = new SnesApuSystem(dummyRom);
    sys.spc.iplEnabled = false;
    sys.spc.pc = 0x0400;
    sys.spc.aram[0x0400] = 0x2f; // BRA $0400 (tight idle loop)
    sys.spc.aram[0x0401] = 0xfe;

    // Sample directory at $1000, BRR sample at $2000 (looping square-like BRR block)
    sys.spc.aram[0x1000] = 0x00;
    sys.spc.aram[0x1001] = 0x20;
    sys.spc.aram[0x1002] = 0x00;
    sys.spc.aram[0x1003] = 0x20;
    sys.spc.aram[0x2000] = 0x93; // shift=9, end+loop
    for (let i = 1; i <= 8; i++) {
      sys.spc.aram[0x2000 + i] = i <= 4 ? 0x66 : 0xaa;
    }

    sys.spc.dsp.writeReg(0x5d, 0x10); // DIR = $1000
    sys.spc.dsp.writeReg(0x6c, 0x20); // Unmute, ECEN=1
    sys.spc.dsp.writeReg(0x0c, 0x7f); // MVOLL
    sys.spc.dsp.writeReg(0x1c, 0x7f); // MVOLR
    sys.spc.dsp.writeReg(0x00, 0x7f); // V0 VOLL
    sys.spc.dsp.writeReg(0x01, 0x7f); // V0 VOLR
    sys.spc.dsp.writeReg(0x02, 0x00); // Pitch low
    sys.spc.dsp.writeReg(0x03, 0x10); // Pitch high ($1000 = 1.0x)
    sys.spc.dsp.writeReg(0x04, 0x00); // SRCN = 0
    sys.spc.dsp.writeReg(0x05, 0xef); // ADSR1 enabled, max AR=15, DR=6
    sys.spc.dsp.writeReg(0x06, 0xe0); // ADSR2
    sys.spc.dsp.writeReg(0x4c, 0x01); // KON voice 0

    const res = sys.renderPcm(0.1);
    assert.equal(res.sampleCount, 3200);
    assert.ok(res.peak > 500, `Expected non-silent DSP peak, got ${res.peak}`);
    assert.ok(res.rms > 100, `Expected audible DSP RMS, got ${res.rms}`);

    const spcFile = sys.exportSpc({ songTitle: 'Unit Test Tone', gameTitle: 'Panel de Pon' });
    assert.equal(spcFile.length, 66048);
    assert.equal(Buffer.from(spcFile.subarray(0, 27)).toString('ascii'), 'SNES-SPC700 Sound File Data');
  });

  it('detectAudioLoop identifies exact multi-loop period after a distinct intro', () => {
    const sampleRate = 32000;
    const introSec = 4;
    const periodSec = 12.5;
    const totalSec = 45;
    const introFrames = Math.round(introSec * sampleRate);
    const periodFrames = Math.round(periodSec * sampleRate);
    const totalFrames = Math.round(totalSec * sampleRate);
    const pcm = new Int16Array(totalFrames * 2);

    for (let f = 0; f < totalFrames; f++) {
      let s: number;
      if (f < introFrames) {
        // Distinct quiet decaying intro fanfare so t0=2s differs strongly from loop tail
        const t = f / sampleRate;
        const env = 2800 * Math.exp(-t * 0.6);
        s = Math.round(env * Math.sin(2 * Math.PI * 220 * t));
      } else {
        const pf = (f - introFrames) % periodFrames;
        const tp = pf / sampleRate;
        // Rich non-periodic envelope across the 12.5s phrase with sharp beats + slow swell
        const beat = Math.sin(2 * Math.PI * (tp / 1.25));
        const phrase = Math.sin(2 * Math.PI * (tp / periodSec) + 0.4) + 0.5 * Math.cos(2 * Math.PI * ((2 * tp) / periodSec));
        const env = Math.max(800, 12000 * (0.45 + 0.35 * phrase + 0.25 * beat));
        s = Math.round(env * Math.sin(2 * Math.PI * 330 * tp));
      }
      pcm[f * 2] = s;
      pcm[f * 2 + 1] = -s;
    }

    const loop = detectAudioLoop(pcm, sampleRate, {
      minLagSec: 8,
      maxLagSec: 25,
      maxT0Sec: 10,
      minBodySec: 20,
    });
    assert.ok(loop !== null, 'Expected synthetic intro + 3x12.5s loop PCM to detect a loop');
    assert.ok(
      Math.abs(loop.loopPeriodSec - periodSec) < 0.05,
      `Expected ~${periodSec}s loop period, got ${loop.loopPeriodSec}s`
    );
    assert.ok(loop.loopStartSec >= introSec, `Expected loopStartSec >= ${introSec}, got ${loop.loopStartSec}`);
    assert.ok(loop.loopEndSec > loop.loopStartSec, 'Expected loopEndSec > loopStartSec');
    assert.ok(
      loop.fadeStartFrame > loop.loopEndSec * sampleRate,
      `Expected fadeStartFrame (${loop.fadeStartFrame}) strictly after loopEndSec (${loop.loopEndSec * sampleRate})`
    );
  });

  it('manifest.json contains all 58 tracks with full multi-loop durations for Panel de Pon themes', () => {
    const manifestPath = fileURLToPath(new URL('../public/ost/manifest.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OstManifest;
    assert.equal(manifest.tracks.length, 58);

    for (const id of ['pdp-03-menu', 'pdp-0a-lip', 'pdp-0b-windy', 'pdp-0c-elias', 'pdp-15-corderia']) {
      const track = manifest.tracks.find((t) => t.id === id);
      assert.ok(track, `Missing OST manifest entry for ${id}`);
      assert.ok(track.durationSec >= 120, `Expected ${id} durationSec >= 120, got ${track.durationSec}`);
      assert.equal(typeof track.loopStartSec, 'number', `Missing loopStartSec for ${id}`);
      assert.equal(typeof track.loopEndSec, 'number', `Missing loopEndSec for ${id}`);
      assert.ok(
        (track.loopStartSec as number) < (track.loopEndSec as number),
        `Expected loopStartSec < loopEndSec for ${id}`
      );
      assert.ok((track.loopPeriodSec ?? 0) >= 30, `Expected loopPeriodSec >= 30 for ${id}, got ${track.loopPeriodSec}`);
    }
  });
});
