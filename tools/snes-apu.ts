// Hardware-accurate Sony S-DSP (BRR/Gaussian/ADSR/Echo), Sony SPC700 (S-SMP),
// and WDC 65C816 LoROM bridge for ripping authentic SNES audio (.spc + PCM).

export interface SpcMetadata {
  songTitle?: string;
  gameTitle?: string;
  dumper?: string;
  comments?: string;
  durationSec?: number;
  fadeMs?: number;
}

// Standard 512-entry SNES S-DSP Gaussian interpolation table (12-bit signed filter coefficients).
// prettier-ignore
const GAUSS_TABLE = new Int32Array([
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     1,    1,    1,    1,    1,    1,    1,    1,    1,    1,    1,    2,    2,    2,    2,    2,
     2,    2,    3,    3,    3,    3,    3,    4,    4,    4,    4,    4,    5,    5,    5,    5,
     6,    6,    6,    6,    7,    7,    7,    8,    8,    8,    9,    9,    9,   10,   10,   10,
    11,   11,   11,   12,   12,   13,   13,   14,   14,   15,   15,   15,   16,   16,   17,   17,
    18,   19,   19,   20,   20,   21,   21,   22,   23,   23,   24,   24,   25,   26,   27,   27,
    28,   29,   29,   30,   31,   32,   32,   33,   34,   35,   36,   36,   37,   38,   39,   40,
    41,   42,   43,   44,   45,   46,   47,   48,   49,   50,   51,   52,   53,   54,   55,   56,
    58,   59,   60,   61,   62,   64,   65,   66,   67,   69,   70,   71,   73,   74,   76,   77,
    78,   80,   81,   83,   84,   86,   87,   89,   90,   92,   94,   95,   97,   99,  100,  102,
   104,  106,  107,  109,  111,  113,  115,  117,  118,  120,  122,  124,  126,  128,  130,  132,
   134,  137,  139,  141,  143,  145,  147,  150,  152,  154,  156,  159,  161,  163,  166,  168,
   171,  173,  175,  178,  180,  183,  186,  188,  191,  193,  196,  199,  201,  204,  207,  210,
   212,  215,  218,  221,  224,  227,  230,  233,  236,  239,  242,  245,  248,  251,  254,  257,
   260,  263,  267,  270,  273,  276,  280,  283,  286,  290,  293,  297,  300,  304,  307,  311,
   314,  318,  321,  325,  328,  332,  336,  339,  343,  347,  351,  354,  358,  362,  366,  370,
   374,  378,  381,  385,  389,  393,  397,  401,  405,  410,  414,  418,  422,  426,  430,  434,
   439,  443,  447,  451,  456,  460,  464,  469,  473,  477,  482,  486,  491,  495,  499,  504,
   508,  513,  517,  522,  527,  531,  536,  540,  545,  550,  554,  559,  563,  568,  573,  577,
   582,  587,  592,  596,  601,  606,  611,  615,  620,  625,  630,  635,  640,  644,  649,  654,
   659,  664,  669,  674,  678,  683,  688,  693,  698,  703,  708,  713,  718,  723,  728,  732,
   737,  742,  747,  752,  757,  762,  767,  772,  777,  782,  787,  792,  797,  802,  806,  811,
   816,  821,  826,  831,  836,  841,  846,  851,  855,  860,  865,  870,  875,  880,  884,  889,
   894,  899,  904,  908,  913,  918,  923,  927,  932,  937,  941,  946,  951,  955,  960,  965,
   969,  974,  978,  983,  988,  992,  997, 1001, 1005, 1010, 1014, 1019, 1023, 1027, 1032, 1036,
  1040, 1045, 1049, 1053, 1057, 1061, 1066, 1070, 1074, 1078, 1082, 1086, 1090, 1094, 1098, 1102,
  1106, 1109, 1113, 1117, 1121, 1125, 1128, 1132, 1136, 1139, 1143, 1146, 1150, 1153, 1157, 1160,
  1164, 1167, 1170, 1174, 1177, 1180, 1183, 1186, 1190, 1193, 1196, 1199, 1202, 1205, 1207, 1210,
  1213, 1216, 1219, 1221, 1224, 1227, 1229, 1232, 1234, 1237, 1239, 1241, 1244, 1246, 1248, 1251,
  1253, 1255, 1257, 1259, 1261, 1263, 1265, 1267, 1269, 1271, 1273, 1275, 1276, 1278, 1280, 1281,
  1283, 1284, 1286, 1287, 1289, 1290, 1291, 1293, 1294, 1295, 1296, 1297, 1298, 1299, 1300, 1301,
  1302, 1303, 1304, 1304, 1305, 1306, 1306, 1307, 1307, 1308, 1308, 1308, 1309, 1309, 1309, 1309,
]);

// Hardware envelope rate period and offset tables (0..31).
const ENV_PERIOD = new Int32Array([
  0, 2048, 1536, 1280, 1024, 768, 640, 512,
  384, 320, 256, 192, 160, 128, 96, 80,
  64, 48, 40, 32, 24, 20, 16, 12,
  10, 8, 6, 5, 4, 3, 2, 1,
]);

const ENV_OFFSET = new Int32Array([
  0, 0, 1040, 536, 0, 1040, 536, 0,
  1040, 536, 0, 1040, 536, 0, 1040, 536,
  0, 1040, 536, 0, 1040, 536, 0, 1040,
  536, 0, 1040, 536, 0, 1040, 0, 0,
]);

// 64-byte Nintendo SPC700 IPL ROM ($FFC0..$FFFF).
// prettier-ignore
export const SPC_IPL_ROM = new Uint8Array([
  0xcd, 0xef, 0xbd, 0xe8, 0x00, 0xc6, 0x1d, 0xd0, 0xfc, 0x8f, 0xaa, 0xf4, 0x8f, 0xbb, 0xf5, 0x78,
  0xcc, 0xf4, 0xd0, 0xfb, 0x2f, 0x19, 0xeb, 0xf4, 0xd0, 0xfc, 0x7e, 0xf4, 0xd0, 0x0b, 0xe4, 0xf5,
  0xcb, 0xf4, 0xd7, 0x00, 0xfc, 0xd0, 0xf3, 0xab, 0x01, 0x10, 0xef, 0x7e, 0xf4, 0x10, 0xeb, 0xba,
  0xf6, 0xda, 0x00, 0xba, 0xf4, 0xc4, 0xf4, 0xdd, 0x5d, 0xd0, 0xdb, 0x1f, 0x00, 0x00, 0xc0, 0xff,
]);

function clamp16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

function clamp15(v: number): number {
  const c = clamp16(v);
  return (c << 17) >> 17;
}

function s8(v: number): number {
  return (v << 24) >> 24;
}

export function decodeBrrBlock(
  bytes: Uint8Array,
  offset: number,
  prev1: number,
  prev2: number,
  outSamples: Int16Array,
  outStart = 0
): { prev1: number; prev2: number; end: boolean; loop: boolean } {
  const header = bytes[offset & 0xffff];
  const shift = (header >> 4) & 0x0f;
  const filter = (header >> 2) & 0x03;
  const loop = (header & 0x02) !== 0;
  const end = (header & 0x01) !== 0;

  let p1 = prev1;
  let p2 = prev2;

  for (let i = 0; i < 8; i++) {
    const b = bytes[(offset + 1 + i) & 0xffff];
    for (let nibIdx = 0; nibIdx < 2; nibIdx++) {
      const rawNib = nibIdx === 0 ? b >> 4 : b & 0x0f;
      const nib = (rawNib << 28) >> 28; // signed -8..7
      let s = shift <= 12 ? (nib << shift) >> 1 : nib < 0 ? -2048 : 0;

      if (filter === 1) {
        s += p1 + ((-p1) >> 4);
      } else if (filter === 2) {
        s += (p1 << 1) + ((-((p1 << 1) + p1)) >> 5) - p2 + (p2 >> 4);
      } else if (filter === 3) {
        s += (p1 << 1) + ((-(p1 + (p1 << 2) + (p1 << 3))) >> 6) - p2 + (((p2 << 1) + p2) >> 4);
      }

      const clipped = clamp15(s);
      p2 = p1;
      p1 = clipped;
      outSamples[outStart + i * 2 + nibIdx] = clipped << 1;
    }
  }

  return { prev1: p1, prev2: p2, end, loop };
}

type EnvMode = 'attack' | 'decay' | 'sustain' | 'release';

interface DspVoice {
  blockBuf: Int16Array; // [0..2] previous block tail, [3..18] current 16 BRR samples
  brrAddr: number;
  prev1: number;
  prev2: number;
  blockEnd: boolean;
  blockLoop: boolean;
  pitchCounter: number;
  env: number; // 0..0x7FF
  envMode: EnvMode;
  konDelay: number;
  active: boolean;
  lastOut: number;
  konCount: number;
}

export class SnesDsp {
  public readonly regs = new Uint8Array(128);
  private readonly aram: Uint8Array;
  private readonly voices: DspVoice[];
  private readonly echoHistL = new Int32Array(8);
  private readonly echoHistR = new Int32Array(8);
  private echoHistPos = 0;
  private echoOffset = 0;
  private envCounter = 0;
  private noiseSample = 0x4000;
  private konLatch = 0;
  private koffLatch = 0;
  public totalKonEvents = 0;

  constructor(aram: Uint8Array) {
    this.aram = aram;
    this.voices = Array.from({ length: 8 }, () => ({
      blockBuf: new Int16Array(19),
      brrAddr: 0,
      prev1: 0,
      prev2: 0,
      blockEnd: false,
      blockLoop: false,
      pitchCounter: 0,
      env: 0,
      envMode: 'release',
      konDelay: 0,
      active: false,
      lastOut: 0,
      konCount: 0,
    }));
    this.reset();
  }

  public reset(): void {
    this.regs.fill(0);
    this.regs[0x6c] = 0xe0; // Soft reset / Mute / Echo write disabled at boot
    this.echoHistL.fill(0);
    this.echoHistR.fill(0);
    this.echoHistPos = 0;
    this.echoOffset = 0;
    this.envCounter = 0;
    this.noiseSample = 0x4000;
    this.konLatch = 0;
    this.koffLatch = 0;
    this.totalKonEvents = 0;
    for (const v of this.voices) {
      v.blockBuf.fill(0);
      v.brrAddr = 0;
      v.prev1 = 0;
      v.prev2 = 0;
      v.blockEnd = false;
      v.blockLoop = false;
      v.pitchCounter = 0;
      v.env = 0;
      v.envMode = 'release';
      v.konDelay = 0;
      v.active = false;
      v.lastOut = 0;
      v.konCount = 0;
    }
  }

  public readReg(addr: number): number {
    return this.regs[addr & 0x7f];
  }

  public writeReg(addr: number, val: number): void {
    const reg = addr & 0x7f;
    const v = val & 0xff;
    if (reg === 0x7c) {
      // Writing ENDX clears all ENDX bits regardless of written value
      this.regs[0x7c] = 0;
      return;
    }
    this.regs[reg] = v;
    if (reg === 0x4c) {
      this.konLatch = v;
    } else if (reg === 0x5c) {
      this.koffLatch = v;
    } else if (reg === 0x6c && (v & 0x80) !== 0) {
      // Soft reset bit
      for (const voice of this.voices) {
        voice.active = false;
        voice.env = 0;
        voice.envMode = 'release';
      }
    }
  }

  private rateTick(rate: number): boolean {
    if (rate === 0) return false;
    const period = ENV_PERIOD[rate];
    const offset = ENV_OFFSET[rate];
    return ((this.envCounter + offset) % period) === 0;
  }

