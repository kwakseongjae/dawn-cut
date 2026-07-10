// BGM 소스 팩(D6) — 절차 생성 음악 6무드. broll 팩과 같은 철학:
// 외부 샘플 0(저작권 0), 오프라인, 시드 고정(결정적). 순수 PCM 신스 → wav → m4a(AAC).
//
// 음질 수칙(패킷 D6): 패드=디튠 osc+느린 어택+원폴 LP, 플럭=exp 디케이+핑퐁 딜레이,
// 베이스=사인 기반, 킥=피치 드랍, 햇=차분(디퍼런시에이터) 노이즈. 루프 클린 = 꼬리 접기.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SR = 44100;
const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'assets/bgm');
mkdirSync(OUT_DIR, { recursive: true });

// ── 시드 고정 rng (mulberry32 — broll 팩과 동일 철학) ──
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const TAU = Math.PI * 2;

// ── 스테레오 버스 ──
class Bus {
  l: Float64Array;
  r: Float64Array;
  constructor(n: number) {
    this.l = new Float64Array(n);
    this.r = new Float64Array(n);
  }
}

/** 원폴 로우패스 계수(cutoff Hz). */
const lpA = (cutoff: number) => 1 - Math.exp((-TAU * cutoff) / SR);

/** 디튠 소우/트라이 패드 노트 — 느린 어택, 원폴 LP, 좌우 미세 위상차. */
function pad(
  bus: Bus,
  startSec: number,
  durSec: number,
  midi: number,
  gain: number,
  cutoff: number,
  waves: 'saw' | 'tri',
) {
  const f = midiHz(midi);
  const n0 = Math.floor(startSec * SR);
  const n1 = Math.min(bus.l.length, Math.floor((startSec + durSec) * SR));
  const atk = Math.min(0.9, durSec * 0.3);
  const rel = Math.min(1.2, durSec * 0.35);
  const dets = [1, 1.0025, 0.9975]; // 디튠 3 osc
  const a = lpA(cutoff);
  let lpL = 0;
  let lpR = 0;
  for (let n = n0; n < n1; n++) {
    const t = n / SR - startSec;
    const env = t < atk ? t / atk : t > durSec - rel ? Math.max(0, (durSec - t) / rel) : 1;
    let x = 0;
    for (let d = 0; d < 3; d++) {
      const ph = f * dets[d]! * (n / SR);
      const frac = ph - Math.floor(ph);
      x += waves === 'saw' ? 2 * frac - 1 : 4 * Math.abs(frac - 0.5) - 1;
    }
    x = (x / 3) * env * gain;
    // 좌우: 같은 신호를 위상차 없이 LP만 미세하게 달리 → 넓지만 모노 호환.
    lpL += a * (x - lpL);
    lpR += a * 1.04 * (x - lpR);
    bus.l[n]! += lpL;
    bus.r[n]! += lpR;
  }
}

/** 플럭/키 노트 — 빠른 어택 + exp 디케이. send에 딜레이 몫을 적립. */
function pluck(
  bus: Bus,
  send: Bus,
  startSec: number,
  midi: number,
  gain: number,
  tau: number,
  pan: number, // -1..1
  sendAmt = 0.35,
) {
  const f = midiHz(midi);
  const n0 = Math.floor(startSec * SR);
  const n1 = Math.min(bus.l.length, n0 + Math.floor(SR * tau * 6));
  const gl = gain * Math.SQRT1_2 * (1 - pan * 0.5);
  const gr = gain * Math.SQRT1_2 * (1 + pan * 0.5);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const env = Math.exp(-t / tau) * Math.min(1, t / 0.004);
    const ph = f * t;
    const frac = ph - Math.floor(ph);
    const x = (0.6 * (4 * Math.abs(frac - 0.5) - 1) + 0.4 * Math.sin(TAU * ph)) * env;
    bus.l[n]! += x * gl;
    bus.r[n]! += x * gr;
    send.l[n]! += x * gl * sendAmt;
    send.r[n]! += x * gr * sendAmt;
  }
}

