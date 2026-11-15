import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { SnesApuSystem } from './snes-apu.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_PIKI_ZIP =
  '/Users/krisztiangyurko/.gemini/antigravity/brain/95d6d0de-01ea-4baf-b4d3-344003589145/.user_uploaded/media_1794665984478_7223cb61.zip';
const DEFAULT_PDP_ROM = join(ROOT, 'Panel de Pon (J).fig');
const OST_ROOT = join(ROOT, 'public', 'ost');
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

export type TrackCategory = 'bgm' | 'danger' | 'jingle';

export interface OstTrackEntry {
  id: string;
  game: 'pikiinya' | 'pdp';
  title: string;
  subtitle: string;
  category: TrackCategory;
  mp3: string;
  spc: string;
  durationSec: number;
  loopStartSec?: number;
  loopEndSec?: number;
  loopPeriodSec?: number;
  pairedDangerId?: string;
}

export interface DetectedAudioLoop {
  loopStartSec: number;
  loopEndSec: number;
  loopPeriodSec: number;
  totalFrames: number;
  fadeStartFrame: number;
}

export interface OstManifest {
  generatedAt: string;
  tracks: OstTrackEntry[];
  mappings: {
    pikiinya: Record<string, string>;
    pdp: Record<string, string>;
  };
}

function readZipFirstSfc(zipPath: string): Uint8Array {
  const buf = readFileSync(zipPath);
  let pos = 0;
  while (pos + 30 <= buf.length) {
    const sig = buf.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const flags = buf.readUInt16LE(pos + 6);
    const method = buf.readUInt16LE(pos + 8);
    let compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const dataStart = pos + 30 + nameLen + extraLen;

    if ((flags & 0x08) !== 0 && compSize === 0) {
      // Fall back to searching End of Central Directory / Central Directory for true compressed size
      break;
    }

    const data = buf.subarray(dataStart, dataStart + compSize);
    if (/\.(sfc|smc|fig)$/i.test(name)) {
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    pos = dataStart + compSize;
  }

  // Fallback parse via End of Central Directory record
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      const cdOffset = buf.readUInt32LE(i + 16);
      let c = cdOffset;
      while (c + 46 <= buf.length && buf.readUInt32LE(c) === 0x02014b50) {
        const method = buf.readUInt16LE(c + 10);
        const compSize = buf.readUInt32LE(c + 20);
        const nameLen = buf.readUInt16LE(c + 28);
        const extraLen = buf.readUInt16LE(c + 30);
        const commentLen = buf.readUInt16LE(c + 32);
        const localOff = buf.readUInt32LE(c + 42);
        const name = buf.subarray(c + 46, c + 46 + nameLen).toString('utf8');
        if (/\.(sfc|smc|fig)$/i.test(name)) {
          const lNameLen = buf.readUInt16LE(localOff + 26);
          const lExtraLen = buf.readUInt16LE(localOff + 28);
          const start = localOff + 30 + lNameLen + lExtraLen;
          const comp = buf.subarray(start, start + compSize);
          return method === 0 ? new Uint8Array(comp) : new Uint8Array(inflateRawSync(comp));
        }
        c += 46 + nameLen + extraLen + commentLen;
      }
      break;
    }
  }
  throw new Error(`No .sfc/.smc/.fig ROM found inside ${zipPath}`);
}

function loadRomAuto(pathStr: string): Uint8Array {
  if (pathStr.toLowerCase().endsWith('.zip')) {
    const raw = readZipFirstSfc(pathStr);
    return raw.length % 0x8000 === 512 ? raw.subarray(512) : raw;
  }
  const raw = new Uint8Array(readFileSync(pathStr));
  return raw.length % 0x8000 === 512 ? raw.subarray(512) : raw;
}