  private getSampleDirEntry(srcn: number): { startAddr: number; loopAddr: number } {
    const dir = this.regs[0x5d] << 8;
    const base = (dir + (srcn << 2)) & 0xffff;
    const startAddr = this.aram[base] | (this.aram[(base + 1) & 0xffff] << 8);
    const loopAddr = this.aram[(base + 2) & 0xffff] | (this.aram[(base + 3) & 0xffff] << 8);
    return { startAddr, loopAddr };
  }

  private startVoice(vi: number): void {
    const voice = this.voices[vi];
    const baseReg = vi << 4;
    const srcn = this.regs[baseReg | 0x04];
    const { startAddr } = this.getSampleDirEntry(srcn);

    voice.brrAddr = startAddr;
    voice.prev1 = 0;
    voice.prev2 = 0;
    voice.blockBuf.fill(0);
    voice.pitchCounter = 0;
    voice.env = 0;
    voice.envMode = 'attack';
    voice.konDelay = 5;
    voice.active = true;
    voice.lastOut = 0;
    voice.konCount++;
    this.totalKonEvents++;
    this.regs[0x7c] &= ~(1 << vi);

    const decoded = decodeBrrBlock(this.aram, voice.brrAddr, voice.prev1, voice.prev2, voice.blockBuf, 3);
    voice.prev1 = decoded.prev1;
    voice.prev2 = decoded.prev2;
    voice.blockEnd = decoded.end;
    voice.blockLoop = decoded.loop;
  }

  private updateVoiceEnvelope(vi: number): void {
    const voice = this.voices[vi];
    if (!voice.active) {
      voice.env = 0;
      return;
    }

    if (voice.konDelay > 0) {
      voice.konDelay--;
      voice.env = 0;
      return;
    }

    const baseReg = vi << 4;
    const adsr1 = this.regs[baseReg | 0x05];
    const adsr2 = this.regs[baseReg | 0x06];
    const gain = this.regs[baseReg | 0x07];

    if (voice.envMode === 'release') {
      voice.env -= 8;
      if (voice.env <= 0) {
        voice.env = 0;
        voice.active = false;
      }
      return;
    }

    let rate = 0;
    if ((adsr1 & 0x80) !== 0) {
      if (voice.envMode === 'attack') {
        rate = ((adsr1 & 0x0f) << 1) | 1;
        if (rate === 31) {
          voice.env += 1024;
        } else if (this.rateTick(rate)) {
          voice.env += 32;
        }
        if (voice.env >= 0x7ff) {
          voice.env = 0x7ff;
          voice.envMode = 'decay';
        }
      } else if (voice.envMode === 'decay') {
        rate = ((adsr1 & 0x70) >> 3) + 16;
        if (this.rateTick(rate)) {
          voice.env -= ((voice.env - 1) >> 8) + 1;
        }
        const sl = (((adsr2 >> 5) & 7) + 1) * 0x100;
        if (voice.env <= sl) {
          voice.envMode = 'sustain';
        }
      } else {
        rate = adsr2 & 0x1f;
        if (this.rateTick(rate)) {
          voice.env -= ((voice.env - 1) >> 8) + 1;
        }
      }
    } else {
      // Custom GAIN mode
      if ((gain & 0x80) === 0) {
        voice.env = (gain & 0x7f) << 4;
      } else {
        const mode = (gain >> 5) & 3;
        rate = gain & 0x1f;
        if (this.rateTick(rate)) {
          if (mode === 0) {
            voice.env -= 32;
          } else if (mode === 1) {
            voice.env -= ((voice.env - 1) >> 8) + 1;
          } else if (mode === 2) {
            voice.env += 32;
          } else {
            voice.env += voice.env < 0x600 ? 32 : 8;
          }
        }
      }
    }

    if (voice.env < 0) voice.env = 0;
    if (voice.env > 0x7ff) voice.env = 0x7ff;
  }

  public stepSample(): [number, number] {
    // Advance global envelope counter and noise LFSR once per 32 kHz sample
    this.envCounter = (this.envCounter + 1) % 30720;
    const flg = this.regs[0x6c];
    const noiseRate = flg & 0x1f;
    if (this.rateTick(noiseRate)) {
      const bit = ((this.noiseSample << 14) ^ (this.noiseSample << 13)) & 0x4000;
      this.noiseSample = (this.noiseSample >> 1) | bit;
    }

    const pmon = this.regs[0x2d];
    const non = this.regs[0x3d];
    const eon = this.regs[0x4d];

    // Latch KON / KOF cleanly on sample boundary
    if (this.konLatch !== 0) {
      for (let i = 0; i < 8; i++) {
        if ((this.konLatch & (1 << i)) !== 0) {
          this.startVoice(i);
        }
      }
      this.konLatch = 0;
      this.regs[0x4c] = 0;
    }
    const koffMask = this.koffLatch | this.regs[0x5c];
    if (koffMask !== 0) {
      for (let i = 0; i < 8; i++) {
        if ((koffMask & (1 << i)) !== 0 && this.voices[i].active && this.voices[i].konDelay === 0) {
          this.voices[i].envMode = 'release';
        }
      }
      this.koffLatch = 0;
    }

    let mainL = 0;
    let mainR = 0;
    let echoInL = 0;
    let echoInR = 0;

    for (let vi = 0; vi < 8; vi++) {
      const voice = this.voices[vi];
      const baseReg = vi << 4;

      if (!voice.active) {
        this.regs[baseReg | 0x08] = 0;
        this.regs[baseReg | 0x09] = 0;
        voice.lastOut = 0;
        continue;
      }

      let rawSample = 0;
      if (voice.konDelay === 0) {
        if ((non & (1 << vi)) !== 0) {
          rawSample = ((this.noiseSample << 17) >> 17) << 1;
        } else {
          const pos = (voice.pitchCounter >> 12) & 0x0f;
          const g = (voice.pitchCounter >> 4) & 0xff;
          const s0 = voice.blockBuf[pos] >> 1;
          const s1 = voice.blockBuf[pos + 1] >> 1;
          const s2 = voice.blockBuf[pos + 2] >> 1;
          const s3 = voice.blockBuf[pos + 3] >> 1;
          rawSample =
            ((GAUSS_TABLE[255 - g] * s0) >> 11) +
            ((GAUSS_TABLE[511 - g] * s1) >> 11) +
            ((GAUSS_TABLE[256 + g] * s2) >> 11) +
            ((GAUSS_TABLE[g] * s3) >> 11);
          rawSample = clamp15(rawSample) << 1;
        }
      }

      this.updateVoiceEnvelope(vi);

      // Voice output (16-bit signed)
      let out = voice.konDelay > 0 || !voice.active ? 0 : (rawSample * voice.env) >> 11;
      out = clamp16(out);
      voice.lastOut = out;

      this.regs[baseReg | 0x08] = (voice.env >> 4) & 0xff;
      this.regs[baseReg | 0x09] = (out >> 8) & 0xff;

      const volL = s8(this.regs[baseReg | 0x00]);
      const volR = s8(this.regs[baseReg | 0x01]);
      const vL = (out * volL) >> 7;
      const vR = (out * volR) >> 7;
      mainL += vL;
      mainR += vR;
      if ((eon & (1 << vi)) !== 0) {
        echoInL += vL;
        echoInR += vR;
      }

      // Advance BRR pitch counter
      if (voice.konDelay === 0 && voice.active) {
        let pitch = (this.regs[baseReg | 0x02] | ((this.regs[baseReg | 0x03] & 0x3f) << 8)) & 0x3fff;
        if (vi > 0 && (pmon & (1 << vi)) !== 0 && (non & (1 << vi)) === 0) {
          const factor = (this.voices[vi - 1].lastOut >> 5) + 0x400;
          pitch = Math.min(0x3fff, Math.max(0, (pitch * factor) >> 10));
        }
        voice.pitchCounter += pitch;
        if (voice.pitchCounter >= 0x10000) {
          voice.pitchCounter -= 0x10000;
          voice.blockBuf[0] = voice.blockBuf[16];
          voice.blockBuf[1] = voice.blockBuf[17];
          voice.blockBuf[2] = voice.blockBuf[18];

          if (voice.blockEnd) {
            this.regs[0x7c] |= 1 << vi;
            if (voice.blockLoop) {
              const srcn = this.regs[baseReg | 0x04];
              voice.brrAddr = this.getSampleDirEntry(srcn).loopAddr;
            } else {
              voice.active = false;
              voice.env = 0;
              voice.envMode = 'release';
              continue;
            }
          } else {
            voice.brrAddr = (voice.brrAddr + 9) & 0xffff;
          }

          const decoded = decodeBrrBlock(this.aram, voice.brrAddr, voice.prev1, voice.prev2, voice.blockBuf, 3);
          voice.prev1 = decoded.prev1;
          voice.prev2 = decoded.prev2;
          voice.blockEnd = decoded.end;
          voice.blockLoop = decoded.loop;
        }
      }
    }

    // Echo buffer & 8-tap FIR filter
    const esa = this.regs[0x6d] << 8;
    const echoAddr = (esa + this.echoOffset) & 0xffff;
    const rawEchoL = this.aram[echoAddr] | (this.aram[(echoAddr + 1) & 0xffff] << 8);
    const rawEchoR = this.aram[(echoAddr + 2) & 0xffff] | (this.aram[(echoAddr + 3) & 0xffff] << 8);
    this.echoHistL[this.echoHistPos] = ((rawEchoL << 16) >> 16) >> 1;
    this.echoHistR[this.echoHistPos] = ((rawEchoR << 16) >> 16) >> 1;

    let firL = 0;
    let firR = 0;
    for (let tap = 0; tap < 8; tap++) {
      const idx = (this.echoHistPos + 1 + tap) & 7;
      const coeff = s8(this.regs[(tap << 4) | 0x0f]);
      firL += (this.echoHistL[idx] * coeff) >> 6;
      firR += (this.echoHistR[idx] * coeff) >> 6;
    }
    firL = clamp16(firL);
    firR = clamp16(firR);
    this.echoHistPos = (this.echoHistPos + 1) & 7;

    // Echo write back into ARAM when FLG bit 5 (ECEN) is clear
    if ((flg & 0x20) === 0) {
      const efb = s8(this.regs[0x0d]);
      const writeL = clamp16(echoInL + ((firL * efb) >> 7)) & 0xfffe;
      const writeR = clamp16(echoInR + ((firR * efb) >> 7)) & 0xfffe;
      this.aram[echoAddr] = writeL & 0xff;
      this.aram[(echoAddr + 1) & 0xffff] = (writeL >> 8) & 0xff;
      this.aram[(echoAddr + 2) & 0xffff] = writeR & 0xff;
      this.aram[(echoAddr + 3) & 0xffff] = (writeR >> 8) & 0xff;
    }

    const edl = this.regs[0x7d] & 0x0f;
    const echoBufLen = edl === 0 ? 4 : edl << 11;
    this.echoOffset += 4;
    if (this.echoOffset >= echoBufLen) {
      this.echoOffset = 0;
    }

    if ((flg & 0x40) !== 0) {
      // MUTE bit in FLG
      return [0, 0];
    }

    const mvolL = s8(this.regs[0x0c]);
    const mvolR = s8(this.regs[0x1c]);
    const evolL = s8(this.regs[0x2c]);
    const evolR = s8(this.regs[0x3c]);

    const finalL = clamp16(((mainL * mvolL) >> 7) + ((firL * evolL) >> 7));
    const finalR = clamp16(((mainR * mvolR) >> 7) + ((firR * evolR) >> 7));
    return [finalL, finalR];
  }
}

interface SpcTimer {
  enabled: boolean;
  target: number; // 0..255 (0 means 256)
  stage1: number; // prescaler cycles
  stage2: number; // ticks toward target
  counter: number; // 4-bit readable output counter ($FD..$FF)
}