/** 벨/스파클 — 배음 사인 + 긴 디케이(딜레이 듬뿍). */
function bell(bus: Bus, send: Bus, startSec: number, midi: number, gain: number, pan: number) {
  const f = midiHz(midi);
  const n0 = Math.floor(startSec * SR);
  const n1 = Math.min(bus.l.length, n0 + Math.floor(SR * 3));
  const gl = gain * (1 - pan * 0.5);
  const gr = gain * (1 + pan * 0.5);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const env = Math.exp(-t / 0.9) * Math.min(1, t / 0.003);
    const x =
      (Math.sin(TAU * f * t) +
        0.35 * Math.sin(TAU * f * 2.01 * t) +
        0.15 * Math.sin(TAU * f * 3 * t)) *
      env;
    bus.l[n]! += x * gl;
    bus.r[n]! += x * gr;
    send.l[n]! += x * gl * 0.5;
    send.r[n]! += x * gr * 0.5;
  }
}

/** 베이스 — 사인 + 미세 배음, 짧은 릴리즈. */
function bass(bus: Bus, startSec: number, durSec: number, midi: number, gain: number) {
  const f = midiHz(midi);
  const n0 = Math.floor(startSec * SR);
  const n1 = Math.min(bus.l.length, Math.floor((startSec + durSec) * SR));
  for (let n = n0; n < n1; n++) {
    const t = n / SR - startSec;
    const env = Math.min(1, t / 0.01) * (t > durSec - 0.05 ? Math.max(0, (durSec - t) / 0.05) : 1);
    const x = (Math.sin(TAU * f * t) + 0.12 * Math.sin(TAU * f * 2 * t)) * env * gain;
    bus.l[n]! += x;
    bus.r[n]! += x;
  }
}

/** 킥 — 사인 피치 드랍 + 클릭. */
function kick(bus: Bus, startSec: number, gain: number, rnd: () => number) {
  const n0 = Math.floor(startSec * SR);
  const n1 = Math.min(bus.l.length, n0 + Math.floor(SR * 0.28));
  let phase = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const f = 46 + 105 * Math.exp(-t * 32);
    phase += f / SR;
    const body = Math.sin(TAU * phase) * Math.exp(-t * 16);
    const click = (rnd() * 2 - 1) * Math.exp(-t * 350) * 0.4;
    const x = (body + click) * gain;
    bus.l[n]! += x;
    bus.r[n]! += x;
  }
}

/** 햇 — 노이즈 + 디퍼런시에이터(고역 강조). */
function hat(bus: Bus, startSec: number, gain: number, rnd: () => number, open = false) {
  const n0 = Math.floor(startSec * SR);
  const dur = open ? 0.12 : 0.035;
  const n1 = Math.min(bus.l.length, n0 + Math.floor(SR * dur));
  let prev = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const w = rnd() * 2 - 1;
    const hp = w - prev; // 1차 차분 = 하이패스 성격
    prev = w;
    const x = hp * Math.exp(-t / (dur * 0.4)) * gain;
    bus.l[n]! += x * 0.85;
    bus.r[n]! += x * 1.15;
  }
}

/** 클랩 — 3중 노이즈 버스트. */
function clap(bus: Bus, startSec: number, gain: number, rnd: () => number) {
  for (const [k, off] of [0, 0.012, 0.026].entries()) {
    const n0 = Math.floor((startSec + off) * SR);
    const n1 = Math.min(bus.l.length, n0 + Math.floor(SR * (k === 2 ? 0.13 : 0.02)));
    let prev = 0;
    for (let n = n0; n < n1; n++) {
      const t = (n - n0) / SR;
      const w = rnd() * 2 - 1;
      const bp = (w - prev) * 0.7 + w * 0.3;
      prev = w;
      const x = bp * Math.exp(-t / 0.045) * gain * (k === 2 ? 1 : 0.7);
      bus.l[n]! += x * 1.1;
      bus.r[n]! += x * 0.9;
    }
  }
}

/** 핑퐁 딜레이 — send 버스를 처리해 master에 합류. */
function pingpong(master: Bus, send: Bus, delaySec: number, feedback: number, mix: number) {
  const d = Math.floor(delaySec * SR);
  const n = master.l.length;
  const dl = new Float64Array(n);
  const dr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const inL = send.l[i]! + (i >= d ? dr[i - d]! * feedback : 0);
    const inR = send.r[i]! + (i >= d ? dl[i - d]! * feedback : 0);
    dl[i] = inL;
    dr[i] = inR;
    master.l[i]! += (i >= d ? dr[i - d]! : 0) * mix;
    master.r[i]! += (i >= d ? dl[i - d]! : 0) * mix;
  }
}