export function detectAudioLoop(
  pcm: Int16Array,
  sampleRate: number,
  opts: {
    minLagSec: number;
    maxLagSec: number;
    maxT0Sec: number;
    minBodySec: number;
    guardSec?: number;
    fadeSec?: number;
  }
): DetectedAudioLoop | null {
  const totalPcmFrames = Math.floor(pcm.length / 2);
  const binFrames = Math.max(1, Math.floor(sampleRate / 100)); // 100 Hz envelope (320 frames @ 32 kHz)
  const numBins = Math.floor(totalPcmFrames / binFrames);
  const minLagBins = Math.max(50, Math.round(opts.minLagSec * 100));
  const maxLagBinsLimit = Math.round(opts.maxLagSec * 100);
  const winBins = opts.minLagSec < 8 ? 400 : 600;

  if (numBins < winBins + minLagBins + 20) return null;

  const env = new Float64Array(numBins);
  const pref = new Float64Array(numBins + 1);
  const pref2 = new Float64Array(numBins + 1);
  for (let b = 0; b < numBins; b++) {
    let sum = 0;
    const base = b * binFrames * 2;
    for (let i = 0; i < binFrames; i++) {
      const l = pcm[base + i * 2];
      const r = pcm[base + i * 2 + 1];
      sum += (l < 0 ? -l : l) + (r < 0 ? -r : r);
    }
    const v = sum / binFrames;
    env[b] = v;
    pref[b + 1] = pref[b] + v;
    pref2[b + 1] = pref2[b] + v * v;
  }

  let chosenAnchorBin = -1;
  let chosenLagBins = -1;
  let chosenCorr = -1;

  for (let t0Sec = 2; t0Sec <= opts.maxT0Sec; t0Sec += 2) {
    const startBin = Math.round(t0Sec * 100);
    const maxLagBins = Math.min(maxLagBinsLimit, numBins - startBin - winBins - 1);
    if (maxLagBins <= minLagBins + 2) continue;

    const sumA = pref[startBin + winBins] - pref[startBin];
    const meanA = sumA / winBins;
    if (meanA < 80) continue;

    const sumA2 = pref2[startBin + winBins] - pref2[startBin];
    const varA = sumA2 - (sumA * sumA) / winBins;
    if (varA <= 1e-6) continue;

    const corrArr = new Float64Array(maxLagBins - minLagBins + 1);
    let bestCorr = -1;

    for (let lag = minLagBins; lag <= maxLagBins; lag++) {
      const bStart = startBin + lag;
      const sumB = pref[bStart + winBins] - pref[bStart];
      const sumB2 = pref2[bStart + winBins] - pref2[bStart];
      const varB = sumB2 - (sumB * sumB) / winBins;
      if (varB <= 1e-6) {
        corrArr[lag - minLagBins] = 0;
        continue;
      }

      let sumAB = 0;
      for (let w = 0; w < winBins; w++) {
        sumAB += env[startBin + w] * env[bStart + w];
      }
      const cov = sumAB - (sumA * sumB) / winBins;
      const corr = cov / Math.sqrt(varA * varB);
      corrArr[lag - minLagBins] = corr;
      if (corr > bestCorr) bestCorr = corr;
    }

    if (bestCorr < 0.915) continue;

    const minFullCorr = opts.minLagSec < 8 ? 0.82 : 0.855;
    const threshold = Math.max(0.915, bestCorr - 0.025);
    let pickedLag = -1;
    let pickedCorr = -1;
    let pickedFull = -1;
    for (let idx = 1; idx < corrArr.length - 1; idx++) {
      const c = corrArr[idx];
      if (c < threshold) continue;
      if (c < corrArr[idx - 1] || c < corrArr[idx + 1]) continue;
      // Verify local apex within +-10 bins so we center on 1*L peak
      let isLocalApex = true;
      const lo = Math.max(0, idx - 10);
      const hi = Math.min(corrArr.length - 1, idx + 10);
      for (let k = lo; k <= hi; k++) {
        if (corrArr[k] > c) {
          isLocalApex = false;
          break;
        }
      }
      if (!isLocalApex) continue;

      // Verify full-cycle envelope coherence so local 6s sub-motifs cannot mimic true full loops
      const lag = minLagBins + idx;
      const fullSpan = Math.min(lag, numBins - startBin - lag - 1);
      if (fullSpan < winBins) continue;
      const fullSumA = pref[startBin + fullSpan] - pref[startBin];
      const fullVarA = pref2[startBin + fullSpan] - pref2[startBin] - (fullSumA * fullSumA) / fullSpan;
      const fullB = startBin + lag;
      const fullSumB = pref[fullB + fullSpan] - pref[fullB];
      const fullVarB = pref2[fullB + fullSpan] - pref2[fullB] - (fullSumB * fullSumB) / fullSpan;
      if (fullVarA <= 1e-6 || fullVarB <= 1e-6) continue;
      let fullSumAB = 0;
      for (let w = 0; w < fullSpan; w++) {
        fullSumAB += env[startBin + w] * env[fullB + w];
      }
      const fullCorr = (fullSumAB - (fullSumA * fullSumB) / fullSpan) / Math.sqrt(fullVarA * fullVarB);
      if (fullCorr < minFullCorr) continue;

      pickedLag = lag;
      pickedCorr = c;
      pickedFull = fullCorr;
      break;
    }

    if (pickedLag < 0) continue;

    const combinedScore = pickedCorr * 0.4 + pickedFull * 0.6;
    if (pickedCorr >= 0.95 && pickedFull >= 0.92) {
      chosenAnchorBin = startBin;
      chosenLagBins = pickedLag;
      chosenCorr = combinedScore;
      break;
    }
    if (combinedScore > chosenCorr) {
      chosenAnchorBin = startBin;
      chosenLagBins = pickedLag;
      chosenCorr = combinedScore;
    }
  }

  if (chosenAnchorBin < 0 || chosenLagBins < 0 || chosenCorr < 0.85) {
    return null;
  }

  // Sample-accurate phase refinement over +-binFrames stereo frames
  const t0Frames = chosenAnchorBin * binFrames;
  const approxLagFrames = chosenLagBins * binFrames;
  const refineCompareFrames = Math.min(
    Math.floor(sampleRate * 0.5),
    totalPcmFrames - t0Frames - approxLagFrames - binFrames - 2
  );

  let refinedLagFrames = approxLagFrames;
  if (refineCompareFrames > 512) {
    let coarseDelta = 0;
    let coarseScore = -Infinity;
    for (let delta = -binFrames; delta <= binFrames; delta += 4) {
      const lagFrames = approxLagFrames + delta;
      if (t0Frames + lagFrames + refineCompareFrames >= totalPcmFrames) continue;
      let dot = 0;
      let energyB = 1;
      for (let k = 0; k < refineCompareFrames; k += 2) {
        const aIdx = (t0Frames + k) * 2;
        const bIdx = (t0Frames + lagFrames + k) * 2;
        const bL = pcm[bIdx];
        const bR = pcm[bIdx + 1];
        dot += pcm[aIdx] * bL + pcm[aIdx + 1] * bR;
        energyB += bL * bL + bR * bR;
      }
      const norm = dot / Math.sqrt(energyB);
      if (norm > coarseScore) {
        coarseScore = norm;
        coarseDelta = delta;
      }
    }

    let fineDelta = coarseDelta;
    let fineScore = -Infinity;
    for (let delta = Math.max(-binFrames, coarseDelta - 4); delta <= Math.min(binFrames, coarseDelta + 4); delta++) {
      const lagFrames = approxLagFrames + delta;
      if (t0Frames + lagFrames + refineCompareFrames >= totalPcmFrames) continue;
      let dot = 0;
      let energyB = 1;
      for (let k = 0; k < refineCompareFrames; k++) {
        const aIdx = (t0Frames + k) * 2;
        const bIdx = (t0Frames + lagFrames + k) * 2;
        const bL = pcm[bIdx];
        const bR = pcm[bIdx + 1];
        dot += pcm[aIdx] * bL + pcm[aIdx + 1] * bR;
        energyB += bL * bL + bR * bR;
      }
      const norm = dot / Math.sqrt(energyB);
      if (norm > fineScore) {
        fineScore = norm;
        fineDelta = delta;
      }
    }
    refinedLagFrames = approxLagFrames + fineDelta;
  }

  if (refinedLagFrames <= sampleRate) return null;

  const guardSec = opts.guardSec ?? 0.6;
  const fadeSec = opts.fadeSec ?? 3.2;
  const loopPeriodSec = refinedLagFrames / sampleRate;
  let loops = Math.max(2, Math.ceil(opts.minBodySec / loopPeriodSec));
  while (loops > 1 && t0Frames + loops * refinedLagFrames + Math.floor(guardSec * sampleRate) > totalPcmFrames) {
    loops--;
  }
  if (t0Frames + loops * refinedLagFrames > totalPcmFrames) {
    return null;
  }

  const loopEndFrame = t0Frames + loops * refinedLagFrames;
  const fadeStartFrame = Math.min(totalPcmFrames, loopEndFrame + Math.floor(guardSec * sampleRate));
  const totalFrames = Math.min(totalPcmFrames, fadeStartFrame + Math.floor(fadeSec * sampleRate));

  return {
    loopStartSec: Math.round((t0Frames / sampleRate) * 1000) / 1000,
    loopEndSec: Math.round((loopEndFrame / sampleRate) * 1000) / 1000,
    loopPeriodSec: Math.round(loopPeriodSec * 1000) / 1000,
    totalFrames,
    fadeStartFrame,
  };
}