export class Spc700 {
  public readonly aram = new Uint8Array(0x10000);
  public readonly dsp: SnesDsp;
  public readonly cpuToApu = new Uint8Array(4);
  public readonly apuToCpu = new Uint8Array(4);

  public a = 0;
  public x = 0;
  public y = 0;
  public sp = 0xef;
  public pc = 0xffc0;
  public psw = 0x02;

  public control = 0x80; // $F1
  public dspAddr = 0; // $F2
  public iplEnabled = true;

  private readonly timers: [SpcTimer, SpcTimer, SpcTimer] = [
    { enabled: false, target: 0, stage1: 0, stage2: 0, counter: 0 },
    { enabled: false, target: 0, stage1: 0, stage2: 0, counter: 0 },
    { enabled: false, target: 0, stage1: 0, stage2: 0, counter: 0 },
  ];

  private dspCycleAcc = 0;
  private sampleSink: ((l: number, r: number) => void) | null = null;
  public totalCycles = 0;
  public stopped = false;

  constructor() {
    this.dsp = new SnesDsp(this.aram);
    this.reset();
  }

  public reset(): void {
    this.aram.fill(0);
    this.dsp.reset();
    this.cpuToApu.fill(0);
    this.apuToCpu.fill(0);
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xef;
    this.pc = 0xffc0;
    this.psw = 0x02;
    this.control = 0x80;
    this.dspAddr = 0;
    this.iplEnabled = true;
    for (const t of this.timers) {
      t.enabled = false;
      t.target = 0;
      t.stage1 = 0;
      t.stage2 = 0;
      t.counter = 0;
    }
    this.dspCycleAcc = 0;
    this.totalCycles = 0;
    this.stopped = false;
  }

  public setSampleSink(sink: ((l: number, r: number) => void) | null): void {
    this.sampleSink = sink;
  }

  public read8(addr: number): number {
    const a = addr & 0xffff;
    if (a >= 0x00f0 && a <= 0x00ff) {
      if (a >= 0x00f4 && a <= 0x00f7) {
        return this.cpuToApu[a - 0xf4];
      }
      if (a === 0x00f2) {
        return this.dspAddr;
      }
      if (a === 0x00f3) {
        return this.dsp.readReg(this.dspAddr);
      }
      if (a >= 0x00fd) {
        const idx = a - 0x00fd;
        const val = this.timers[idx].counter & 0x0f;
        this.timers[idx].counter = 0;
        return val;
      }
    }
    if (this.iplEnabled && a >= 0xffc0) {
      return SPC_IPL_ROM[a - 0xffc0];
    }
    return this.aram[a];
  }

  public write8(addr: number, val: number): void {
    const a = addr & 0xffff;
    const v = val & 0xff;
    // Writes ALWAYS go through to underlying RAM even at $FFC0..$FFFF
    this.aram[a] = v;

    if (a === 0x00f1) {
      this.control = v;
      this.iplEnabled = (v & 0x80) !== 0;
      if ((v & 0x10) !== 0) {
        this.cpuToApu[0] = 0;
        this.cpuToApu[1] = 0;
      }
      if ((v & 0x20) !== 0) {
        this.cpuToApu[2] = 0;
        this.cpuToApu[3] = 0;
      }
      for (let t = 0; t < 3; t++) {
        const nextEn = (v & (1 << t)) !== 0;
        if (!this.timers[t].enabled && nextEn) {
          this.timers[t].stage2 = 0;
          this.timers[t].counter = 0;
        }
        this.timers[t].enabled = nextEn;
      }
    } else if (a === 0x00f2) {
      this.dspAddr = v & 0x7f;
    } else if (a === 0x00f3) {
      this.dsp.writeReg(this.dspAddr, v);
    } else if (a >= 0x00f4 && a <= 0x00f7) {
      this.apuToCpu[a - 0xf4] = v;
    } else if (a >= 0x00fa && a <= 0x00fc) {
      this.timers[a - 0x00fa].target = v;
    }
  }

  private dpBase(): number {
    return (this.psw & 0x20) !== 0 ? 0x0100 : 0x0000;
  }

  private readDP(dp: number): number {
    return this.read8(this.dpBase() | (dp & 0xff));
  }

  private writeDP(dp: number, val: number): void {
    this.write8(this.dpBase() | (dp & 0xff), val);
  }

  private read16(addr: number): number {
    return this.read8(addr) | (this.read8(addr + 1) << 8);
  }

  private readDP16(dp: number): number {
    const base = this.dpBase();
    const lo = this.read8(base | (dp & 0xff));
    const hi = this.read8(base | ((dp + 1) & 0xff));
    return lo | (hi << 8);
  }

  private writeDP16(dp: number, val: number): void {
    const base = this.dpBase();
    this.write8(base | (dp & 0xff), val & 0xff);
    this.write8(base | ((dp + 1) & 0xff), (val >> 8) & 0xff);
  }