// ── 무드 정의 ──
interface Mood {
  id: string;
  title: string;
  bpm: number; // 0 = 무박자(앰비언트)
  bars: number;
  seed: number;
  desc: string;
  pairsWithBroll: string[];
  build: (bus: Bus, send: Bus, ctx: MoodCtx) => void;
}
interface MoodCtx {
  rnd: () => number;
  beat: number; // 초
  bar: number; // 초
  total: number; // 초
}

// 코드(midi[]) — 낮은 성부는 bass 전용이라 패드는 C3~ 위주 보이싱.
const MOODS: Mood[] = [
  {
    id: 'dawn-lofi',
    title: '새벽 로파이',
    bpm: 72,
    bars: 8,
    seed: 11,
    desc: '따뜻한 maj7 패드 + 소프트 플럭 — 차분한 제품/브이로그',
    pairsWithBroll: ['bokeh-dawn', 'sunset-flow'],
    build(bus, send, { rnd, beat, bar, total }) {
      const prog = [
        { pad: [50, 57, 60, 65], bass: 38 }, // Dm7
        { pad: [43, 53, 59, 62], bass: 43 }, // G9
        { pad: [48, 52, 59, 64], bass: 36 }, // Cmaj7
        { pad: [45, 52, 55, 60], bass: 45 }, // Am7
      ];
      for (let b = 0; b < 8; b++) {
        const ch = prog[b % 4]!;
        const t0 = b * bar;
        for (const m of ch.pad) pad(bus, t0, bar * 1.05, m, 0.05, 900, 'tri');
        bass(bus, t0, bar * 0.95, ch.bass, 0.16);
        // 스윙 8분 아르페지오(성기게)
        for (let e = 0; e < 8; e++) {
          if (rnd() < 0.45) continue;
          const swing = e % 2 === 1 ? beat * 0.08 : 0;
          const note = ch.pad[Math.floor(rnd() * ch.pad.length)]! + 12;
          pluck(bus, send, t0 + e * beat * 0.5 + swing, note, 0.07, 0.22, rnd() * 1.2 - 0.6);
        }
        for (let e = 0; e < 4; e++) hat(bus, t0 + e * beat + beat * 0.5, 0.05, rnd);
      }
      pingpong(bus, send, beat * 0.75, 0.32, 0.3);
      void total;
    },
  },
  {
    id: 'mint-ambient',
    title: '민트 앰비언트',
    bpm: 0,
    bars: 4,
    seed: 22,
    desc: '에어리 패드 + 슬로우 벨(무드럼) — 잔잔한 인트로/설명',
    pairsWithBroll: ['mint-flow', 'bokeh-ocean'],
    build(bus, send, { rnd, total }) {
      const prog = [
        [50, 54, 61, 66], // Dmaj7
        [47, 54, 57, 62], // Bm7
        [43, 50, 59, 66], // Gmaj7(9)
        [45, 52, 61, 64], // Aadd9
      ];
      const seg = total / 4;
      prog.forEach((ch, i) => {
        for (const m of ch) pad(bus, i * seg, seg * 1.15, m, 0.055, 700, 'tri');
        bass(bus, i * seg, seg, ch[0]! - 12, 0.1);
      });
      const pent = [66, 69, 71, 74, 78];
      let t = 1.2;
      while (t < total - 2) {
        bell(bus, send, t, pent[Math.floor(rnd() * pent.length)]!, 0.05, rnd() * 1.4 - 0.7);
        t += 1.6 + rnd() * 2.2;
      }
      pingpong(bus, send, 0.42, 0.45, 0.35);
    },
  },
  {
    id: 'sunset-keys',
    title: '노을 키즈',
    bpm: 84,
    bars: 8,
    seed: 33,
    desc: '멜로우 EP 코드 — 감성 회고/스토리',
    pairsWithBroll: ['sunset-flow', 'bokeh-dawn'],
    build(bus, send, { rnd, beat, bar }) {
      const prog = [
        { pad: [51, 55, 58, 62], bass: 39 }, // Ebmaj7
        { pad: [48, 51, 58, 63], bass: 36 }, // Cm7(9)
        { pad: [44, 51, 55, 60], bass: 44 }, // Abmaj7
        { pad: [46, 53, 56, 60], bass: 46 }, // Bb7sus
      ];
      for (let b = 0; b < 8; b++) {
        const ch = prog[b % 4]!;
        const t0 = b * bar;
        // EP 스타일: 1박·3.5박 스탭(패드 짧게) + 잔향
        for (const stab of [0, beat * 2.5]) {
          for (const m of ch.pad)
            pluck(bus, send, t0 + stab, m, 0.055, 0.55, (m % 7) / 7 - 0.5, 0.25);
        }
        bass(bus, t0, bar * 0.9, ch.bass, 0.15);
        for (let e = 0; e < 8; e++) if (e % 2 === 1) hat(bus, t0 + e * beat * 0.5, 0.04, rnd);
      }
      pingpong(bus, send, beat * 0.5, 0.3, 0.28);
    },
  },
  {
    id: 'stars-dream',
    title: '별밤 드림',
    bpm: 66,
    bars: 8,
    seed: 44,
    desc: '드리미 패드 + 스파클 — 몽환/밤 감성',
    pairsWithBroll: ['stars-night', 'aurora-flow'],
    build(bus, send, { rnd, bar }) {
      const prog = [
        { pad: [45, 52, 55, 64], bass: 33 }, // Am9
        { pad: [41, 48, 57, 60], bass: 41 }, // Fmaj7
        { pad: [48, 55, 59, 64], bass: 36 }, // Cmaj7
        { pad: [43, 50, 55, 62], bass: 43 }, // G6(9)
      ];
      for (let b = 0; b < 8; b++) {
        const ch = prog[b % 4]!;
        const t0 = b * bar;
        for (const m of ch.pad) pad(bus, t0, bar * 1.1, m, 0.05, 650, 'saw');
        bass(bus, t0, bar, ch.bass + 12, 0.11);
        if (rnd() < 0.85)
          bell(
            bus,
            send,
            t0 + rnd() * bar * 0.6,
            [76, 79, 81, 84][Math.floor(rnd() * 4)]!,
            0.045,
            rnd() - 0.5,
          );
      }
      pingpong(bus, send, 0.5, 0.5, 0.4);
    },
  },
  {
    id: 'aurora-synth',
    title: '오로라 신스',
    bpm: 96,
    bars: 8,
    seed: 55,
    desc: '라이트 신스웨이브 — 테크/앱 소개',
    pairsWithBroll: ['aurora-flow', 'stars-night'],
    build(bus, send, { rnd, beat, bar }) {
      const prog = [
        { pad: [45, 52, 57, 60], bass: 33 }, // Am
        { pad: [41, 48, 53, 57], bass: 41 }, // F
        { pad: [48, 55, 60, 64], bass: 36 }, // C
        { pad: [43, 50, 55, 59], bass: 43 }, // G
      ];
      for (let b = 0; b < 8; b++) {
        const ch = prog[b % 4]!;
        const t0 = b * bar;
        for (const m of ch.pad) pad(bus, t0, bar * 1.02, m, 0.042, 1500, 'saw');
        // 펄스 베이스 8분
        for (let e = 0; e < 8; e++) bass(bus, t0 + e * beat * 0.5, beat * 0.38, ch.bass, 0.13);
        for (let e = 0; e < 8; e++) if (e % 2 === 1) hat(bus, t0 + e * beat * 0.5, 0.045, rnd);
        if (b % 2 === 1 && rnd() < 0.8)
          pluck(bus, send, t0 + beat * 3, ch.pad[2]! + 12, 0.06, 0.3, 0.4);
      }
      pingpong(bus, send, beat * 0.375, 0.35, 0.3);
    },
  },
  {
    id: 'uplift-pop',
    title: '업리프트 팝',
    bpm: 112,
    bars: 12,
    seed: 66,
    desc: '밝은 업비트(킥/클랩) — 런칭·CTA·바이럴 훅',
    pairsWithBroll: ['bokeh-dawn', 'mint-flow'],
    build(bus, send, { rnd, beat, bar }) {
      const prog = [
        { pad: [48, 55, 60, 64], bass: 36 }, // C
        { pad: [43, 50, 55, 62], bass: 43 }, // G
        { pad: [45, 52, 57, 60], bass: 45 }, // Am
        { pad: [41, 48, 53, 60], bass: 41 }, // F
      ];
      const rhythm = [1, 0, 1, 1, 0, 1, 0, 1]; // 8분 플럭 코드 리듬
      for (let b = 0; b < 12; b++) {
        const ch = prog[b % 4]!;
        const t0 = b * bar;
        for (let e = 0; e < 8; e++) {
          if (!rhythm[e]) continue;
          for (const m of ch.pad)
            pluck(bus, send, t0 + e * beat * 0.5, m + 12, 0.035, 0.16, (m % 5) / 5 - 0.4, 0.2);
        }
        for (let e = 0; e < 8; e++) bass(bus, t0 + e * beat * 0.5, beat * 0.4, ch.bass, 0.14);
        for (let k = 0; k < 4; k++) kick(bus, t0 + k * beat, 0.5, rnd);
        clap(bus, t0 + beat, 0.16, rnd);
        clap(bus, t0 + beat * 3, 0.16, rnd);
        for (let e = 0; e < 8; e++) if (e % 2 === 1) hat(bus, t0 + e * beat * 0.5, 0.05, rnd);
      }
      pingpong(bus, send, beat * 0.75, 0.25, 0.22);
    },
  },
];