function applyFadeOutAndNormalize(
  pcm: Int16Array,
  opts: {
    totalFrames?: number;
    fadeStartFrame?: number;
    fadeSec?: number;
    isLooping: boolean;
  }
): Int16Array {
  const sampleRate = 32000;
  const availableFrames = Math.floor(pcm.length / 2);
  const totalFrames = Math.max(0, Math.min(availableFrames, opts.totalFrames ?? availableFrames));
  let peak = 0;
  for (let i = 0; i < totalFrames * 2; i++) {
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a > peak) peak = a;
  }
  const targetPeak = 27500;
  const gain = peak > 400 ? Math.min(2.6, targetPeak / peak) : 1.0;

  let fadeStart: number;
  if (opts.fadeStartFrame !== undefined) {
    fadeStart = Math.max(0, Math.min(totalFrames, opts.fadeStartFrame));
  } else {
    const fadeSec = opts.fadeSec ?? (opts.isLooping ? 3.0 : 0.25);
    const defaultFadeFrames = opts.isLooping
      ? Math.min(Math.floor(fadeSec * sampleRate), Math.floor(totalFrames / 3))
      : Math.floor(0.25 * sampleRate);
    fadeStart = Math.max(0, totalFrames - defaultFadeFrames);
  }
  const fadeFrames = Math.max(0, totalFrames - fadeStart);

  const out = new Int16Array(totalFrames * 2);
  for (let f = 0; f < totalFrames; f++) {
    let env = gain;
    if (f >= fadeStart && fadeFrames > 0) {
      env *= (totalFrames - f) / fadeFrames;
    }
    const sL = Math.round(pcm[f * 2] * env);
    const sR = Math.round(pcm[f * 2 + 1] * env);
    out[f * 2] = Math.max(-32768, Math.min(32767, sL));
    out[f * 2 + 1] = Math.max(-32768, Math.min(32767, sR));
  }
  return out;
}

function encodeMp3(pcm: Int16Array, outMp3Path: string): void {
  const rawBytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  execFileSync(
    FFMPEG_BIN,
    [
      '-y',
      '-loglevel', 'error',
      '-f', 's16le',
      '-ar', '32000',
      '-ac', '2',
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      outMp3Path,
    ],
    { input: rawBytes, maxBuffer: 64 * 1024 * 1024 }
  );
}

interface PikiTrackDef {
  packId: number;
  subSongId: number;
  slug: string;
  title: string;
  subtitle: string;
  category: TrackCategory;
}