  private fetch8(): number {
    const v = this.read8(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  private push8(val: number): void {
    this.aram[0x0100 | this.sp] = val & 0xff;
    this.sp = (this.sp - 1) & 0xff;
  }

  private pull8(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.aram[0x0100 | this.sp];
  }

  private setFlag(mask: number, on: boolean): void {
    if (on) this.psw |= mask;
    else this.psw &= ~mask;
  }

  private setNZ8(val: number): number {
    const v = val & 0xff;
    this.setFlag(0x80, (v & 0x80) !== 0);
    this.setFlag(0x02, v === 0);
    return v;
  }

  private setNZ16(val: number): number {
    const v = val & 0xffff;
    this.setFlag(0x80, (v & 0x8000) !== 0);
    this.setFlag(0x02, v === 0);
    return v;
  }

  private add8(a: number, b: number): number {
    const c = this.psw & 0x01;
    const sum = a + b + c;
    const res = sum & 0xff;
    this.setFlag(0x01, sum > 0xff);
    this.setFlag(0x08, (a & 0x0f) + (b & 0x0f) + c > 0x0f);
    this.setFlag(0x40, (~(a ^ b) & (a ^ res) & 0x80) !== 0);
    return this.setNZ8(res);
  }

  private sub8(a: number, b: number): number {
    const borrow = 1 - (this.psw & 0x01);
    const diff = a - b - borrow;
    const res = diff & 0xff;
    this.setFlag(0x01, diff >= 0);
    this.setFlag(0x08, (a & 0x0f) - (b & 0x0f) - borrow >= 0);
    this.setFlag(0x40, ((a ^ b) & (a ^ res) & 0x80) !== 0);
    return this.setNZ8(res);
  }

  private cmp8(a: number, b: number): void {
    const diff = a - b;
    this.setFlag(0x01, diff >= 0);
    this.setNZ8(diff & 0xff);
  }

  private branch(cond: boolean): number {
    const rel = s8(this.fetch8());
    if (cond) {
      this.pc = (this.pc + rel) & 0xffff;
      return 4;
    }
    return 2;
  }

  private advanceHardware(cycles: number): void {
    this.totalCycles += cycles;
    for (let t = 0; t < 3; t++) {
      const timer = this.timers[t];
      const div = t === 2 ? 16 : 128;
      timer.stage1 += cycles;
      while (timer.stage1 >= div) {
        timer.stage1 -= div;
        if (timer.enabled) {
          timer.stage2 = (timer.stage2 + 1) & 0xff;
          if (timer.stage2 === (timer.target & 0xff)) {
            timer.stage2 = 0;
            timer.counter = (timer.counter + 1) & 0x0f;
          }
        }
      }
    }

    this.dspCycleAcc += cycles;
    while (this.dspCycleAcc >= 32) {
      this.dspCycleAcc -= 32;
      const [l, r] = this.dsp.stepSample();
      if (this.sampleSink) {
        this.sampleSink(l, r);
      }
    }
  }

  public stepCycles(targetCycles: number): void {
    let spent = 0;
    while (spent < targetCycles && !this.stopped) {
      const cyc = this.stepInstruction();
      spent += cyc;
      this.advanceHardware(cyc);
    }
  }

  public stepInstruction(): number {
    if (this.stopped) return 4;
    const op = this.fetch8();

    switch (op) {
      case 0x00: // NOP
        return 2;
      case 0xef: // SLEEP
      case 0xff: // STOP
        this.stopped = true;
        return 3;

      // Branches
      case 0x2f: return this.branch(true); // BRA
      case 0xf0: return this.branch((this.psw & 0x02) !== 0); // BEQ
      case 0xd0: return this.branch((this.psw & 0x02) === 0); // BNE
      case 0xb0: return this.branch((this.psw & 0x01) !== 0); // BCS
      case 0x90: return this.branch((this.psw & 0x01) === 0); // BCC
      case 0x70: return this.branch((this.psw & 0x40) !== 0); // BVS
      case 0x50: return this.branch((this.psw & 0x40) === 0); // BVC
      case 0x30: return this.branch((this.psw & 0x80) !== 0); // BMI
      case 0x10: return this.branch((this.psw & 0x80) === 0); // BPL

      // BBS / BBC dp.bit, rel
      case 0x03: case 0x23: case 0x43: case 0x63: case 0x83: case 0xa3: case 0xc3: case 0xe3: {
        const bit = op >> 5;
        const v = this.readDP(this.fetch8());
        return this.branch((v & (1 << bit)) !== 0) + 3;
      }
      case 0x13: case 0x33: case 0x53: case 0x73: case 0x93: case 0xb3: case 0xd3: case 0xf3: {
        const bit = op >> 5;
        const v = this.readDP(this.fetch8());
        return this.branch((v & (1 << bit)) === 0) + 3;
      }

      // SET1 / CLR1 dp.bit
      case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xa2: case 0xc2: case 0xe2: {
        const bit = op >> 5;
        const dp = this.fetch8();
        this.writeDP(dp, this.readDP(dp) | (1 << bit));
        return 4;
      }
      case 0x12: case 0x32: case 0x52: case 0x72: case 0x92: case 0xb2: case 0xd2: case 0xf2: {
        const bit = op >> 5;
        const dp = this.fetch8();
        this.writeDP(dp, this.readDP(dp) & ~(1 << bit));
        return 4;
      }

      // CBNE & DBNZ
      case 0x2e: {
        const v = this.readDP(this.fetch8());
        return this.branch(this.a !== v) + 3;
      }
      case 0xde: {
        const v = this.readDP((this.fetch8() + this.x) & 0xff);
        return this.branch(this.a !== v) + 4;
      }
      case 0x6e: {
        const dp = this.fetch8();
        const nv = (this.readDP(dp) - 1) & 0xff;
        this.writeDP(dp, nv);
        return this.branch(nv !== 0) + 3;
      }
      case 0xfe: {
        this.y = (this.y - 1) & 0xff;
        return this.branch(this.y !== 0) + 2;
      }

      // Flag ops
      case 0x60: this.setFlag(0x01, false); return 2; // CLRC
      case 0x80: this.setFlag(0x01, true); return 2;  // SETC
      case 0xed: this.setFlag(0x01, (this.psw & 0x01) === 0); return 3; // NOTC
      case 0x20: this.setFlag(0x20, false); return 2; // CLRP
      case 0x40: this.setFlag(0x20, true); return 2;  // SETP
      case 0xe0: this.setFlag(0x48, false); return 2; // CLRV
      case 0xa0: this.setFlag(0x04, true); return 3;  // EI
      case 0xc0: this.setFlag(0x04, false); return 3; // DI

      // Jumps & Calls
      case 0x5f: this.pc = this.fetch16(); return 3; // JMP abs
      case 0x1f: {
        const ptr = (this.fetch16() + this.x) & 0xffff;
        this.pc = this.read16(ptr);
        return 6;
      }
      case 0x3f: { // CALL abs
        const dst = this.fetch16();
        this.push8(this.pc >> 8);
        this.push8(this.pc & 0xff);
        this.pc = dst;
        return 8;
      }
      case 0x4f: { // PCALL upage
        const u = this.fetch8();
        this.push8(this.pc >> 8);
        this.push8(this.pc & 0xff);
        this.pc = 0xff00 | u;
        return 6;
      }
      case 0x01: case 0x11: case 0x21: case 0x31: case 0x41: case 0x51: case 0x61: case 0x71:
      case 0x81: case 0x91: case 0xa1: case 0xb1: case 0xc1: case 0xd1: case 0xe1: case 0xf1: {
        const vec = 0xffde - ((op >> 4) << 1);
        this.push8(this.pc >> 8);
        this.push8(this.pc & 0xff);
        this.pc = this.read16(vec);
        return 8;
      }
      case 0x0f: { // BRK
        this.push8(this.pc >> 8);
        this.push8(this.pc & 0xff);
        this.push8(this.psw);
        this.setFlag(0x10, true);
        this.setFlag(0x04, false);
        this.pc = this.read16(0xffde);
        return 8;
      }
      case 0x6f: { // RET
        const lo = this.pull8();
        const hi = this.pull8();
        this.pc = lo | (hi << 8);
        return 5;
      }
      case 0x7f: { // RETI
        this.psw = this.pull8();
        const lo = this.pull8();
        const hi = this.pull8();
        this.pc = lo | (hi << 8);
        return 6;
      }

      // Stack & Transfers
      case 0x2d: this.push8(this.a); return 4;
      case 0x4d: this.push8(this.x); return 4;
      case 0x6d: this.push8(this.y); return 4;
      case 0x0d: this.push8(this.psw); return 4;
      case 0xae: this.a = this.pull8(); return 4;
      case 0xce: this.x = this.pull8(); return 4;
      case 0xee: this.y = this.pull8(); return 4;
      case 0x8e: this.psw = this.pull8(); return 4;

      case 0x5d: this.x = this.setNZ8(this.a); return 2; // MOV X, A
      case 0x7d: this.a = this.setNZ8(this.x); return 2; // MOV A, X
      case 0xfd: this.y = this.setNZ8(this.a); return 2; // MOV Y, A
      case 0xdd: this.a = this.setNZ8(this.y); return 2; // MOV A, Y
      case 0x9d: this.x = this.setNZ8(this.sp); return 2; // MOV X, SP
      case 0xbd: this.sp = this.x; return 2; // MOV SP, X (no flags!)

      // MOV A, ...
      case 0xe8: this.a = this.setNZ8(this.fetch8()); return 2;
      case 0xe6: this.a = this.setNZ8(this.readDP(this.x)); return 3;
      case 0xbf: this.a = this.setNZ8(this.readDP(this.x)); this.x = (this.x + 1) & 0xff; return 4;
      case 0xe4: this.a = this.setNZ8(this.readDP(this.fetch8())); return 3;
      case 0xf4: this.a = this.setNZ8(this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0xe5: this.a = this.setNZ8(this.read8(this.fetch16())); return 4;
      case 0xf5: this.a = this.setNZ8(this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0xf6: this.a = this.setNZ8(this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0xe7: {
        const ptr = this.readDP16((this.fetch8() + this.x) & 0xff);
        this.a = this.setNZ8(this.read8(ptr));
        return 6;
      }
      case 0xf7: {
        const ptr = (this.readDP16(this.fetch8()) + this.y) & 0xffff;
        this.a = this.setNZ8(this.read8(ptr));
        return 6;
      }

      // MOV X / Y loads
      case 0xcd: this.x = this.setNZ8(this.fetch8()); return 2;
      case 0xf8: this.x = this.setNZ8(this.readDP(this.fetch8())); return 3;
      case 0xf9: this.x = this.setNZ8(this.readDP((this.fetch8() + this.y) & 0xff)); return 4;
      case 0xe9: this.x = this.setNZ8(this.read8(this.fetch16())); return 4;
      case 0x8d: this.y = this.setNZ8(this.fetch8()); return 2;
      case 0xeb: this.y = this.setNZ8(this.readDP(this.fetch8())); return 3;
      case 0xfb: this.y = this.setNZ8(this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0xec: this.y = this.setNZ8(this.read8(this.fetch16())); return 4;

      // MOV stores
      case 0xc6: this.writeDP(this.x, this.a); return 4;
      case 0xaf: this.writeDP(this.x, this.a); this.x = (this.x + 1) & 0xff; return 4;
      case 0xc4: this.writeDP(this.fetch8(), this.a); return 4;
      case 0xd4: this.writeDP((this.fetch8() + this.x) & 0xff, this.a); return 5;
      case 0xc5: this.write8(this.fetch16(), this.a); return 5;
      case 0xd5: this.write8((this.fetch16() + this.x) & 0xffff, this.a); return 6;
      case 0xd6: this.write8((this.fetch16() + this.y) & 0xffff, this.a); return 6;
      case 0xc7: {
        const ptr = this.readDP16((this.fetch8() + this.x) & 0xff);
        this.write8(ptr, this.a);
        return 7;
      }
      case 0xd7: {
        const ptr = (this.readDP16(this.fetch8()) + this.y) & 0xffff;
        this.write8(ptr, this.a);
        return 7;
      }
      case 0xd8: this.writeDP(this.fetch8(), this.x); return 4;
      case 0xd9: this.writeDP((this.fetch8() + this.y) & 0xff, this.x); return 5;
      case 0xc9: this.write8(this.fetch16(), this.x); return 5;
      case 0xcb: this.writeDP(this.fetch8(), this.y); return 4;
      case 0xdb: this.writeDP((this.fetch8() + this.x) & 0xff, this.y); return 5;
      case 0xcc: this.write8(this.fetch16(), this.y); return 5;
      case 0x8f: {
        const imm = this.fetch8();
        const dp = this.fetch8();
        this.writeDP(dp, imm);
        return 5;
      }
      case 0xfa: {
        const src = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.readDP(src));
        return 5;
      }

      // 8-bit ALU (OR, AND, EOR, CMP, ADC, SBC)
      // OR
      case 0x08: this.a = this.setNZ8(this.a | this.fetch8()); return 2;
      case 0x06: this.a = this.setNZ8(this.a | this.readDP(this.x)); return 3;
      case 0x04: this.a = this.setNZ8(this.a | this.readDP(this.fetch8())); return 3;
      case 0x14: this.a = this.setNZ8(this.a | this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0x05: this.a = this.setNZ8(this.a | this.read8(this.fetch16())); return 4;
      case 0x15: this.a = this.setNZ8(this.a | this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0x16: this.a = this.setNZ8(this.a | this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0x07: this.a = this.setNZ8(this.a | this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0x17: this.a = this.setNZ8(this.a | this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0x19: {
        const res = this.setNZ8(this.readDP(this.x) | this.readDP(this.y));
        this.writeDP(this.x, res);
        return 5;
      }
      case 0x09: {
        const src = this.readDP(this.fetch8());
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) | src));
        return 6;
      }
      case 0x18: {
        const imm = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) | imm));
        return 5;
      }

      // AND
      case 0x28: this.a = this.setNZ8(this.a & this.fetch8()); return 2;
      case 0x26: this.a = this.setNZ8(this.a & this.readDP(this.x)); return 3;
      case 0x24: this.a = this.setNZ8(this.a & this.readDP(this.fetch8())); return 3;
      case 0x34: this.a = this.setNZ8(this.a & this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0x25: this.a = this.setNZ8(this.a & this.read8(this.fetch16())); return 4;
      case 0x35: this.a = this.setNZ8(this.a & this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0x36: this.a = this.setNZ8(this.a & this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0x27: this.a = this.setNZ8(this.a & this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0x37: this.a = this.setNZ8(this.a & this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0x39: {
        const res = this.setNZ8(this.readDP(this.x) & this.readDP(this.y));
        this.writeDP(this.x, res);
        return 5;
      }
      case 0x29: {
        const src = this.readDP(this.fetch8());
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) & src));
        return 6;
      }
      case 0x38: {
        const imm = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) & imm));
        return 5;
      }

      // EOR
      case 0x48: this.a = this.setNZ8(this.a ^ this.fetch8()); return 2;
      case 0x46: this.a = this.setNZ8(this.a ^ this.readDP(this.x)); return 3;
      case 0x44: this.a = this.setNZ8(this.a ^ this.readDP(this.fetch8())); return 3;
      case 0x54: this.a = this.setNZ8(this.a ^ this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0x45: this.a = this.setNZ8(this.a ^ this.read8(this.fetch16())); return 4;
      case 0x55: this.a = this.setNZ8(this.a ^ this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0x56: this.a = this.setNZ8(this.a ^ this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0x47: this.a = this.setNZ8(this.a ^ this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0x57: this.a = this.setNZ8(this.a ^ this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0x59: {
        const res = this.setNZ8(this.readDP(this.x) ^ this.readDP(this.y));
        this.writeDP(this.x, res);
        return 5;
      }
      case 0x49: {
        const src = this.readDP(this.fetch8());
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) ^ src));
        return 6;
      }
      case 0x58: {
        const imm = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.setNZ8(this.readDP(dst) ^ imm));
        return 5;
      }

      // CMP
      case 0x68: this.cmp8(this.a, this.fetch8()); return 2;
      case 0x66: this.cmp8(this.a, this.readDP(this.x)); return 3;
      case 0x64: this.cmp8(this.a, this.readDP(this.fetch8())); return 3;
      case 0x74: this.cmp8(this.a, this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0x65: this.cmp8(this.a, this.read8(this.fetch16())); return 4;
      case 0x75: this.cmp8(this.a, this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0x76: this.cmp8(this.a, this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0x67: this.cmp8(this.a, this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0x77: this.cmp8(this.a, this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0x79: this.cmp8(this.readDP(this.x), this.readDP(this.y)); return 5;
      case 0x69: {
        const src = this.readDP(this.fetch8());
        const dst = this.readDP(this.fetch8());
        this.cmp8(dst, src);
        return 6;
      }
      case 0x78: {
        const imm = this.fetch8();
        const dst = this.readDP(this.fetch8());
        this.cmp8(dst, imm);
        return 5;
      }
      case 0xc8: this.cmp8(this.x, this.fetch8()); return 2;
      case 0x3e: this.cmp8(this.x, this.readDP(this.fetch8())); return 3;
      case 0x1e: this.cmp8(this.x, this.read8(this.fetch16())); return 4;
      case 0xad: this.cmp8(this.y, this.fetch8()); return 2;
      case 0x7e: this.cmp8(this.y, this.readDP(this.fetch8())); return 3;
      case 0x5e: this.cmp8(this.y, this.read8(this.fetch16())); return 4;

      // ADC
      case 0x88: this.a = this.add8(this.a, this.fetch8()); return 2;
      case 0x86: this.a = this.add8(this.a, this.readDP(this.x)); return 3;
      case 0x84: this.a = this.add8(this.a, this.readDP(this.fetch8())); return 3;
      case 0x94: this.a = this.add8(this.a, this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0x85: this.a = this.add8(this.a, this.read8(this.fetch16())); return 4;
      case 0x95: this.a = this.add8(this.a, this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0x96: this.a = this.add8(this.a, this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0x87: this.a = this.add8(this.a, this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0x97: this.a = this.add8(this.a, this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0x99: this.writeDP(this.x, this.add8(this.readDP(this.x), this.readDP(this.y))); return 5;
      case 0x89: {
        const src = this.readDP(this.fetch8());
        const dst = this.fetch8();
        this.writeDP(dst, this.add8(this.readDP(dst), src));
        return 6;
      }
      case 0x98: {
        const imm = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.add8(this.readDP(dst), imm));
        return 5;
      }

      // SBC
      case 0xa8: this.a = this.sub8(this.a, this.fetch8()); return 2;
      case 0xa6: this.a = this.sub8(this.a, this.readDP(this.x)); return 3;
      case 0xa4: this.a = this.sub8(this.a, this.readDP(this.fetch8())); return 3;
      case 0xb4: this.a = this.sub8(this.a, this.readDP((this.fetch8() + this.x) & 0xff)); return 4;
      case 0xa5: this.a = this.sub8(this.a, this.read8(this.fetch16())); return 4;
      case 0xb5: this.a = this.sub8(this.a, this.read8((this.fetch16() + this.x) & 0xffff)); return 5;
      case 0xb6: this.a = this.sub8(this.a, this.read8((this.fetch16() + this.y) & 0xffff)); return 5;
      case 0xa7: this.a = this.sub8(this.a, this.read8(this.readDP16((this.fetch8() + this.x) & 0xff))); return 6;
      case 0xb7: this.a = this.sub8(this.a, this.read8((this.readDP16(this.fetch8()) + this.y) & 0xffff)); return 6;
      case 0xb9: this.writeDP(this.x, this.sub8(this.readDP(this.x), this.readDP(this.y))); return 5;
      case 0xa9: {
        const src = this.readDP(this.fetch8());
        const dst = this.fetch8();
        this.writeDP(dst, this.sub8(this.readDP(dst), src));
        return 6;
      }
      case 0xb8: {
        const imm = this.fetch8();
        const dst = this.fetch8();
        this.writeDP(dst, this.sub8(this.readDP(dst), imm));
        return 5;
      }

      // INC / DEC
      case 0xbc: this.a = this.setNZ8(this.a + 1); return 2;
      case 0x3d: this.x = this.setNZ8(this.x + 1); return 2;
      case 0xfc: this.y = this.setNZ8(this.y + 1); return 2;
      case 0xab: {
        const dp = this.fetch8();
        this.writeDP(dp, this.setNZ8(this.readDP(dp) + 1));
        return 4;
      }
      case 0xbb: {
        const dp = (this.fetch8() + this.x) & 0xff;
        this.writeDP(dp, this.setNZ8(this.readDP(dp) + 1));
        return 5;
      }
      case 0xac: {
        const abs = this.fetch16();
        this.write8(abs, this.setNZ8(this.read8(abs) + 1));
        return 5;
      }
      case 0x9c: this.a = this.setNZ8(this.a - 1); return 2;
      case 0x1d: this.x = this.setNZ8(this.x - 1); return 2;
      case 0xdc: this.y = this.setNZ8(this.y - 1); return 2;
      case 0x8b: {
        const dp = this.fetch8();
        this.writeDP(dp, this.setNZ8(this.readDP(dp) - 1));
        return 4;
      }
      case 0x9b: {
        const dp = (this.fetch8() + this.x) & 0xff;
        this.writeDP(dp, this.setNZ8(this.readDP(dp) - 1));
        return 5;
      }
      case 0x8c: {
        const abs = this.fetch16();
        this.write8(abs, this.setNZ8(this.read8(abs) - 1));
        return 5;
      }

      // Shifts & Rotates
      case 0x1c: { // ASL A
        this.setFlag(0x01, (this.a & 0x80) !== 0);
        this.a = this.setNZ8(this.a << 1);
        return 2;
      }
      case 0x0b: case 0x1b: case 0x0c: {
        const addr = op === 0x0c ? this.fetch16() : this.dpBase() | ((this.fetch8() + (op === 0x1b ? this.x : 0)) & 0xff);
        const v = this.read8(addr);
        this.setFlag(0x01, (v & 0x80) !== 0);
        this.write8(addr, this.setNZ8(v << 1));
        return op === 0x0b ? 4 : 5;
      }
      case 0x5c: { // LSR A
        this.setFlag(0x01, (this.a & 0x01) !== 0);
        this.a = this.setNZ8(this.a >> 1);
        return 2;
      }
      case 0x4b: case 0x5b: case 0x4c: {
        const addr = op === 0x4c ? this.fetch16() : this.dpBase() | ((this.fetch8() + (op === 0x5b ? this.x : 0)) & 0xff);
        const v = this.read8(addr);
        this.setFlag(0x01, (v & 0x01) !== 0);
        this.write8(addr, this.setNZ8(v >> 1));
        return op === 0x4b ? 4 : 5;
      }
      case 0x3c: { // ROL A
        const c = this.psw & 0x01;
        this.setFlag(0x01, (this.a & 0x80) !== 0);
        this.a = this.setNZ8((this.a << 1) | c);
        return 2;
      }
      case 0x2b: case 0x3b: case 0x2c: {
        const addr = op === 0x2c ? this.fetch16() : this.dpBase() | ((this.fetch8() + (op === 0x3b ? this.x : 0)) & 0xff);
        const v = this.read8(addr);
        const c = this.psw & 0x01;
        this.setFlag(0x01, (v & 0x80) !== 0);
        this.write8(addr, this.setNZ8((v << 1) | c));
        return op === 0x2b ? 4 : 5;
      }
      case 0x7c: { // ROR A
        const c = (this.psw & 0x01) << 7;
        this.setFlag(0x01, (this.a & 0x01) !== 0);
        this.a = this.setNZ8((this.a >> 1) | c);
        return 2;
      }
      case 0x6b: case 0x7b: case 0x6c: {
        const addr = op === 0x6c ? this.fetch16() : this.dpBase() | ((this.fetch8() + (op === 0x7b ? this.x : 0)) & 0xff);
        const v = this.read8(addr);
        const c = (this.psw & 0x01) << 7;
        this.setFlag(0x01, (v & 0x01) !== 0);
        this.write8(addr, this.setNZ8((v >> 1) | c));
        return op === 0x6b ? 4 : 5;
      }

      // Bit test/set/clear with abs
      case 0x0e: { // TSET1 abs
        const abs = this.fetch16();
        const v = this.read8(abs);
        this.setNZ8((this.a - v) & 0xff);
        this.write8(abs, v | this.a);
        return 6;
      }
      case 0x4e: { // TCLR1 abs
        const abs = this.fetch16();
        const v = this.read8(abs);
        this.setNZ8((this.a - v) & 0xff);
        this.write8(abs, v & ~this.a);
        return 6;
      }

      // 13-bit mem.bit operations
      case 0x0a: case 0x2a: case 0x4a: case 0x6a: case 0x8a: case 0xaa: case 0xca: case 0xea: {
        const w = this.fetch16();
        const addr = w & 0x1fff;
        const mask = 1 << ((w >> 13) & 7);
        const cur = this.read8(addr);
        const bit = (cur & mask) !== 0;
        const c = (this.psw & 0x01) !== 0;
        if (op === 0x0a) { this.setFlag(0x01, c || bit); return 5; }
        if (op === 0x2a) { this.setFlag(0x01, c || !bit); return 5; }
        if (op === 0x4a) { this.setFlag(0x01, c && bit); return 4; }
        if (op === 0x6a) { this.setFlag(0x01, c && !bit); return 4; }
        if (op === 0x8a) { this.setFlag(0x01, c !== bit); return 5; }
        if (op === 0xaa) { this.setFlag(0x01, bit); return 4; }
        if (op === 0xca) { this.write8(addr, c ? (cur | mask) : (cur & ~mask)); return 6; }
        this.write8(addr, cur ^ mask);
        return 5;
      }

      // 16-bit YA Word Operations
      case 0xba: { // MOVW YA, dp
        const v = this.readDP16(this.fetch8());
        this.a = v & 0xff;
        this.y = (v >> 8) & 0xff;
        this.setNZ16(v);
        return 5;
      }
      case 0xda: { // MOVW dp, YA
        this.writeDP16(this.fetch8(), this.a | (this.y << 8));
        return 5;
      }
      case 0x3a: { // INCW dp
        const dp = this.fetch8();
        const v = this.setNZ16((this.readDP16(dp) + 1) & 0xffff);
        this.writeDP16(dp, v);
        return 6;
      }
      case 0x1a: { // DECW dp
        const dp = this.fetch8();
        const v = this.setNZ16((this.readDP16(dp) - 1) & 0xffff);
        this.writeDP16(dp, v);
        return 6;
      }
      case 0x7a: { // ADDW YA, dp
        const ya = this.a | (this.y << 8);
        const m = this.readDP16(this.fetch8());
        const sum = ya + m;
        const res = sum & 0xffff;
        this.setFlag(0x01, sum > 0xffff);
        this.setFlag(0x08, (ya & 0x0fff) + (m & 0x0fff) > 0x0fff);
        this.setFlag(0x40, (~(ya ^ m) & (ya ^ res) & 0x8000) !== 0);
        this.a = res & 0xff;
        this.y = (res >> 8) & 0xff;
        this.setNZ16(res);
        return 5;
      }
      case 0x9a: { // SUBW YA, dp
        const ya = this.a | (this.y << 8);
        const m = this.readDP16(this.fetch8());
        const diff = ya - m;
        const res = diff & 0xffff;
        this.setFlag(0x01, diff >= 0);
        this.setFlag(0x08, (ya & 0x0fff) - (m & 0x0fff) >= 0);
        this.setFlag(0x40, ((ya ^ m) & (ya ^ res) & 0x8000) !== 0);
        this.a = res & 0xff;
        this.y = (res >> 8) & 0xff;
        this.setNZ16(res);
        return 5;
      }
      case 0x5a: { // CMPW YA, dp
        const ya = this.a | (this.y << 8);
        const m = this.readDP16(this.fetch8());
        const diff = ya - m;
        this.setFlag(0x01, diff >= 0);
        this.setNZ16(diff & 0xffff);
        return 4;
      }

      // Misc: MUL, DIV, XCN, DAA, DAS
      case 0xcf: { // MUL YA
        const prod = this.y * this.a;
        this.a = prod & 0xff;
        this.y = (prod >> 8) & 0xff;
        this.setNZ8(this.y);
        return 9;
      }
      case 0x9e: { // DIV YA, X
        const ya = this.a | (this.y << 8);
        this.setFlag(0x08, (this.y & 0x0f) >= (this.x & 0x0f));
        this.setFlag(0x40, this.y >= this.x);
        if (this.x === 0) {
          this.a = 0xff;
          this.y = this.y;
        } else if (this.y < (this.x << 1)) {
          this.a = Math.floor(ya / this.x) & 0xff;
          this.y = (ya % this.x) & 0xff;
        } else {
          this.a = (255 - Math.floor((ya - (this.x << 9)) / (256 - this.x))) & 0xff;
          this.y = (this.x + ((ya - (this.x << 9)) % (256 - this.x))) & 0xff;
        }
        this.setNZ8(this.a);
        return 12;
      }
      case 0x9f: { // XCN A
        this.a = ((this.a & 0x0f) << 4) | (this.a >> 4);
        this.setNZ8(this.a);
        return 5;
      }
      case 0xdf: { // DAA
        if ((this.psw & 0x01) !== 0 || this.a > 0x99) {
          this.a = (this.a + 0x60) & 0xff;
          this.setFlag(0x01, true);
        }
        if ((this.psw & 0x08) !== 0 || (this.a & 0x0f) > 0x09) {
          this.a = (this.a + 0x06) & 0xff;
        }
        this.setNZ8(this.a);
        return 3;
      }
      case 0xbe: { // DAS
        if ((this.psw & 0x01) === 0 || this.a > 0x99) {
          this.a = (this.a - 0x60) & 0xff;
          this.setFlag(0x01, false);
        }
        if ((this.psw & 0x08) === 0 || (this.a & 0x0f) > 0x09) {
          this.a = (this.a - 0x06) & 0xff;
        }
        this.setNZ8(this.a);
        return 3;
      }

      default:
        throw new Error(`Unimplemented SPC700 opcode 0x${op.toString(16).padStart(2, '0')} at $${((this.pc - 1) & 0xffff).toString(16)}`);
    }
  }
}

export class SnesApuSystem {
  public readonly rom: Uint8Array;
  public readonly wram = new Uint8Array(0x20000); // 128 KB ($7E..$7F, low 8 KB mirrored to banks $00..$3F/$80..$BF)
  public readonly spc = new Spc700();

  // 65C816 Registers (native mode)
  public a = 0;
  public x = 0;
  public y = 0;
  public d = 0;
  public sp = 0x01ff;
  public dbr = 0x80;
  public pbr = 0x80;
  public pc = 0x8000;
  public p = 0x30; // M=1 (8-bit A), X=1 (8-bit X/Y)

  // SNES Hardware $4202..$4217 Mul/Div registers
  private multA = 0xff;
  private multB = 0xff;
  private divA = 0xffff;
  private divB = 0xff;
  private divQuot = 0;
  private divRem = 0;

  constructor(rom: Uint8Array) {
    this.rom = rom;
  }

  public readByte(bank: number, addr: number): number {
    const b = bank & 0xff;
    const a = addr & 0xffff;
    if (b === 0x7e || b === 0x7f) {
      return this.wram[((b - 0x7e) << 16) | a];
    }
    if ((b <= 0x3f || (b >= 0x80 && b <= 0xbf)) && a < 0x8000) {
      if (a < 0x2000) {
        return this.wram[a];
      }
      if (a >= 0x2140 && a <= 0x2143) {
        // Real SNES timing ratio (~0.38 SPC cycles per 65816 clock): small tick keeps ports locked in sync
        this.spc.stepCycles(2);
        return this.spc.apuToCpu[a - 0x2140];
      }
      if (a === 0x4214) return this.divQuot & 0xff;
      if (a === 0x4215) return (this.divQuot >> 8) & 0xff;
      if (a === 0x4216) return this.divRem & 0xff;
      if (a === 0x4217) return (this.divRem >> 8) & 0xff;
      return 0;
    }
    if (a >= 0x8000 || (b >= 0x40 && b <= 0x7d) || b >= 0xc0) {
      const romOff = (((b & 0x3f) * 0x8000) + (a - 0x8000)) % this.rom.length;
      return this.rom[romOff >= 0 ? romOff : romOff + this.rom.length];
    }
    return 0;
  }

  public writeByte(bank: number, addr: number, val: number): void {
    const b = bank & 0xff;
    const a = addr & 0xffff;
    const v = val & 0xff;
    if (b === 0x7e || b === 0x7f) {
      this.wram[((b - 0x7e) << 16) | a] = v;
      return;
    }
    if ((b <= 0x3f || (b >= 0x80 && b <= 0xbf)) && a < 0x8000) {
      if (a < 0x2000) {
        this.wram[a] = v;
      } else if (a >= 0x2140 && a <= 0x2143) {
        this.spc.cpuToApu[a - 0x2140] = v;
      } else if (a === 0x4202) {
        this.multA = v;
      } else if (a === 0x4203) {
        this.multB = v;
        this.divRem = (this.multA * this.multB) & 0xffff;
      } else if (a === 0x4204) {
        this.divA = (this.divA & 0xff00) | v;
      } else if (a === 0x4205) {
        this.divA = (this.divA & 0x00ff) | (v << 8);
      } else if (a === 0x4206) {
        this.divB = v;
        if (v === 0) {
          this.divQuot = 0xffff;
          this.divRem = this.divA;
        } else {
          this.divQuot = Math.floor(this.divA / v) & 0xffff;
          this.divRem = (this.divA % v) & 0xffff;
        }
      }
    }
  }

  private read16(bank: number, addr: number): number {
    return this.readByte(bank, addr) | (this.readByte(bank, (addr + 1) & 0xffff) << 8);
  }

  private read24(bank: number, addr: number): { bank: number; addr: number } {
    const lo = this.readByte(bank, addr);
    const hi = this.readByte(bank, (addr + 1) & 0xffff);
    const bk = this.readByte(bank, (addr + 2) & 0xffff);
    return { bank: bk, addr: lo | (hi << 8) };
  }

  private readDP8(off: number): number {
    return this.readByte(0, (this.d + off) & 0xffff);
  }

  private writeDP8(off: number, val: number): void {
    this.writeByte(0, (this.d + off) & 0xffff, val);
  }

  private readDP16(off: number): number {
    const addr = (this.d + off) & 0xffff;
    return this.readByte(0, addr) | (this.readByte(0, (addr + 1) & 0xffff) << 8);
  }

  private push8(val: number): void {
    this.writeByte(0, this.sp, val & 0xff);
    this.sp = (this.sp - 1) & 0xffff;
  }

  private push16(val: number): void {
    this.push8((val >> 8) & 0xff);
    this.push8(val & 0xff);
  }

  private pull8(): number {
    this.sp = (this.sp + 1) & 0xffff;
    return this.readByte(0, this.sp);
  }

  private pull16(): number {
    const lo = this.pull8();
    const hi = this.pull8();
    return lo | (hi << 8);
  }

  private fetch8(): number {
    const v = this.readByte(this.pbr, this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  private isM8(): boolean {
    return (this.p & 0x20) !== 0;
  }

  private isX8(): boolean {
    return (this.p & 0x10) !== 0;
  }

  private setPFlag(mask: number, on: boolean): void {
    if (on) this.p |= mask;
    else this.p &= ~mask;
  }

  private setNZ(val: number, is8: boolean): void {
    if (is8) {
      const v = val & 0xff;
      this.setPFlag(0x80, (v & 0x80) !== 0);
      this.setPFlag(0x02, v === 0);
    } else {
      const v = val & 0xffff;
      this.setPFlag(0x80, (v & 0x8000) !== 0);
      this.setPFlag(0x02, v === 0);
    }
  }

  private readVal(bank: number, addr: number, is8: boolean): number {
    return is8 ? this.readByte(bank, addr) : this.read16(bank, addr);
  }

  private writeVal(bank: number, addr: number, val: number, is8: boolean): void {
    this.writeByte(bank, addr, val & 0xff);
    if (!is8) {
      this.writeByte(bank, (addr + 1) & 0xffff, (val >> 8) & 0xff);
    }
  }

  private addrDP(): { bank: number; addr: number } {
    return { bank: 0, addr: (this.d + this.fetch8()) & 0xffff };
  }
  private addrDPX(): { bank: number; addr: number } {
    return { bank: 0, addr: (this.d + this.fetch8() + this.x) & 0xffff };
  }
  private addrDPY(): { bank: number; addr: number } {
    return { bank: 0, addr: (this.d + this.fetch8() + this.y) & 0xffff };
  }
  private addrAbs(): { bank: number; addr: number } {
    return { bank: this.dbr, addr: this.fetch16() };
  }
  private addrAbsX(): { bank: number; addr: number } {
    return { bank: this.dbr, addr: (this.fetch16() + this.x) & 0xffff };
  }
  private addrAbsY(): { bank: number; addr: number } {
    return { bank: this.dbr, addr: (this.fetch16() + this.y) & 0xffff };
  }
  private addrLong(): { bank: number; addr: number } {
    const addr = this.fetch16();
    const bank = this.fetch8();
    return { bank, addr };
  }
  private addrLongX(): { bank: number; addr: number } {
    const addr = this.fetch16();
    const bank = this.fetch8();
    const lin = ((bank << 16) + addr + this.x) & 0xffffff;
    return { bank: (lin >> 16) & 0xff, addr: lin & 0xffff };
  }
  private addrIndDP(): { bank: number; addr: number } {
    return { bank: this.dbr, addr: this.readDP16(this.fetch8()) };
  }
  private addrIndDPX(): { bank: number; addr: number } {
    return { bank: this.dbr, addr: this.readDP16((this.fetch8() + this.x) & 0xffff) };
  }
  private addrIndDPY(): { bank: number; addr: number } {
    const base = (this.dbr << 16) + this.readDP16(this.fetch8()) + this.y;
    return { bank: (base >> 16) & 0xff, addr: base & 0xffff };
  }
  private addrIndDPLong(): { bank: number; addr: number } {
    const dpAddr = (this.d + this.fetch8()) & 0xffff;
    return this.read24(0, dpAddr);
  }
  private addrIndDPLongY(): { bank: number; addr: number } {
    const dpAddr = (this.d + this.fetch8()) & 0xffff;
    const p = this.read24(0, dpAddr);
    const lin = ((p.bank << 16) + p.addr + this.y) & 0xffffff;
    return { bank: (lin >> 16) & 0xff, addr: lin & 0xffff };
  }
  private addrSR(): { bank: number; addr: number } {
    return { bank: 0, addr: (this.sp + this.fetch8()) & 0xffff };
  }
  private addrSRIndY(): { bank: number; addr: number } {
    const ptr = this.read16(0, (this.sp + this.fetch8()) & 0xffff);
    const lin = ((this.dbr << 16) + ptr + this.y) & 0xffffff;
    return { bank: (lin >> 16) & 0xff, addr: lin & 0xffff };
  }

  private aluAdc(val: number): void {
    const m8 = this.isM8();
    const c = this.p & 1;
    if (m8) {
      const a8 = this.a & 0xff;
      const sum = a8 + val + c;
      const res = sum & 0xff;
      this.setPFlag(0x01, sum > 0xff);
      this.setPFlag(0x40, (~(a8 ^ val) & (a8 ^ res) & 0x80) !== 0);
      this.a = (this.a & 0xff00) | res;
      this.setNZ(res, true);
    } else {
      const sum = this.a + val + c;
      const res = sum & 0xffff;
      this.setPFlag(0x01, sum > 0xffff);
      this.setPFlag(0x40, (~(this.a ^ val) & (this.a ^ res) & 0x8000) !== 0);
      this.a = res;
      this.setNZ(res, false);
    }
  }

  private aluSbc(val: number): void {
    this.aluAdc(this.isM8() ? val ^ 0xff : val ^ 0xffff);
  }

  private aluCmp(regVal: number, val: number, is8: boolean): void {
    const r = is8 ? regVal & 0xff : regVal & 0xffff;
    const v = is8 ? val & 0xff : val & 0xffff;
    const diff = r - v;
    this.setPFlag(0x01, diff >= 0);
    this.setNZ(diff, is8);
  }

  private branch8(cond: boolean): void {
    const rel = s8(this.fetch8());
    if (cond) this.pc = (this.pc + rel) & 0xffff;
  }

  public callJSL(bank: number, addr: number, maxOps = 10_000_000): void {
    this.push8(0x00);
    this.push16(0xffef); // RTL returns to $00:FFF0
    this.pbr = bank & 0xff;
    this.pc = addr & 0xffff;

    for (let i = 0; i < maxOps; i++) {
      if (this.pbr === 0x00 && this.pc === 0xfff0) {
        return;
      }
      this.stepCpu();
      this.spc.stepCycles(4);
    }
    throw new Error(`65C816 callJSL($${bank.toString(16)}:${addr.toString(16)}) exceeded ${maxOps} ops at $${this.pbr.toString(16)}:${this.pc.toString(16)}`);
  }

  public stepCpu(): void {
    const m8 = this.isM8();
    const x8 = this.isX8();
    const aMask = m8 ? 0xff : 0xffff;
    const getA = () => (m8 ? this.a & 0xff : this.a);
    const setA = (v: number) => {
      this.a = m8 ? (this.a & 0xff00) | (v & 0xff) : v & 0xffff;
      this.setNZ(v, m8);
    };
    const setX = (v: number) => {
      this.x = x8 ? v & 0xff : v & 0xffff;
      this.setNZ(this.x, x8);
    };
    const setY = (v: number) => {
      this.y = x8 ? v & 0xff : v & 0xffff;
      this.setNZ(this.y, x8);
    };

    const resolveOpAddr = (groupLow: number): { bank: number; addr: number } => {
      switch (groupLow) {
        case 0x01: return this.addrIndDPX();
        case 0x03: return this.addrSR();
        case 0x05: return this.addrDP();
        case 0x07: return this.addrIndDPLong();
        case 0x0d: return this.addrAbs();
        case 0x0f: return this.addrLong();
        case 0x11: return this.addrIndDPY();
        case 0x12: return this.addrIndDP();
        case 0x13: return this.addrSRIndY();
        case 0x15: return this.addrDPX();
        case 0x17: return this.addrIndDPLongY();
        case 0x19: return this.addrAbsY();
        case 0x1d: return this.addrAbsX();
        case 0x1f: return this.addrLongX();
        default: throw new Error(`Bad ALU mode 0x${groupLow.toString(16)}`);
      }
    };

    const op = this.fetch8();
    const lo = op & 0x1f;
    const hi = op >> 5;

    // Standard 8 ALU rows (ORA, AND, EOR, ADC, STA, LDA, CMP, SBC)
    if (
      lo === 0x01 || lo === 0x03 || lo === 0x05 || lo === 0x07 || lo === 0x09 || lo === 0x0d || lo === 0x0f ||
      lo === 0x11 || lo === 0x12 || lo === 0x13 || lo === 0x15 || lo === 0x17 || lo === 0x19 || lo === 0x1d || lo === 0x1f
    ) {
      // Handle BIT #imm special case for 0x89
      if (op === 0x89) {
        const imm = m8 ? this.fetch8() : this.fetch16();
        this.setPFlag(0x02, (getA() & imm) === 0);
        return;
      }
      if (op === 0x20 || op === 0x60 || op === 0x00 || op === 0x40 || op === 0x80) {
        // Not part of lo list above, falls through
      }
      if (hi === 4) {
        // STA
        const loc = resolveOpAddr(lo);
        this.writeVal(loc.bank, loc.addr, getA(), m8);
        return;
      }
      const val =
        lo === 0x09
          ? m8
            ? this.fetch8()
            : this.fetch16()
          : (() => {
              const loc = resolveOpAddr(lo);
              return this.readVal(loc.bank, loc.addr, m8);
            })();

      switch (hi) {
        case 0: setA(getA() | val); return; // ORA
        case 1: setA(getA() & val); return; // AND
        case 2: setA(getA() ^ val); return; // EOR
        case 3: this.aluAdc(val); return;   // ADC
        case 5: setA(val); return;          // LDA
        case 6: this.aluCmp(getA(), val, m8); return; // CMP
        case 7: this.aluSbc(val); return;   // SBC
      }
    }

    switch (op) {
      case 0xea: case 0x42: return; // NOP / WDM

      // Branches & Jumps
      case 0x80: this.branch8(true); return; // BRA
      case 0x82: { // BRL
        const rel = (this.fetch16() << 16) >> 16;
        this.pc = (this.pc + rel) & 0xffff;
        return;
      }
      case 0x10: this.branch8((this.p & 0x80) === 0); return;
      case 0x30: this.branch8((this.p & 0x80) !== 0); return;
      case 0x50: this.branch8((this.p & 0x40) === 0); return;
      case 0x70: this.branch8((this.p & 0x40) !== 0); return;
      case 0x90: this.branch8((this.p & 0x01) === 0); return;
      case 0xb0: this.branch8((this.p & 0x01) !== 0); return;
      case 0xd0: this.branch8((this.p & 0x02) === 0); return;
      case 0xf0: this.branch8((this.p & 0x02) !== 0); return;

      case 0x4c: this.pc = this.fetch16(); return; // JMP abs
      case 0x5c: { // JML long
        const addr = this.fetch16();
        this.pbr = this.fetch8();
        this.pc = addr;
        return;
      }
      case 0x6c: this.pc = this.read16(0, this.fetch16()); return; // JMP (abs)
      case 0x7c: this.pc = this.read16(this.pbr, (this.fetch16() + this.x) & 0xffff); return; // JMP (abs,X)
      case 0xdc: { // JML [abs]
        const p = this.read24(0, this.fetch16());
        this.pbr = p.bank;
        this.pc = p.addr;
        return;
      }
      case 0x20: { // JSR abs
        const dst = this.fetch16();
        this.push16((this.pc - 1) & 0xffff);
        this.pc = dst;
        return;
      }
      case 0xfc: { // JSR (abs,X)
        const tbl = (this.fetch16() + this.x) & 0xffff;
        this.push16((this.pc - 1) & 0xffff);
        this.pc = this.read16(this.pbr, tbl);
        return;
      }
      case 0x22: { // JSL long
        const dst = this.fetch16();
        const bk = this.fetch8();
        this.push8(this.pbr);
        this.push16((this.pc - 1) & 0xffff);
        this.pbr = bk;
        this.pc = dst;
        return;
      }
      case 0x60: this.pc = (this.pull16() + 1) & 0xffff; return; // RTS
      case 0x6b: { // RTL
        const addr = this.pull16();
        this.pbr = this.pull8();
        this.pc = (addr + 1) & 0xffff;
        return;
      }

      // Status Flags & REP/SEP
      case 0x18: this.setPFlag(0x01, false); return;
      case 0x38: this.setPFlag(0x01, true); return;
      case 0x58: this.setPFlag(0x04, false); return;
      case 0x78: this.setPFlag(0x04, true); return;
      case 0xb8: this.setPFlag(0x40, false); return;
      case 0xd8: this.setPFlag(0x08, false); return;
      case 0xf8: this.setPFlag(0x08, true); return;
      case 0xc2: { // REP #imm
        this.p &= ~this.fetch8();
        return;
      }
      case 0xe2: { // SEP #imm
        this.p |= this.fetch8();
        if (this.isX8()) {
          this.x &= 0xff;
          this.y &= 0xff;
        }
        return;
      }
      case 0xfb: { // XCE (keep native mode)
        this.setPFlag(0x01, false);
        return;
      }

      // Stack & Transfers
      case 0x48: m8 ? this.push8(this.a) : this.push16(this.a); return;
      case 0x68: setA(m8 ? this.pull8() : this.pull16()); return;
      case 0xda: x8 ? this.push8(this.x) : this.push16(this.x); return;
      case 0xfa: setX(x8 ? this.pull8() : this.pull16()); return;
      case 0x5a: x8 ? this.push8(this.y) : this.push16(this.y); return;
      case 0x7a: setY(x8 ? this.pull8() : this.pull16()); return;
      case 0x08: this.push8(this.p); return;
      case 0x28: {
        this.p = this.pull8();
        if (this.isX8()) {
          this.x &= 0xff;
          this.y &= 0xff;
        }
        return;
      }
      case 0x8b: this.push8(this.dbr); return;
      case 0xab: this.dbr = this.pull8(); this.setNZ(this.dbr, true); return;
      case 0x4b: this.push8(this.pbr); return;
      case 0x0b: this.push16(this.d); return;
      case 0x2b: this.d = this.pull16(); this.setNZ(this.d, false); return;
      case 0xf4: this.push16(this.fetch16()); return; // PEA
      case 0xd4: this.push16(this.readDP16(this.fetch8())); return; // PEI
      case 0x62: { // PER
        const rel = (this.fetch16() << 16) >> 16;
        this.push16((this.pc + rel) & 0xffff);
        return;
      }

      case 0xaa: setX(m8 && !x8 ? this.a : this.a & (x8 ? 0xff : 0xffff)); return; // TAX
      case 0x8a: setA(this.x); return; // TXA
      case 0xa8: setY(m8 && !x8 ? this.a : this.a & (x8 ? 0xff : 0xffff)); return; // TAY
      case 0x98: setA(this.y); return; // TYA
      case 0xba: setX(this.sp); return; // TSX
      case 0x9a: this.sp = x8 ? (this.sp & 0xff00) | (this.x & 0xff) : this.x; return; // TXS
      case 0x9b: setY(this.x); return; // TXY
      case 0xbb: setX(this.y); return; // TYX
      case 0x5b: this.d = this.a; this.setNZ(this.d, false); return; // TCD
      case 0x7b: this.a = this.d; this.setNZ(this.a, false); return; // TDC
      case 0x1b: this.sp = this.a; return; // TCS
      case 0x3b: this.a = this.sp; this.setNZ(this.a, false); return; // TSC
      case 0xeb: { // XBA
        const lo8 = this.a & 0xff;
        const hi8 = (this.a >> 8) & 0xff;
        this.a = (lo8 << 8) | hi8;
        this.setNZ(hi8, true);
        return;
      }

      // LDX / LDY / STX / STY / STZ / CPX / CPY
      case 0xa2: setX(x8 ? this.fetch8() : this.fetch16()); return;
      case 0xa6: setX(this.readVal(0, (this.d + this.fetch8()) & 0xffff, x8)); return;
      case 0xb6: setX(this.readVal(0, (this.d + this.fetch8() + this.y) & 0xffff, x8)); return;
      case 0xae: setX(this.readVal(this.dbr, this.fetch16(), x8)); return;
      case 0xbe: setX(this.readVal(this.dbr, (this.fetch16() + this.y) & 0xffff, x8)); return;

      case 0xa0: setY(x8 ? this.fetch8() : this.fetch16()); return;
      case 0xa4: setY(this.readVal(0, (this.d + this.fetch8()) & 0xffff, x8)); return;
      case 0xb4: setY(this.readVal(0, (this.d + this.fetch8() + this.x) & 0xffff, x8)); return;
      case 0xac: setY(this.readVal(this.dbr, this.fetch16(), x8)); return;
      case 0xbc: setY(this.readVal(this.dbr, (this.fetch16() + this.x) & 0xffff, x8)); return;

      case 0x86: this.writeVal(0, (this.d + this.fetch8()) & 0xffff, this.x, x8); return;
      case 0x96: this.writeVal(0, (this.d + this.fetch8() + this.y) & 0xffff, this.x, x8); return;
      case 0x8e: this.writeVal(this.dbr, this.fetch16(), this.x, x8); return;

      case 0x84: this.writeVal(0, (this.d + this.fetch8()) & 0xffff, this.y, x8); return;
      case 0x94: this.writeVal(0, (this.d + this.fetch8() + this.x) & 0xffff, this.y, x8); return;
      case 0x8c: this.writeVal(this.dbr, this.fetch16(), this.y, x8); return;

      case 0x64: this.writeVal(0, (this.d + this.fetch8()) & 0xffff, 0, m8); return;
      case 0x74: this.writeVal(0, (this.d + this.fetch8() + this.x) & 0xffff, 0, m8); return;
      case 0x9c: this.writeVal(this.dbr, this.fetch16(), 0, m8); return;
      case 0x9e: this.writeVal(this.dbr, (this.fetch16() + this.x) & 0xffff, 0, m8); return;

      case 0xe0: this.aluCmp(this.x, x8 ? this.fetch8() : this.fetch16(), x8); return;
      case 0xe4: this.aluCmp(this.x, this.readVal(0, (this.d + this.fetch8()) & 0xffff, x8), x8); return;
      case 0xec: this.aluCmp(this.x, this.readVal(this.dbr, this.fetch16(), x8), x8); return;

      case 0xc0: this.aluCmp(this.y, x8 ? this.fetch8() : this.fetch16(), x8); return;
      case 0xc4: this.aluCmp(this.y, this.readVal(0, (this.d + this.fetch8()) & 0xffff, x8), x8); return;
      case 0xcc: this.aluCmp(this.y, this.readVal(this.dbr, this.fetch16(), x8), x8); return;

      // INC / DEC Regs & Memory
      case 0x1a: setA((getA() + 1) & aMask); return;
      case 0x3a: setA((getA() - 1) & aMask); return;
      case 0xe8: setX((this.x + 1) & (x8 ? 0xff : 0xffff)); return;
      case 0xca: setX((this.x - 1) & (x8 ? 0xff : 0xffff)); return;
      case 0xc8: setY((this.y + 1) & (x8 ? 0xff : 0xffff)); return;
      case 0x88: setY((this.y - 1) & (x8 ? 0xff : 0xffff)); return;

      case 0xe6: case 0xf6: case 0xee: case 0xfe: {
        const loc = op === 0xe6 ? this.addrDP() : op === 0xf6 ? this.addrDPX() : op === 0xee ? this.addrAbs() : this.addrAbsX();
        const nv = (this.readVal(loc.bank, loc.addr, m8) + 1) & aMask;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }
      case 0xc6: case 0xd6: case 0xce: case 0xde: {
        const loc = op === 0xc6 ? this.addrDP() : op === 0xd6 ? this.addrDPX() : op === 0xce ? this.addrAbs() : this.addrAbsX();
        const nv = (this.readVal(loc.bank, loc.addr, m8) - 1) & aMask;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }

      // Shifts / Rotates (A & Memory)
      case 0x0a: {
        const v = getA();
        this.setPFlag(0x01, (v & (m8 ? 0x80 : 0x8000)) !== 0);
        setA((v << 1) & aMask);
        return;
      }
      case 0x4a: {
        const v = getA();
        this.setPFlag(0x01, (v & 1) !== 0);
        setA(v >> 1);
        return;
      }
      case 0x2a: {
        const v = getA();
        const c = this.p & 1;
        this.setPFlag(0x01, (v & (m8 ? 0x80 : 0x8000)) !== 0);
        setA(((v << 1) | c) & aMask);
        return;
      }
      case 0x6a: {
        const v = getA();
        const c = (this.p & 1) << (m8 ? 7 : 15);
        this.setPFlag(0x01, (v & 1) !== 0);
        setA((v >> 1) | c);
        return;
      }
      case 0x06: case 0x16: case 0x0e: case 0x1e: {
        const loc = op === 0x06 ? this.addrDP() : op === 0x16 ? this.addrDPX() : op === 0x0e ? this.addrAbs() : this.addrAbsX();
        const v = this.readVal(loc.bank, loc.addr, m8);
        this.setPFlag(0x01, (v & (m8 ? 0x80 : 0x8000)) !== 0);
        const nv = (v << 1) & aMask;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }
      case 0x46: case 0x56: case 0x4e: case 0x5e: {
        const loc = op === 0x46 ? this.addrDP() : op === 0x56 ? this.addrDPX() : op === 0x4e ? this.addrAbs() : this.addrAbsX();
        const v = this.readVal(loc.bank, loc.addr, m8);
        this.setPFlag(0x01, (v & 1) !== 0);
        const nv = v >> 1;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }
      case 0x26: case 0x36: case 0x2e: case 0x3e: {
        const loc = op === 0x26 ? this.addrDP() : op === 0x36 ? this.addrDPX() : op === 0x2e ? this.addrAbs() : this.addrAbsX();
        const v = this.readVal(loc.bank, loc.addr, m8);
        const c = this.p & 1;
        this.setPFlag(0x01, (v & (m8 ? 0x80 : 0x8000)) !== 0);
        const nv = ((v << 1) | c) & aMask;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }
      case 0x66: case 0x76: case 0x6e: case 0x7e: {
        const loc = op === 0x66 ? this.addrDP() : op === 0x76 ? this.addrDPX() : op === 0x6e ? this.addrAbs() : this.addrAbsX();
        const v = this.readVal(loc.bank, loc.addr, m8);
        const c = (this.p & 1) << (m8 ? 7 : 15);
        this.setPFlag(0x01, (v & 1) !== 0);
        const nv = (v >> 1) | c;
        this.writeVal(loc.bank, loc.addr, nv, m8);
        this.setNZ(nv, m8);
        return;
      }

      // BIT / TSB / TRB
      case 0x24: case 0x34: case 0x2c: case 0x3c: {
        const loc = op === 0x24 ? this.addrDP() : op === 0x34 ? this.addrDPX() : op === 0x2c ? this.addrAbs() : this.addrAbsX();
        const v = this.readVal(loc.bank, loc.addr, m8);
        this.setPFlag(0x02, (getA() & v) === 0);
        this.setPFlag(0x80, (v & (m8 ? 0x80 : 0x8000)) !== 0);
        this.setPFlag(0x40, (v & (m8 ? 0x40 : 0x4000)) !== 0);
        return;
      }
      case 0x04: case 0x0c: {
        const loc = op === 0x04 ? this.addrDP() : this.addrAbs();
        const v = this.readVal(loc.bank, loc.addr, m8);
        this.setPFlag(0x02, (getA() & v) === 0);
        this.writeVal(loc.bank, loc.addr, v | getA(), m8);
        return;
      }
      case 0x14: case 0x1c: {
        const loc = op === 0x14 ? this.addrDP() : this.addrAbs();
        const v = this.readVal(loc.bank, loc.addr, m8);
        this.setPFlag(0x02, (getA() & v) === 0);
        this.writeVal(loc.bank, loc.addr, v & ~getA(), m8);
        return;
      }

      // MVN / MVP block moves
      case 0x54: {
        const dstBank = this.fetch8();
        const srcBank = this.fetch8();
        this.dbr = dstBank;
        while (true) {
          this.writeByte(dstBank, this.y, this.readByte(srcBank, this.x));
          this.x = (this.x + 1) & (x8 ? 0xff : 0xffff);
          this.y = (this.y + 1) & (x8 ? 0xff : 0xffff);
          if (this.a === 0) {
            this.a = 0xffff;
            break;
          }
          this.a = (this.a - 1) & 0xffff;
        }
        return;
      }
      case 0x44: {
        const dstBank = this.fetch8();
        const srcBank = this.fetch8();
        this.dbr = dstBank;
        while (true) {
          this.writeByte(dstBank, this.y, this.readByte(srcBank, this.x));
          this.x = (this.x - 1) & (x8 ? 0xff : 0xffff);
          this.y = (this.y - 1) & (x8 ? 0xff : 0xffff);
          if (this.a === 0) {
            this.a = 0xffff;
            break;
          }
          this.a = (this.a - 1) & 0xffff;
        }
        return;
      }

      default:
        throw new Error(`Unimplemented 65C816 opcode 0x${op.toString(16).padStart(2, '0')} at $${this.pbr.toString(16)}:${((this.pc - 1) & 0xffff).toString(16)}`);
    }
  }

  public renderPcm(durationSec: number, opts?: { stopOnSilenceSec?: number; minSoundSec?: number }): {
    pcm: Int16Array;
    sampleCount: number;
    peak: number;
    rms: number;
    endedBySilence: boolean;
  } {
    const sampleRate = 32000;
    const maxSamples = Math.max(1, Math.floor(durationSec * sampleRate));
    const stopAfterSilenceSamples = opts?.stopOnSilenceSec ? Math.floor(opts.stopOnSilenceSec * sampleRate) : 0;
    const minSoundSamples = opts?.minSoundSec ? Math.floor(opts.minSoundSec * sampleRate) : 0;

    const pcm = new Int16Array(maxSamples * 2);
    let idx = 0;
    let peak = 0;
    let sumSq = 0;
    let heardSoundAt = -1;
    let silentRun = 0;
    let lastSoundSample = 0;
    let endedBySilence = false;

    this.spc.setSampleSink((l, r) => {
      if (idx < maxSamples) {
        pcm[idx * 2] = l;
        pcm[idx * 2 + 1] = r;
        const absL = l < 0 ? -l : l;
        const absR = r < 0 ? -r : r;
        const absMax = absL > absR ? absL : absR;
        if (absMax > peak) peak = absMax;
        sumSq += l * l + r * r;
        if (absMax >= 24) {
          if (heardSoundAt < 0) heardSoundAt = idx;
          lastSoundSample = idx;
          silentRun = 0;
        } else if (heardSoundAt >= 0) {
          silentRun++;
        }
        idx++;
      }
    });

    while (idx < maxSamples && !this.spc.stopped) {
      this.spc.stepCycles(4096);
      if (
        stopAfterSilenceSamples > 0 &&
        heardSoundAt >= 0 &&
        idx >= minSoundSamples &&
        silentRun >= stopAfterSilenceSamples
      ) {
        endedBySilence = true;
        break;
      }
    }
    this.spc.setSampleSink(null);

    const usedSamples = endedBySilence ? Math.min(idx, lastSoundSample + 8000) : idx;
    const trimmed = pcm.subarray(0, usedSamples * 2);
    const rms = usedSamples > 0 ? Math.sqrt(sumSq / (usedSamples * 2)) : 0;
    return { pcm: trimmed, sampleCount: usedSamples, peak, rms, endedBySilence };
  }

  public exportSpc(meta: SpcMetadata = {}): Uint8Array {
    const out = new Uint8Array(66048);
    // 0x00..0x20: "SNES-SPC700 Sound File Data v0.30"
    const magic = 'SNES-SPC700 Sound File Data v0.30';
    for (let i = 0; i < magic.length; i++) out[i] = magic.charCodeAt(i);
    out[0x21] = 26;
    out[0x22] = 26;
    out[0x23] = 26; // has ID666 tag
    out[0x24] = 30; // version minor

    // CPU registers
    out[0x25] = this.spc.pc & 0xff;
    out[0x26] = (this.spc.pc >> 8) & 0xff;
    out[0x27] = this.spc.a & 0xff;
    out[0x28] = this.spc.x & 0xff;
    out[0x29] = this.spc.y & 0xff;
    out[0x2a] = this.spc.psw & 0xff;
    out[0x2b] = this.spc.sp & 0xff;

    const writeAscii = (off: number, maxLen: number, text: string) => {
      for (let i = 0; i < maxLen && i < text.length; i++) {
        out[off + i] = text.charCodeAt(i) & 0x7f;
      }
    };
    writeAscii(0x2e, 32, meta.songTitle ?? 'SNES Track');
    writeAscii(0x4e, 32, meta.gameTitle ?? 'Super Famicom');
    writeAscii(0x6e, 16, meta.dumper ?? 'snes-apu.ts');
    writeAscii(0x7e, 32, meta.comments ?? 'Ripped directly via S-SMP/S-DSP');
    writeAscii(0xa9, 3, String(Math.min(999, Math.max(1, Math.round(meta.durationSec ?? 60)))));
    writeAscii(0xac, 5, String(Math.min(99999, Math.max(0, Math.round(meta.fadeMs ?? 2500)))));

    // 64 KB ARAM at 0x0100..0x100FF
    out.set(this.spc.aram, 0x0100);
    // Sync hardware IO shadow registers into ARAM snapshot ($F1, $F2, $F4..$F7)
    out[0x0100 + 0xf1] = this.spc.control;
    out[0x0100 + 0xf2] = this.spc.dspAddr;
    for (let i = 0; i < 4; i++) {
      out[0x0100 + 0xf4 + i] = this.spc.cpuToApu[i];
    }

    // 128-byte DSP registers at 0x10100
    out.set(this.spc.dsp.regs, 0x10100);

    // 64-byte IPL ROM at 0x101C0
    out.set(SPC_IPL_ROM, 0x101c0);
    return out;
  }
}