// ── 렌더 → 루프 접기 → 노멀라이즈 → wav → m4a ──
function renderMood(mood: Mood): { pcm: Int16Array; durationSec: number } {
  const beat = mood.bpm > 0 ? 60 / mood.bpm : 0;
  const bar = mood.bpm > 0 ? beat * 4 : 7;
  const total = mood.bpm > 0 ? mood.bars * bar : mood.bars * 7;
  const tail = 2.0;
  const n = Math.floor(total * SR);
  const bus = new Bus(n + Math.floor(tail * SR));
  const send = new Bus(bus.l.length);
  mood.build(bus, send, { rnd: rng(mood.seed), beat, bar, total });
  // 루프 클린: 본편 밖 꼬리를 머리에 접는다(딜레이/릴리즈 잔향이 루프 이음새를 메움).
  for (let i = 0; i < bus.l.length - n; i++) {
    bus.l[i]! += bus.l[n + i];
    bus.r[i]! += bus.r[n + i];
  }
  // 피크 노멀라이즈(-1.2dBFS≈0.87) + 소프트 리미터.
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const m = Math.max(Math.abs(bus.l[i]!), Math.abs(bus.r[i]!));
    if (m > peak) peak = m;
  }
  const g = 0.87 / peak;
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.tanh(bus.l[i]! * g * 1.1) * 0.95;
    const r = Math.tanh(bus.r[i]! * g * 1.1) * 0.95;
    pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
    pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
  }
  return { pcm, durationSec: total };
}

function writeWav(path: string, pcm: Int16Array) {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataLen).copy(buf, 44);
  writeFileSync(path, buf);
}

const catalog: Array<{
  id: string;
  title: string;
  desc: string;
  bpm: number;
  durationSec: number;
  loopable: boolean;
  pairsWithBroll: string[];
}> = [];

for (const mood of MOODS) {
  const { pcm, durationSec } = renderMood(mood);
  const wav = join(tmpdir(), `dawn-bgm-${mood.id}.wav`);
  writeWav(wav, pcm);
  const out = join(OUT_DIR, `${mood.id}.m4a`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    wav,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    out,
  ]);
  catalog.push({
    id: mood.id,
    title: mood.title,
    desc: mood.desc,
    bpm: mood.bpm,
    durationSec: Math.round(durationSec * 100) / 100,
    loopable: true,
    pairsWithBroll: mood.pairsWithBroll,
  });
  console.log(
    `✅ ${mood.id}.m4a — ${durationSec.toFixed(1)}s ${mood.bpm ? `${mood.bpm}bpm` : 'ambient'}`,
  );
}
writeFileSync(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`📦 assets/bgm — ${catalog.length}무드 + catalog.json`);