const PIKI_TRACK_CATALOG: Record<number, Omit<PikiTrackDef, 'packId'>> = {
  0x00: { subSongId: 0x00, slug: 'title-screen', title: 'Title Screen (Glacier Anthem)', subtitle: 'Opening / Title Theme', category: 'bgm' },
  0x01: { subSongId: 0x01, slug: 'story-stage-1-bongo', title: 'Andes Breeze — Stage 1 (Bongo)', subtitle: 'Story VS Early Theme', category: 'bgm' },
  0x02: { subSongId: 0x02, slug: 'story-stage-2-puff', title: 'Alpine March — Stage 2 (Puff)', subtitle: 'Story VS Highland Theme', category: 'bgm' },
  0x03: { subSongId: 0x03, slug: 'cutscene-map', title: 'Andes Expedition Map', subtitle: 'Story Map / Mode Select', category: 'bgm' },
  0x04: { subSongId: 0x04, slug: 'story-stage-3-koro', title: 'Snowdrift Samba — Stage 3 (Koro)', subtitle: 'Story VS Rhythm', category: 'bgm' },
  0x05: { subSongId: 0x05, slug: 'story-stage-4-pipo', title: 'Iceberg Polka — Stage 4 (Pipo)', subtitle: 'Stage Clear Omote Theme', category: 'bgm' },
  0x06: { subSongId: 0x06, slug: 'story-stage-5-moko', title: 'Summit Sled — Stage 5 (Moko)', subtitle: 'Endurance Race Theme', category: 'bgm' },
  0x07: { subSongId: 0x07, slug: 'story-stage-6-zabu', title: 'Frost Peak — Stage 6 (Zabu)', subtitle: 'Time Attack / Endless Theme', category: 'bgm' },
  0x08: { subSongId: 0x08, slug: 'story-stage-7-goro', title: 'Slagger Fortress — Stage 7 (Goro)', subtitle: 'Stage Clear Ura Theme', category: 'bgm' },
  0x09: { subSongId: 0x09, slug: 'puzzle-mode', title: 'Glacier Lecture & Puzzle', subtitle: 'Puzzle / Stage Tsukuru / Lecture', category: 'bgm' },
  0x0a: { subSongId: 0x0a, slug: 'boss-dr-slagger', title: 'Dr. Slagger Final Battle', subtitle: 'Final Boss Theme', category: 'bgm' },
  0x0b: { subSongId: 0x0b, slug: 'endless-mode', title: 'Endless Aurora Dance', subtitle: '2P VS / Endless Alternate', category: 'bgm' },
  0x0c: { subSongId: 0x0c, slug: 'ending-credits', title: 'Staff Roll & Ending', subtitle: 'Story Victory Credits', category: 'bgm' },
  0x0d: { subSongId: 0x0d, slug: 'results-tally', title: 'Glacier Results', subtitle: 'Score Tally / Results', category: 'bgm' },
  0x0e: { subSongId: 0x0e, slug: 'hurry-fanfare', title: 'Bonus / Event Jingle', subtitle: 'Event Transition', category: 'bgm' },
  0x0f: { subSongId: 0x0f, slug: 'title-intro', title: 'Opening Fanfare', subtitle: 'Intro Jingle', category: 'jingle' },
  0x10: { subSongId: 0x10, slug: 'stage-start', title: 'Ready! Stage Start', subtitle: 'Round Intro Jingle', category: 'jingle' },
  0x11: { subSongId: 0x11, slug: 'pinch-stage-1', title: 'Pinch! Stage 1 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x12: { subSongId: 0x12, slug: 'pinch-stage-2', title: 'Pinch! Stage 2 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x13: { subSongId: 0x13, slug: 'pinch-stage-3', title: 'Pinch! Stage 3 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x14: { subSongId: 0x14, slug: 'pinch-stage-4', title: 'Pinch! Stage 4 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x15: { subSongId: 0x15, slug: 'pinch-stage-5', title: 'Pinch! Stage 5 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x16: { subSongId: 0x16, slug: 'pinch-stage-6', title: 'Pinch! Stage 6 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x17: { subSongId: 0x17, slug: 'pinch-stage-7', title: 'Pinch! Stage 7 Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x18: { subSongId: 0x18, slug: 'pinch-puzzle', title: 'Pinch! Puzzle Danger', subtitle: 'Danger / Urgent Alert', category: 'danger' },
  0x19: { subSongId: 0x19, slug: 'pinch-boss', title: 'Pinch! Dr. Slagger Danger', subtitle: 'Final Boss Danger Theme', category: 'danger' },
  0x1a: { subSongId: 0x1a, slug: 'pinch-endless', title: 'Pinch! Endless Danger', subtitle: 'Danger / High Stack Alert', category: 'danger' },
  0x1b: { subSongId: 0x1b, slug: 'stage-clear-fanfare', title: 'Stage Clear Fanfare!', subtitle: 'Victory Jingle', category: 'jingle' },
  0x1c: { subSongId: 0x1c, slug: 'game-over-fanfare', title: 'Game Over', subtitle: 'Defeat Jingle', category: 'jingle' },
  0x1d: { subSongId: 0x1d, slug: 'title-chime', title: 'ASCII / Crea-Tech Logo Chime', subtitle: 'Boot Chime', category: 'jingle' },
};

function discoverPikiTracks(rom: Uint8Array): PikiTrackDef[] {
  const seenSubSongs = new Map<number, { packId: number }>();
  const tblBase = 0x19201a; // $B2:A01A
  for (let packId = 0; packId < 17; packId++) {
    const ptr = rom[tblBase + packId * 2] | (rom[tblBase + packId * 2 + 1] << 8);
    const packOff = 0x190000 + (ptr - 0x8000);
    // Byte 0: sampleBank; Byte 1..2: len1; followed by 0xFF-terminated subSong list
    let idx = packOff + 3;
    while (idx < rom.length && rom[idx] !== 0xff) {
      const subId = rom[idx++];
      if (subId < 0x1e && !seenSubSongs.has(subId)) {
        seenSubSongs.set(subId, { packId });
      }
    }
  }

  const list: PikiTrackDef[] = [];
  const sortedIds = Array.from(seenSubSongs.keys()).sort((a, b) => a - b);
  for (const subSongId of sortedIds) {
    const { packId } = seenSubSongs.get(subSongId)!;
    const meta = PIKI_TRACK_CATALOG[subSongId] ?? {
      subSongId,
      slug: `track-${subSongId.toString(16).padStart(2, '0')}`,
      title: `Pikiinya! Track #${subSongId.toString(16).toUpperCase().padStart(2, '0')}`,
      subtitle: `Sound Pack #${packId}`,
      category: 'bgm' as TrackCategory,
    };
    list.push({ packId, ...meta });
  }
  return list;
}

function finalizeRenderedTrack(
  rendered: { pcm: Int16Array; sampleCount: number; peak: number; rms: number; endedBySilence: boolean },
  category: TrackCategory,
  mp3Path: string
): {
  durationSec: number;
  spcDurationSec: number;
  fadeMs: number;
  loop: DetectedAudioLoop | null;
} {
  const sampleRate = 32000;
  let loop: DetectedAudioLoop | null = null;
  if (!rendered.endedBySilence && category !== 'jingle') {
    loop = detectAudioLoop(
      rendered.pcm,
      sampleRate,
      category === 'danger'
        ? { minLagSec: 5, maxLagSec: 55, maxT0Sec: 22, minBodySec: 55 }
        : { minLagSec: 10, maxLagSec: 135, maxT0Sec: 45, minBodySec: 110 }
    );
  }

  let totalFrames: number;
  let fadeStartFrame: number | undefined;
  if (loop) {
    totalFrames = loop.totalFrames;
    fadeStartFrame = loop.fadeStartFrame;
  } else if (!rendered.endedBySilence) {
    const fallbackSec = category === 'danger' ? 75 : 160;
    totalFrames = Math.min(rendered.sampleCount, fallbackSec * sampleRate);
  } else {
    totalFrames = rendered.sampleCount;
  }

  const finalPcm = applyFadeOutAndNormalize(rendered.pcm, {
    totalFrames,
    fadeStartFrame,
    fadeSec: rendered.endedBySilence ? 0.25 : 3.2,
    isLooping: !rendered.endedBySilence,
  });
  encodeMp3(finalPcm, mp3Path);

  const durationSec = Math.round((totalFrames / sampleRate) * 10) / 10;
  const spcDurationSec = loop ? Math.ceil(loop.loopEndSec) : durationSec;
  const fadeMs = rendered.endedBySilence ? 300 : 3200;
  return { durationSec, spcDurationSec, fadeMs, loop };
}

function ripPikiinyaTrack(rom: Uint8Array, def: PikiTrackDef, outDir: string): OstTrackEntry {
  const sys = new SnesApuSystem(rom);
  sys.spc.stepCycles(4000); // Boot SPC IPL ($AA/$BB handshake ready)

  // cmd 0x00: Boot APU driver to $0300
  sys.writeByte(0, 0x1f00, 0x00);
  sys.callJSL(0xb2, 0x8000);

  // cmd 0x01: Upload Pack (samples + instruments + pack sub-songs)
  sys.writeByte(0, 0x1f00, 0x01);
  sys.writeByte(0, 0x1f01, def.packId);
  sys.callJSL(0xb2, 0x8000);

  // cmd 0x02: Start BGM subSongId
  sys.writeByte(0, 0x1f00, 0x02);
  sys.writeByte(0, 0x1f01, def.subSongId);
  sys.callJSL(0xb2, 0x8000);

  // Advance slightly so initial voice key-on / channel setup is captured in the .spc snapshot
  sys.spc.stepCycles(4096);

  const hexId = def.subSongId.toString(16).padStart(2, '0');
  const baseName = `piki-${hexId}-${def.slug}`;
  const spcPath = join(outDir, `${baseName}.spc`);
  const mp3Path = join(outDir, `${baseName}.mp3`);

  const maxDuration = def.category === 'jingle' ? 30 : def.category === 'danger' ? 95 : 220;
  const rendered = sys.renderPcm(maxDuration, {
    stopOnSilenceSec: 1.8,
    minSoundSec: 1.2,
  });

  if (rendered.peak < 150 || rendered.rms < 15) {
    throw new Error(
      `Pikiinya subSong 0x${hexId} (pack ${def.packId}) produced low/silent audio! peak=${rendered.peak}, rms=${rendered.rms.toFixed(1)}, kon=${sys.spc.dsp.totalKonEvents}`
    );
  }

  // Classify short non-looping tracks automatically if render ended early by silence
  const actualCategory: TrackCategory =
    rendered.endedBySilence && rendered.sampleCount < 22 * 32000 ? 'jingle' : def.category;

  const { durationSec, spcDurationSec, fadeMs, loop } = finalizeRenderedTrack(
    rendered,
    actualCategory,
    mp3Path
  );

  // Save .spc snapshot (re-boot fresh snapshot at note start for cleanest .spc file)
  const snapSys = new SnesApuSystem(rom);
  snapSys.spc.stepCycles(4000);
  snapSys.writeByte(0, 0x1f00, 0x00);
  snapSys.callJSL(0xb2, 0x8000);
  snapSys.writeByte(0, 0x1f00, 0x01);
  snapSys.writeByte(0, 0x1f01, def.packId);
  snapSys.callJSL(0xb2, 0x8000);
  snapSys.writeByte(0, 0x1f00, 0x02);
  snapSys.writeByte(0, 0x1f01, def.subSongId);
  snapSys.callJSL(0xb2, 0x8000);
  snapSys.spc.stepCycles(4096);
  writeFileSync(
    spcPath,
    snapSys.exportSpc({
      songTitle: def.title,
      gameTitle: 'Pikiinya! (SNES)',
      comments: `Pack ${def.packId} SubSong 0x${hexId}`,
      durationSec: spcDurationSec,
      fadeMs,
    })
  );

  const loopInfo = loop
    ? `loop=${loop.loopStartSec.toFixed(1)}..${loop.loopEndSec.toFixed(1)}s (P=${loop.loopPeriodSec.toFixed(1)}s)`
    : rendered.endedBySilence
      ? 'one-shot'
      : 'unlooped-cap';
  console.log(
    `[PIKI ${hexId}] ${def.title.padEnd(36)} | ${actualCategory.padEnd(6)} | ${durationSec.toFixed(1).padStart(5)}s | ${loopInfo} | peak=${String(rendered.peak).padStart(5)}`
  );

  return {
    id: `piki-${hexId}`,
    game: 'pikiinya',
    title: def.title,
    subtitle: def.subtitle,
    category: actualCategory,
    mp3: `/ost/pikiinya/${baseName}.mp3`,
    spc: `/ost/pikiinya/${baseName}.spc`,
    durationSec,
    ...(loop
      ? {
          loopStartSec: loop.loopStartSec,
          loopEndSec: loop.loopEndSec,
          loopPeriodSec: loop.loopPeriodSec,
        }
      : {}),
  };
}

interface PdpTrackDef {
  id: string;
  bankCode: number;
  cmd: number;
  slug: string;
  title: string;
  subtitle: string;
  category: TrackCategory;
  pairedDangerId?: string;
}

const PDP_TRACK_LIST: PdpTrackDef[] = [
  { id: 'pdp-02-title', bankCode: 0x8002, cmd: 0x00d1, slug: 'title', title: 'Title Screen', subtitle: 'Panel de Pon Main Theme', category: 'bgm' },
  { id: 'pdp-03-menu', bankCode: 0x8004, cmd: 0x00d1, slug: 'select', title: 'Mode & Fairy Select', subtitle: 'Menu Theme', category: 'bgm' },
  { id: 'pdp-07-puzzle', bankCode: 0x8007, cmd: 0x00d1, slug: 'puzzle', title: 'Stage Clear / Puzzle', subtitle: 'Thinking & Puzzle Theme', category: 'bgm' },
  { id: 'pdp-09-ending', bankCode: 0x8009, cmd: 0x00d1, slug: 'ending', title: 'Ending Theme', subtitle: 'Fairy Queen Gratitude', category: 'bgm' },

  { id: 'pdp-0a-lip', bankCode: 0x800a, cmd: 0x00d1, slug: 'lip-normal', title: "Lip's Theme (Flower Fairy)", subtitle: 'Stage / Endless Normal', category: 'bgm', pairedDangerId: 'pdp-0a-lip-danger' },
  { id: 'pdp-0a-lip-danger', bankCode: 0x800a, cmd: 0x00d2, slug: 'lip-danger', title: "Lip's Theme (Critical!)", subtitle: 'Danger / High Stack', category: 'danger' },

  { id: 'pdp-0b-windy', bankCode: 0x800b, cmd: 0x00d1, slug: 'windy-normal', title: "Windy's Theme (Wind Fairy)", subtitle: 'Stage 1 Normal', category: 'bgm', pairedDangerId: 'pdp-0b-windy-danger' },
  { id: 'pdp-0b-windy-danger', bankCode: 0x800b, cmd: 0x00d2, slug: 'windy-danger', title: "Windy's Theme (Critical!)", subtitle: 'Stage 1 Danger', category: 'danger' },

  { id: 'pdp-0c-elias', bankCode: 0x800c, cmd: 0x00d1, slug: 'elias-normal', title: "Elias's Theme (Water Fairy)", subtitle: '2P Battle / Stage 5', category: 'bgm', pairedDangerId: 'pdp-0c-elias-danger' },
  { id: 'pdp-0c-elias-danger', bankCode: 0x800c, cmd: 0x00d2, slug: 'elias-danger', title: "Elias's Theme (Critical!)", subtitle: '2P / Stage 5 Danger', category: 'danger' },

  { id: 'pdp-0d-ruby', bankCode: 0x800d, cmd: 0x00d1, slug: 'ruby-normal', title: "Ruby's Theme (Jewel Fairy)", subtitle: 'Stage 4 Normal', category: 'bgm', pairedDangerId: 'pdp-0d-ruby-danger' },
  { id: 'pdp-0d-ruby-danger', bankCode: 0x800d, cmd: 0x00d2, slug: 'ruby-danger', title: "Ruby's Theme (Critical!)", subtitle: 'Stage 4 Danger', category: 'danger' },

  { id: 'pdp-0e-thiana', bankCode: 0x800e, cmd: 0x00d1, slug: 'thiana-normal', title: "Thiana's Theme (Forest Fairy)", subtitle: 'Stage 3 Normal', category: 'bgm', pairedDangerId: 'pdp-0e-thiana-danger' },
  { id: 'pdp-0e-thiana-danger', bankCode: 0x800e, cmd: 0x00d2, slug: 'thiana-danger', title: "Thiana's Theme (Critical!)", subtitle: 'Stage 3 Danger', category: 'danger' },

  { id: 'pdp-0f-sherbet', bankCode: 0x800f, cmd: 0x00d1, slug: 'sherbet-normal', title: "Sherbet's Theme (Ice Fairy)", subtitle: 'Stage 2 Normal', category: 'bgm', pairedDangerId: 'pdp-0f-sherbet-danger' },
  { id: 'pdp-0f-sherbet-danger', bankCode: 0x800f, cmd: 0x00d2, slug: 'sherbet-danger', title: "Sherbet's Theme (Critical!)", subtitle: 'Stage 2 Danger', category: 'danger' },

  { id: 'pdp-10-selene', bankCode: 0x8010, cmd: 0x00d1, slug: 'selene-normal', title: "Selene's Theme (Moon Fairy)", subtitle: 'Stage 8 Normal', category: 'bgm', pairedDangerId: 'pdp-10-selene-danger' },
  { id: 'pdp-10-selene-danger', bankCode: 0x8010, cmd: 0x00d2, slug: 'selene-danger', title: "Selene's Theme (Critical!)", subtitle: 'Stage 8 Danger', category: 'danger' },

  { id: 'pdp-11-neris', bankCode: 0x8011, cmd: 0x00d1, slug: 'neris-normal', title: "Neris's Theme (Sea Fairy)", subtitle: 'Stage 7 Normal', category: 'bgm', pairedDangerId: 'pdp-11-neris-danger' },
  { id: 'pdp-11-neris-danger', bankCode: 0x8011, cmd: 0x00d2, slug: 'neris-danger', title: "Neris's Theme (Critical!)", subtitle: 'Stage 7 Danger', category: 'danger' },

  { id: 'pdp-12-flare', bankCode: 0x8012, cmd: 0x00d1, slug: 'flare-normal', title: "Flare's Theme (Fire Fairy)", subtitle: 'Stage 6 Normal', category: 'bgm', pairedDangerId: 'pdp-12-flare-danger' },
  { id: 'pdp-12-flare-danger', bankCode: 0x8012, cmd: 0x00d2, slug: 'flare-danger', title: "Flare's Theme (Critical!)", subtitle: 'Stage 6 Danger', category: 'danger' },

  { id: 'pdp-13-thanatos', bankCode: 0x8013, cmd: 0x00d1, slug: 'thanatos-normal', title: "Thanatos's Theme (Boss)", subtitle: 'Stage 11 Normal', category: 'bgm', pairedDangerId: 'pdp-13-thanatos-danger' },
  { id: 'pdp-13-thanatos-danger', bankCode: 0x8013, cmd: 0x00d2, slug: 'thanatos-danger', title: "Thanatos's Theme (Critical!)", subtitle: 'Stage 11 Danger', category: 'danger' },

  { id: 'pdp-14-phoenix', bankCode: 0x8014, cmd: 0x00d1, slug: 'phoenix-dragon-normal', title: 'Phoenix & Dragon (Bosses)', subtitle: 'Stages 9-10 Normal', category: 'bgm', pairedDangerId: 'pdp-14-phoenix-danger' },
  { id: 'pdp-14-phoenix-danger', bankCode: 0x8014, cmd: 0x00d2, slug: 'phoenix-dragon-danger', title: 'Phoenix & Dragon (Critical!)', subtitle: 'Stages 9-10 Danger', category: 'danger' },

  { id: 'pdp-15-corderia', bankCode: 0x8015, cmd: 0x00d1, slug: 'corderia-normal', title: "Corderia's Theme (Final Boss)", subtitle: 'Stage 12 Normal', category: 'bgm', pairedDangerId: 'pdp-15-corderia-danger' },
  { id: 'pdp-15-corderia-danger', bankCode: 0x8015, cmd: 0x00d2, slug: 'corderia-danger', title: "Corderia's Theme (Critical!)", subtitle: 'Stage 12 Danger', category: 'danger' },
];

function bootAndTriggerPdpTrack(rom: Uint8Array, def: PdpTrackDef): SnesApuSystem {
  const sys = new SnesApuSystem(rom);
  sys.spc.stepCycles(4000);
  sys.d = 0;

  // Boot base N-SPC driver + sound tables via JSL $80:8E29
  sys.callJSL(0x80, 0x8e29);
  sys.spc.stepCycles(18000);

  // Queue song bank load + song trigger
  sys.writeByte(0, 0x199e, def.bankCode & 0xff);
  sys.writeByte(0, 0x199f, (def.bankCode >> 8) & 0xff);
  sys.writeByte(0, 0x1988, def.cmd & 0xff);
  sys.writeByte(0, 0x1989, (def.cmd >> 8) & 0xff);
  sys.writeByte(0, 0x19b5, 0); // Keep PPU/HDMA flag clear

  // Run enough VBlank ticks for N-SPC queue handler ($80:8EB6) and block uploader ($80:905B)
  for (let frame = 0; frame < 24; frame++) {
    sys.callJSL(0x80, 0x8eb6);
    sys.callJSL(0x80, 0x905b);
    sys.spc.stepCycles(17066);
  }
  return sys;
}

function ripPdpTrack(rom: Uint8Array, def: PdpTrackDef, outDir: string): OstTrackEntry {
  const sys = bootAndTriggerPdpTrack(rom, def);
  const spcPath = join(outDir, `${def.id}.spc`);
  const mp3Path = join(outDir, `${def.id}.mp3`);

  const maxDuration = def.category === 'danger' ? 95 : 295;
  const rendered = sys.renderPcm(maxDuration, {
    stopOnSilenceSec: 2.2,
    minSoundSec: 1.5,
  });

  if (rendered.peak < 150 || rendered.rms < 15) {
    throw new Error(
      `PdP track ${def.id} produced low/silent audio! peak=${rendered.peak}, rms=${rendered.rms.toFixed(1)}, kon=${sys.spc.dsp.totalKonEvents}`
    );
  }

  const { durationSec, spcDurationSec, fadeMs, loop } = finalizeRenderedTrack(
    rendered,
    def.category,
    mp3Path
  );

  const snapSys = bootAndTriggerPdpTrack(rom, def);
  writeFileSync(
    spcPath,
    snapSys.exportSpc({
      songTitle: def.title,
      gameTitle: 'Panel de Pon (SNES)',
      comments: `Bank $${def.bankCode.toString(16)} Cmd $${def.cmd.toString(16)}`,
      durationSec: spcDurationSec,
      fadeMs,
    })
  );

  const loopInfo = loop
    ? `loop=${loop.loopStartSec.toFixed(1)}..${loop.loopEndSec.toFixed(1)}s (P=${loop.loopPeriodSec.toFixed(1)}s)`
    : rendered.endedBySilence
      ? 'one-shot'
      : 'unlooped-cap';
  console.log(
    `[PDP  ${def.bankCode.toString(16)}] ${def.title.padEnd(36)} | ${def.category.padEnd(6)} | ${durationSec.toFixed(1).padStart(5)}s | ${loopInfo} | peak=${String(rendered.peak).padStart(5)}`
  );

  return {
    id: def.id,
    game: 'pdp',
    title: def.title,
    subtitle: def.subtitle,
    category: def.category,
    mp3: `/ost/pdp/${def.id}.mp3`,
    spc: `/ost/pdp/${def.id}.spc`,
    durationSec,
    ...(loop
      ? {
          loopStartSec: loop.loopStartSec,
          loopEndSec: loop.loopEndSec,
          loopPeriodSec: loop.loopPeriodSec,
        }
      : {}),
    pairedDangerId: def.pairedDangerId,
  };
}

export function ripAllSoundtracks(opts?: { pikiRom?: string; pdpRom?: string }): OstManifest {
  const pikiPath = opts?.pikiRom ?? DEFAULT_PIKI_ZIP;
  const pdpPath = opts?.pdpRom ?? DEFAULT_PDP_ROM;
  const pikiOut = join(OST_ROOT, 'pikiinya');
  const pdpOut = join(OST_ROOT, 'pdp');
  mkdirSync(pikiOut, { recursive: true });
  mkdirSync(pdpOut, { recursive: true });

  const tracks: OstTrackEntry[] = [];

  if (existsSync(pikiPath)) {
    console.log(`=== Ripping Pikiinya! OST from ${pikiPath} ===`);
    const pikiRom = loadRomAuto(pikiPath);
    const defs = discoverPikiTracks(pikiRom);
    const pikiTracks = defs.map((def) => ripPikiinyaTrack(pikiRom, def, pikiOut));

    // Pair Normal Pikiinya stage themes (0x01..0x0B) with their Pinch Danger tracks (0x11..0x1A)
    const dangerMap: Record<string, string> = {
      'piki-01': 'piki-11',
      'piki-02': 'piki-12',
      'piki-04': 'piki-13',
      'piki-05': 'piki-14',
      'piki-06': 'piki-15',
      'piki-07': 'piki-16',
      'piki-08': 'piki-17',
      'piki-09': 'piki-18',
      'piki-0a': 'piki-19',
      'piki-0b': 'piki-1a',
    };
    const pikiIds = new Set(pikiTracks.filter((t) => t.category !== 'jingle').map((t) => t.id));
    for (const t of pikiTracks) {
      const candidate = dangerMap[t.id];
      if (candidate && pikiIds.has(candidate)) {
        t.pairedDangerId = candidate;
      }
      tracks.push(t);
    }
  } else {
    console.warn(`Pikiinya ROM not found at ${pikiPath}, skipping.`);
  }

  if (existsSync(pdpPath)) {
    console.log(`\n=== Ripping Panel de Pon OST from ${pdpPath} ===`);
    const pdpRom = loadRomAuto(pdpPath);
    for (const def of PDP_TRACK_LIST) {
      tracks.push(ripPdpTrack(pdpRom, def, pdpOut));
    }
  } else {
    console.warn(`Panel de Pon ROM not found at ${pdpPath}, skipping.`);
  }

  // Filter fallback mappings so only verified looping BGM tracks are assigned to gameplay contexts
  const validBgm = new Set(tracks.filter((t) => t.category === 'bgm').map((t) => t.id));
  const pickBgm = (...candidates: string[]): string => {
    for (const id of candidates) {
      if (validBgm.has(id)) return id;
    }
    return tracks[0]?.id ?? '';
  };

  const manifest: OstManifest = {
    generatedAt: new Date().toISOString(),
    tracks,
    mappings: {
      pikiinya: {
        endless: pickBgm('piki-07', 'piki-0b', 'piki-00'),
        endurance: pickBgm('piki-06', 'piki-07', 'piki-00'),
        timeattack: pickBgm('piki-07', 'piki-05', 'piki-00'),
        stageclear: pickBgm('piki-05', 'piki-08', 'piki-00'),
        stageclear_ura: pickBgm('piki-08', 'piki-05', 'piki-00'),
        puzzle: pickBgm('piki-09', 'piki-03', 'piki-00'),
        tutorial: pickBgm('piki-03', 'piki-09', 'piki-00'),
        vs2p: pickBgm('piki-0b', 'piki-04', 'piki-00'),
        story_0: pickBgm('piki-01', 'piki-00'),
        story_1: pickBgm('piki-02', 'piki-01'),
        story_2: pickBgm('piki-04', 'piki-01'),
        story_3: pickBgm('piki-05', 'piki-01'),
        story_4: pickBgm('piki-06', 'piki-01'),
        story_5: pickBgm('piki-07', 'piki-01'),
        story_6: pickBgm('piki-08', 'piki-01'),
        story_7: pickBgm('piki-0a', 'piki-08'),
      },
      pdp: {
        endless: 'pdp-0a-lip',
        timeattack: 'pdp-0a-lip',
        puzzle: 'pdp-07-puzzle',
        vs2p: 'pdp-0c-elias',
        vs_0: 'pdp-0b-windy',
        vs_1: 'pdp-0f-sherbet',
        vs_2: 'pdp-0e-thiana',
        vs_3: 'pdp-0d-ruby',
        vs_4: 'pdp-0c-elias',
        vs_5: 'pdp-12-flare',
        vs_6: 'pdp-11-neris',
        vs_7: 'pdp-10-selene',
        vs_8: 'pdp-14-phoenix',
        vs_9: 'pdp-14-phoenix',
        vs_10: 'pdp-13-thanatos',
        vs_11: 'pdp-15-corderia',
      },
    },
  };

  writeFileSync(join(OST_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${tracks.length} tracks + manifest to ${OST_ROOT}`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  ripAllSoundtracks();
}
