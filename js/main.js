/* ═══════════════════════════════════════════════════════════
   VINYL SESSION — 主逻辑（模板）
   进场 → 播放 → 动效 → 结尾
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── 0. 渲染模式（运行时来自 @motion/web-kit 的 vendor 副本 js/lib/web-kit.js）─
   由 scripts/render-html.mjs 通过 addInitScript 注入 window.__RENDER_MODE__。
   此时时间轴由 window.renderAt(t) 驱动，音频能量来自离线预计算的 window.ENERGY，
   逐帧可复现（不再依赖 rAF / AudioContext / 无种子随机）。 */
const MK = globalThis.MotionKit;
const RENDER = MK.renderRuntime.RENDER;
const nowSec = MK.renderRuntime.nowSec;
const rnd = MK.math.rnd;
const OUTRO_TAIL = 2.0;        // 正片结束后留多少秒给致谢卡

/* ── 1. 歌词数据（LRC） ─────────────────────────────────── */
const LRC_TEXT = `
[00:15.74]你走后的夜特别长
[00:19.70]屋里还留着你的香
[00:23.66]我数着更漏到天亮
[00:27.56]没有人回答
[00:31.56]如果那天回过头
[00:34.70]是不是你不会走
[00:38.06]雪落下来覆盖了所有
[00:44.97]没说出口的挽留
[00:51.88]一滴红落在雪里
[00:57.05]像你最后那次挥手
[01:02.21]茶还温着人已远行
[01:07.38]影子在墙上倾斜
[01:11.38]重逢排练了一百遍
[01:13.64]只剩独白的声音
[01:18.38]如果时光肯停留
[01:21.32]是不是你不会走
[01:24.64]雪落下来覆盖了所有
[01:31.57]没说出口的挽留
[01:38.50]一滴红落在雪里
[01:42.98]像你最后那次挥手
[01:47.46]若有来生早点告诉我
[01:50.38]别让我等到白发
[01:54.04]把未说完的话都交给雪
[01:57.70]它会替我记得她
[02:04.02]雪落下来覆盖了所有
[02:10.95]没说出口的挽留
[02:17.88]一滴红落在雪里
[02:21.46]像你最后那次挥手
[02:25.04]雪又落下来覆盖了所有
[02:32.26]没说出口的挽留还在吗
[02:39.48]一滴红落在雪里
[02:42.08]像你最后那次挥手
`;

/* 段落标记（标签 + 视觉强度）已移至 config.js 的 sections，留空则不启用 */

/* ── 2. 工具 ───────────────────────────────────────────── */
const $  = (s) => document.querySelector(s);
const clamp = MK.math.clamp;
const damp  = MK.math.damp;
const TAU = MK.math.TAU;

/* 歌词解析来自 vendored web-kit（A2 格式见 research/README.md） */
const parseWordLRC = MK.lyrics.parseWordLRC;

/* 歌词与段落都由 config.js 决定（见文件底部 init） */
let LINES = [];
let SECTIONS = [];
const LRC_FALLBACK = LRC_TEXT;

function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0');
}
/* 当前音轨时长：metadata 未到前用 config 里声明的 duration */
function trackDur() { return audio.duration || S.durFallback || 213; }

/* ── 3. DOM ────────────────────────────────────────────── */
const body      = document.body;
const audio     = $('#audio');
const bgImg     = $('#bgImg');
const bgShade   = $('.bg__shade');
const bgGlow    = $('#bgGlow');
const disc      = $('#disc');
const coverImgs = Array.from(document.querySelectorAll('.tt__sleeve img, .tt__label img'));
const sleeveEl  = $('.tt__sleeve');
const glowEl    = $('#discGlow');
const waterLite = $('.tt__waterlight');
const bgImgRefl = $('#bgImgRefl');
const spectrum  = $('#spectrum');
const sctx      = spectrum.getContext('2d');
const fxCv      = $('#fx');
const fctx      = fxCv.getContext('2d');
const lyTrack   = $('#lyTrack');
const lyBreak   = $('#lyBreak');
let   rollCleanupAt = -1, outroTimer = 0, audioUrl = '';
const eqBars    = Array.from(document.querySelectorAll('.panel__eq i'));
const track     = $('#track');
const progFill  = $('#progFill');
const progHead  = $('#progHead');
const tCur      = $('#tCur');
const tTot      = $('#tTot');
const intro     = $('#intro');
const outro     = $('#outro');
const notice    = $('#notice');
const filePick  = $('#filePick');

/* ── 4. 唱盘几何（盒内比例） ─────────────────────────────
   唱片静止时藏在圆角盒中，播放时向右抽出 slideDist。
   频谱画布外扩 10%（120%），坐标需换算。 */
const GEO = {
  cx: 0.40, cy: 0.50,        // 唱片静止中心（大半藏在盒后）
  discR: 0.21,               // 唱片半径
  slideDist: 0.15,           // 播放时向外抽出（最终约 55% 露出）
  pad: 0.16, cscale: 1.32,   // 频谱画布：inset -16%（给环绕 EQ 留空间）
};
const discBoxX = (s) => GEO.cx + s * GEO.slideDist;
/* 竖屏：唱片与方盒同心（不做桌面那种向右抽出） */
const mqPortrait = window.matchMedia('(max-width: 1080px)');
let isPortrait = mqPortrait.matches;
mqPortrait.addEventListener('change', (e) => { isPortrait = e.matches; resize(); });

/* ── 5. 状态 ───────────────────────────────────────────── */
const S = {
  playing: false,
  started: false,
  ended: false,
  rot: 0,          // 唱盘角度
  spin: 0,         // 角速度 deg/s
  slide: 0,        // 唱片抽出量 0..1
  grow: 0,         // 竖屏：唱片展开度（开始播放后不再缩回）
  discRBox: 0.21,  // 唱片半径（占方盒宽的比例，resize 时按实际尺寸测）
  discScale: 1,    // 唱片当前缩放（竖屏展开动画）
  themeMix: 0,     // 环境粒子主题混合：0=墨(餘燼) 1=嵐(氣泡)
  ambientTarget: 0,
  curIdx: -1,
  lastBreak: false,
  karaokeIdx: -1,
  curChars: [],
  level: 0,        // 整体能量 0..1
  bass: 0, bassSlow: .6, prevBass: 0,
  mid: 0,          // 中频：餘燼閃爍／氣泡上升速度靠它驅動，缺失會讓坐標變 NaN
  high: 0, highSlow: .25,
  beat: 0,         // 节拍脉冲 0..1
  lastBeat: 0,
  bpm: 0,          // 曲目声明的 BPM；>0 时按网格踩点，否则退回 onset 检测
  beatPhase: 0,    // 网格相位（秒）
  lastBeatIdx: -1, // 上次触发的拍号（防止重复触发）
  fxLevel: .55,
  durFallback: 213, // 当前曲目声明的时长；metadata 到达前用它显示总时长
  theme: 'sumi',
  mode: 'graph',   // graph = 实时声谱；plain = 直开模式（合成可视化）
  section: '',
  W: 0, H: 0, dpr: 1,
  /* 调试面板：粒子数量 / 尺寸 / 速度 / 形态（仅交互模式，渲染模式不读） */
  ptN: 1, ptS: 1, ptV: 1, ptShape: 'auto',
};

const PLAY_SPEED = 360 / 1.85;   // ≈33⅓ rpm 的视觉速度

/* 主题色（供 canvas 使用） */
let ACC = [226, 58, 75], ACC2 = [255, 122, 106];
function readAccent() {
  const rd = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    const r = v.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
    if (r) return [+r[1], +r[2], +r[3]];
    return fallback;
  };
  ACC  = rd('--accent', ACC);
  ACC2 = rd('--accent-hi', ACC);
}
const rgba  = (a) => `rgba(${ACC[0]},${ACC[1]},${ACC[2]},${a})`;
const rgbaC = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ── 6. 音频图 ─────────────────────────────────────────── */
let actx = null, analyser = null, freqData = null;

function ensureAudio() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { setMode('plain'); return; }
  /* file:// 直开时，media 元素被视为跨域，MediaElementSource 只会输出零。
     此时退化为「直开模式」：声音照常，可视化由合成能量驱动。 */
  const isBlob = (audio.src || '').indexOf('blob:') === 0;
  if (location.protocol === 'file:' && !isBlob) { setMode('plain'); return; }
  try {
    actx = new AC();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    setMode('graph');
  } catch (e) {
    setMode('plain');
  }
}

function setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  notice.hidden = mode !== 'plain';
}

/* ── 7. 尺寸 ───────────────────────────────────────────── */
function resize() {
  S.dpr = Math.min(window.devicePixelRatio || 1, 2);
  S.W = window.innerWidth; S.H = window.innerHeight;
  fxCv.width = Math.floor(S.W * S.dpr); fxCv.height = Math.floor(S.H * S.dpr);
  fxCv.style.width = S.W + 'px'; fxCv.style.height = S.H + 'px';
  /* 位图按 canvas 自身的 CSS 尺寸来（它是 inset:-12% 的 124%，不是 platter 的 100%） */
  const sr = spectrum.getBoundingClientRect();
  if (sr.width) {
    spectrum.width = Math.floor(sr.width * S.dpr);
    spectrum.height = Math.floor(sr.height * S.dpr);
  }
  /* 唱片半径（盒宽比例）：桌面 42%、竖屏 78%，随样式自动跟随 */
  const bwEl = document.querySelector('.deck__box');
  const dw = parseFloat(getComputedStyle(disc).width);
  const bw = bwEl ? parseFloat(getComputedStyle(bwEl).width) : 0;
  if (bw) S.discRBox = (dw / bw) / 2;
}
window.addEventListener('resize', resize);
/* 唱机进场有 scale 过渡，过渡结束后位图要按最终尺寸重量 */
$('#deckBox').addEventListener('transitionend', resize);

/* ── 8. 歌词引擎 ───────────────────────────────────────── */
function idxAt(t) {
  let lo = 0, hi = LINES.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (LINES[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
function nearestText(i, dir) {
  for (let k = i + dir; k >= 0 && k < LINES.length; k += dir) if (LINES[k].text) return k;
  return -1;
}
/* 一句人声的结束时刻：有逐字数据就取最后一个字，否则按行内占比估算。
   用来判断「这句真的唱完了」——长句后半段不能被当成间奏。 */
function vocalEndTime(L, span) {
  if (L.chars && L.chars.length) return L.chars[L.chars.length - 1].t + .5;
  return L.t + Math.min(span * .72, 4.5);
}
/* 滚动轨道：三行固定高度，每次前进把轨道上移一格，
   旧当前行自然退成上一行、旧下一行自然升为当前行 —— 无闪断。 */
function setRow(el, line, role) {
  el.className = 'lyrics__line lyrics__line--' + role;
  el.style.visibility = '';
  if (role === 'cur') { buildCur(el, line); return; }
  el.textContent = line && line.text ? line.text : '';
}
function buildCur(el, line) {
  el.innerHTML = '';
  S.curChars = [];
  if (!line || !line.text) return;
  const chars = line.chars && line.chars.length ? line.chars : [{ t: line.t, ch: line.text }];
  chars.forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    s.textContent = c.ch;
    s.dataset.t = c.t;
    s.style.setProperty('--i', i);
    s.style.setProperty('--fill', '0%');
    el.appendChild(s);
    S.curChars.push(s);
  });
  S.karaokeIdx = -1;
}
function lyStep() {
  const a = lyTrack.children[0], b = lyTrack.children[1];
  return a && b ? b.offsetTop - a.offsetTop : 0;
}
/* 直接铺三行（首次渲染 / 大跳） */
function paintRows(i) {
  rollCleanupAt = -1;               // 取消未完成的滚动收拢，避免误删新铺的行
  const p = nearestText(i, -1), n = nearestText(i, 1);
  while (lyTrack.children.length < 3) {
    const d = document.createElement('div');
    d.className = 'lyrics__line';
    lyTrack.appendChild(d);
  }
  while (lyTrack.children.length > 3) lyTrack.removeChild(lyTrack.children[0]);
  const k = lyTrack.children;
  setRow(k[0], p >= 0 ? LINES[p] : null, 'prev');
  setRow(k[1], i >= 0 ? LINES[i] : null, 'cur');
  setRow(k[2], n >= 0 ? LINES[n] : null, 'next');
  lyTrack.style.transition = 'none';
  lyTrack.style.transform = 'translateY(0px)';
  void lyTrack.offsetHeight;
  lyTrack.style.transition = '';
}
/* 切轨/重播时清空：新歌词到位后旧行不能继续挂在屏幕上 */
function clearRows() {
  rollCleanupAt = -1;
  while (lyTrack.children.length < 3) {
    const d = document.createElement('div');
    d.className = 'lyrics__line';
    lyTrack.appendChild(d);
  }
  while (lyTrack.children.length > 3) lyTrack.removeChild(lyTrack.children[0]);
  const k = lyTrack.children;
  setRow(k[0], null, 'prev');
  setRow(k[1], null, 'cur');
  setRow(k[2], null, 'next');
  lyTrack.style.transition = 'none';
  lyTrack.style.transform = 'translateY(0px)';
  void lyTrack.offsetHeight;
  lyTrack.style.transition = '';
  S.curIdx = -1;
}
/* 前进一格：追加新下一行 → 轨道上移 → 收拢 */
function rollOne(i, prevIdx, t) {
  const k = lyTrack.children;
  if (k.length < 3) { paintRows(i); return; }
  const old = LINES[prevIdx];          // 旧当前行 → 退成上一行
  const cur = LINES[i];               // 旧下一行 → 升为当前行
  const nxt = LINES[nearestText(i, 1)];

  const d = document.createElement('div');
  setRow(d, nxt || null, 'next');
  lyTrack.appendChild(d);

  setRow(k[1], old, 'prev');   // 旧当前行退成上一行
  setRow(k[2], cur, 'cur');    // 旧下一行升为当前行

  const step = lyStep();
  lyTrack.style.transform = `translateY(${-step}px)`;

  /* 收拢走虚拟时钟（t + 0.68s）：渲染模式确定性，交互模式等效原 680ms 定时器 */
  rollCleanupAt = t + 0.68;
}
function updateLyrics(t) {
  const idx = idxAt(t);
  const L = idx >= 0 ? LINES[idx] : null;
  const nextT = (idx + 1 < LINES.length) ? LINES[idx + 1].t : (trackDur());
  const span = L ? nextT - L.t : 0;
  const hasLine = !!(L && L.text);
  /* 间奏卡：空行，或「本句已唱完 + 距下一句还有长静默」。
     旧判据在 span 略大于 6s 时会在一句唱到 60% 就触发，长句后半段被误判成间奏。 */
  const vEnd = L ? vocalEndTime(L, span) : 0;
  const isBreak = !!(L && (!L.text || (t >= vEnd && nextT - vEnd > 4)));

  if (idx !== S.curIdx) {
    const prevIdx = S.curIdx;
    const jump = prevIdx < 0 || Math.abs(idx - prevIdx) > 1;
    S.curIdx = idx;
    if (jump) paintRows(idx);
    else rollOne(idx, prevIdx, t);
    /* 直开模式下用句首作为节拍脉冲（只在换行时触发，别每帧生成粒子） */
    if (S.mode === 'plain' && S.playing && hasLine && !isBreak) { S.beat = 1; spawnBurst(); }
  }
  if (S.lastBreak !== isBreak) {
    S.lastBreak = isBreak;
    lyBreak.classList.toggle('is-on', isBreak);
    const cur = lyTrack.children[1];
    if (cur) cur.style.visibility = isBreak ? 'hidden' : '';
  }

  /* 段落（只用于视觉强度与切换冲击，无 UI 标签） */
  const sec = SECTIONS.length ? SECTIONS.reduce((a, s) => (s.t <= t ? s : a), SECTIONS[0]) : null;
  if (sec) {
    if (S.section !== sec.label) {
      if (S.section && (S.playing || RENDER)) { S.beat = 1; spawnBurst(); }
      S.section = sec.label;
    }
    S.fxLevel = sec.fx;
  }

  if (hasLine && !isBreak) updateKaraoke(t);
}
function updateKaraoke(t) {
  const L = LINES[S.curIdx];
  if (!L || !L.text || !S.curChars.length) return;
  const n = S.curChars.length;
  /* 进度数学（逐字 + 句级均分回退）与 DOM 写入来自 @motion/web-kit */
  const lineEnd = (S.curIdx + 1 < LINES.length) ? LINES[S.curIdx + 1].t : (trackDur());
  for (let i = 0; i < n; i++) {
    MK.karaoke.applyFill(S.curChars[i], MK.karaoke.charFill(L, i, t, lineEnd, n));
  }
  S.karaokeIdx = -1;
}

/* ── 9. 可视化：环形频谱 ───────────────────────────────── */
/* 能量查询（离线表）与合成谱来自 @motion/web-kit */
const energyAt = MK.energy.energyAt;

function drawSpectrum(t) {
  const W = spectrum.width, H = spectrum.height;
  if (!W) return;
  sctx.clearRect(0, 0, W, H);
  if (RENDER && freqData) MK.energy.synthFreqData(t, freqData);
  const k = 1 / GEO.cscale;
  const cx = ((isPortrait ? 0.5 : discBoxX(S.slide)) + GEO.pad) * k * W;
  const cy = (GEO.cy + GEO.pad) * k * H;
  const R = S.discRBox * S.discScale * k * Math.min(W, H);
  const fade = 0.22 + 0.78 * S.slide;

  /* 底环 */
  sctx.beginPath();
  sctx.arc(cx, cy, R * 1.015, 0, TAU);
  sctx.strokeStyle = 'rgba(243,240,233,.09)';
  sctx.lineWidth = 1 * S.dpr;
  sctx.stroke();

  if (!RENDER && (!analyser || !S.playing)) {
    /* 静置 / 直开模式：缓慢流转的微光弧 */
    const a0 = (nowSec() * .45) % TAU;
    for (let k = 0; k < 2; k++) {
      const start = a0 + k * Math.PI;
      sctx.beginPath();
      sctx.arc(cx, cy, R * 1.015, start, start + .85);
      sctx.strokeStyle = rgba((k ? .16 : .3) * fade);
      sctx.lineWidth = (k ? 1 : 1.5) * S.dpr;
      sctx.stroke();
    }
    return;
  }
  /* freqData 由 tick 的能量段统一读取一次，这里不再重复读（避免消耗两次平滑） */

  /* 环绕 EQ（竖屏镜像）/ 盘沿频谱（桌面）绘制段来自 @motion/web-kit，几何在此注入 */
  MK.ringSpectrum.draw(sctx, { cx, cy, R, fade }, {
    freqData, portrait: isPortrait, t, fxLevel: S.fxLevel, rgba,
  });
}

/* ── 10. 粒子 / 涟漪 ───────────────────────────────────── */
const embers = [], bubbles = [], snowflakes = [], drips = [], bursts = [], ripples = [];
function seedAmbient() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  embers.length = 0; bubbles.length = 0; snowflakes.length = 0;
  const n = Math.round((reduced ? 26 : 84) * S.ptN);
  for (let i = 0; i < n; i++) embers.push({
    x: rnd(), y: rnd(), r: .6 + rnd() * 2.2,
    vy: .008 + rnd() * .03, ph: rnd() * 7, hue: rnd(),
  });
  const nb = Math.round((reduced ? 14 : 44) * S.ptN);
  for (let i = 0; i < nb; i++) bubbles.push({
    x: rnd(), y: rnd(), r: 1.5 + rnd() * 5,
    vy: .01 + rnd() * .035, ph: rnd() * 7,
  });
  /* 白：落雪（下沉 + 左右轻摆，比餘燼/氣泡都慢） */
  const ns = Math.round((reduced ? 30 : 130) * S.ptN);
  for (let i = 0; i < ns; i++) snowflakes.push({
    x: rnd(), y: rnd(), r: .8 + rnd() * 2.4,
    vy: .018 + rnd() * .05, sway: .004 + rnd() * .012,
    ph: rnd() * 7, a: .22 + rnd() * .5,
  });
}
/* 慢移光团：三团主题色环境光，缓慢漂移、随低音胀缩 */
function drawBlobs(t, k) {
  if (k <= .02) return;
  const W = fxCv.width, H = fxCv.height;
  const deep = [ACC[0] * .38, ACC[1] * .38, ACC[2] * .38];
  const cols = [ACC, ACC2, deep];
  const pos = [[.22, .30, .55], [.80, .68, .60], [.55, .15, .42]];
  fctx.globalCompositeOperation = 'screen';
  pos.forEach(([bx, by, br], i) => {
    const cx = (bx + Math.sin(t * .07 + i * 2.1) * .06) * W;
    const cy = (by + Math.cos(t * .05 + i * 1.7) * .07) * H;
    const rr = br * H * (1 + S.bass * .22);
    const g = fctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    const c = cols[i];
    g.addColorStop(0, rgbaC(c, .075 * k * (1 + S.bass * .7)));
    g.addColorStop(1, rgbaC(c, 0));
    fctx.fillStyle = g;
    fctx.beginPath(); fctx.arc(cx, cy, rr, 0, TAU); fctx.fill();
  });
  fctx.globalCompositeOperation = 'source-over';
}
/* 墨滴：夜面节拍时偶尔垂落一道 */
function drawDrips(dt, k) {
  const W = fxCv.width, H = fxCv.height, dpr = S.dpr;
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    d.y += d.v * dt;
    d.len = Math.min(.22, d.len + d.v * dt * .8);
    d.life -= dt * .45;
    if (d.life <= 0 || d.y > 1.1) { drips.splice(i, 1); continue; }
    const gx = d.x * W;
    const lg = fctx.createLinearGradient(gx, (d.y - d.len) * H, gx, d.y * H);
    lg.addColorStop(0, rgbaC(ACC, 0));
    lg.addColorStop(1, rgbaC(ACC, .4 * d.life * k));
    fctx.strokeStyle = lg;
    fctx.lineWidth = 1.4 * dpr;
    fctx.beginPath(); fctx.moveTo(gx, (d.y - d.len) * H); fctx.lineTo(gx, d.y * H); fctx.stroke();
    fctx.fillStyle = rgbaC(ACC, .5 * d.life * k);
    fctx.beginPath(); fctx.arc(gx, d.y * H, 1.8 * dpr, 0, TAU); fctx.fill();
  }
}
function spawnDrip() {
  if (S.themeMix > .5 || drips.length > 6 || rnd() > .6) return;
  drips.push({ x: .08 + rnd() * .84, y: -.05, len: 0, v: .25 + rnd() * .3, life: 1 });
}
/* 调试面板：粒子形态。auto 走各类型默认；dot / streak / star 统一形态 */
function ptShape(x, y, r, shape, fill, stroke, alpha, dir) {
  const c = fctx;
  c.globalAlpha = alpha;
  if (shape === 'streak') {
    c.strokeStyle = stroke || fill;
    c.lineWidth = Math.max(1, r * .45);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + dir * r * 4.5); c.stroke();
  } else if (shape === 'star') {
    c.strokeStyle = stroke || fill;
    c.lineWidth = Math.max(1, r * .32);
    c.beginPath();
    c.moveTo(x - r * 1.7, y); c.lineTo(x + r * 1.7, y);
    c.moveTo(x, y - r * 1.7); c.lineTo(x, y + r * 1.7);
    c.stroke();
  } else {
    c.fillStyle = fill;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
}
/* 墨：上升餘燼（三色，闪烁，随节拍胀缩） */
function drawEmbers(dt, t, k) {
  if (k <= .02) return;
  const W = fxCv.width, H = fxCv.height, dpr = S.dpr;
  const cols = [ACC, ACC2, [255, 210, 122]];
  fctx.globalCompositeOperation = 'lighter';
  for (const p of embers) {
    p.y -= p.vy * dt * (1 + S.mid * 2.4) * S.ptV;
    p.x += Math.sin(t * .6 + p.ph) * .00012 * (1 + S.mid);
    if (p.y < -.03) { p.y = 1.03; p.x = rnd(); }
    const tw = .25 + .55 * (.5 + .5 * Math.sin(t * 2.2 + p.ph * 3));
    const c = cols[p.hue < .55 ? 0 : (p.hue < .85 ? 1 : 2)];
    const col = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const rr = p.r * dpr * (1 + S.beat * .5) * S.ptS;
    const a = Math.min(1, tw * k * (.45 + S.level * 1.0));
    if (S.ptShape === 'auto') {
      fctx.globalAlpha = a;
      fctx.fillStyle = col;
      fctx.beginPath();
      fctx.arc(p.x * W, p.y * H, rr, 0, TAU);
      fctx.fill();
    } else {
      ptShape(p.x * W, p.y * H, rr, S.ptShape, col, col, a, -1);
    }
  }
  fctx.globalAlpha = 1;
  fctx.globalCompositeOperation = 'source-over';
}
/* 嵐：气泡（空心圆 + 高光弧，上升漂移） */
function drawBubbles(dt, t, k) {
  if (k <= .02) return;
  const W = fxCv.width, H = fxCv.height, dpr = S.dpr;
  for (const p of bubbles) {
    p.y -= p.vy * dt * (1 + S.mid * 1.6) * S.ptV;
    if (p.y < -.08) { p.y = 1.08; p.x = rnd(); }
    /* 往上飄要淡出、從底部上來要淡入，不能憑空消失 */
    const fade = clamp((p.y - .005) / .18, 0, 1) * clamp((1.08 - p.y) / .16, 0, 1);
    if (fade <= .01) continue;
    const bx = (p.x + Math.sin(t * .8 + p.ph) * .008) * W, by = p.y * H;
    const rr = p.r * dpr * S.ptS;
    if (S.ptShape !== 'auto') {
      const col = rgbaC(ACC, 1);
      ptShape(bx, by, rr, S.ptShape, col, col, k * fade, -1);
      continue;
    }
    fctx.strokeStyle = rgbaC(ACC, .26 * k * fade);
    fctx.lineWidth = dpr;
    fctx.beginPath(); fctx.arc(bx, by, rr, 0, TAU); fctx.stroke();
    fctx.strokeStyle = rgbaC(ACC2, .42 * k * fade);
    fctx.beginPath(); fctx.arc(bx, by, rr * .62, -2.4, -1.2); fctx.stroke();
  }
}
/* 白：落雪（白色实心小点，缓慢下沉 + 左右轻摆，底部淡出） */
function drawSnow(dt, t, k) {
  if (k <= .02) return;
  const W = fxCv.width, H = fxCv.height, dpr = S.dpr;
  fctx.globalCompositeOperation = 'lighter';
  for (const p of snowflakes) {
    p.y += p.vy * dt * (.8 + S.mid * 1.4) * S.ptV;
    if (p.y > 1.05) { p.y = -.05; p.x = rnd(); }
    const fade = clamp((1.05 - p.y) / .18, 0, 1) * clamp((p.y + .05) / .12, 0, 1);
    if (fade <= .01) continue;
    const x = (p.x + Math.sin(t * .7 + p.ph) * p.sway) * W;
    const rr = p.r * dpr * (.85 + S.beat * .25) * S.ptS;
    const a = Math.min(1, p.a * k * fade);
    if (S.ptShape === 'auto') {
      fctx.globalAlpha = a;
      fctx.fillStyle = '#f6f4ee';
      fctx.beginPath();
      fctx.arc(x, p.y * H, rr, 0, TAU);
      fctx.fill();
    } else {
      ptShape(x, p.y * H, rr, S.ptShape, '#f6f4ee', '#f6f4ee', a, 1);
    }
  }
  fctx.globalAlpha = 1;
  fctx.globalCompositeOperation = 'source-over';
}
function discScreen() {
  const r = disc.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
}
function spawnBurst() {
  const d = discScreen();
  for (let i = 0; i < 7; i++) {
    const a = rnd() * TAU, sp = 40 + rnd() * 120;
    bursts.push({
      x: d.x + Math.cos(a) * d.r * .96, y: d.y + Math.sin(a) * d.r * .96,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 18,
      life: 1, r: .7 + rnd() * 1.6,
    });
  }
  if (ripples.length < 3) ripples.push({ r: d.r * (1.0 + rnd() * .08), a: .62 });
}
function drawFx(dt, t) {
  const W = fxCv.width, H = fxCv.height;
  if (!W) return;
  fctx.clearRect(0, 0, W, H);
  const k = S.dpr;

  /* 背景：慢移光团 + 主題粒子。themeMix 0=墨(餘燼+墨滴) 1=嵐(氣泡) 2=白(落雪)，
     连续值在相邻主题间交叉淡入淡出 */
  const emberW   = clamp(1 - S.themeMix, 0, 1);
  const causticW = clamp(1 - Math.abs(S.themeMix - 1), 0, 1);
  const snowW    = clamp(S.themeMix - 1, 0, 1);
  drawBlobs(t, 1);
  drawDrips(dt, emberW);
  drawEmbers(dt, t, emberW);
  drawBubbles(dt, t, causticW);
  drawSnow(dt, t, snowW);

  /* 节拍涟漪 */
  const d = discScreen();
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.r += 105 * k * dt; r.a -= .42 * dt;
    if (r.a <= 0) { ripples.splice(i, 1); continue; }
    fctx.beginPath();
    fctx.arc(d.x * k, d.y * k, r.r * k, 0, TAU);
    fctx.strokeStyle = rgba(r.a * .75);
    fctx.lineWidth = 1.5 * k;
    fctx.stroke();
  }

  /* 节拍迸发 */
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 60 * dt; b.life -= 1.5 * dt;
    if (b.life <= 0) { bursts.splice(i, 1); continue; }
    fctx.beginPath();
    fctx.arc(b.x * k, b.y * k, b.r * k * b.life, 0, TAU);
    fctx.fillStyle = rgba(b.life * .55);
    fctx.fill();
  }
}

/* ── 11. 主循环 ────────────────────────────────────────── */
let lastT = performance.now();
function tick(now) {
  framePending = false;
  clearTimeout(rafWatch);
  const dt = Math.min(.05, (now - lastT) / 1000);
  lastT = now;
  update(now / 1000, dt, now);
  schedule();
}
/* 一帧的全部状态推进 + 绘制。渲染模式由 renderAt(t) 直接调用，
   交互模式由 tick 调用；t 为秒，now 为毫秒时间戳（判拍/动画用）。 */
/* 节拍网格：按曲目 BPM 规则踩点，强度取当前低频能量。
   没有 BPM 信息时返回 false，由调用方退回 onset 检测。 */
function beatGrid(t) {
  if (!S.bpm || S.bpm <= 0) return false;
  const period = 60 / S.bpm;
  const k = Math.floor((t - S.beatPhase) / period + 1e-6);
  if (k === S.lastBeatIdx) return false;
  S.lastBeatIdx = k;
  /* 每拍都有脉冲（保底 .15），强度随低频能量起伏；只有够强才放迸发粒子 */
  const strength = clamp((S.bass - .10) / .5, .15, 1);
  S.beat = Math.max(S.beat, strength);
  if (strength > .3) { spawnBurst(); spawnDrip(); }
  return true;
}

function update(t, dt, now) {
  const dur = trackDur();
  const ct = RENDER ? t : Math.min(audio.currentTime || 0, dur);

  /* 唱盘旋转（渲染模式视为一直在转） */
  const active = S.playing || RENDER;
  const targetSpin = active ? PLAY_SPEED : 0;
  S.spin = damp(S.spin, targetSpin, active ? 1.5 : .5, dt);
  if (Math.abs(S.spin) < .02 && !active) S.spin = 0;
  S.rot = (S.rot + S.spin * dt) % 360;

  /* 唱片半压在盒面上：播放时再向外抽出一点（最终约 40% 重叠，
     与参考图的静帧一致），停下/结束收回。 */
  S.slide = damp(S.slide, active ? 1 : 0, 1.7, dt);
  const dCx = isPortrait ? 0.5 : discBoxX(S.slide);
  const dLeft = (dCx * 100).toFixed(3) + '%';
  S.grow = damp(S.grow, S.started ? 1 : 0, 2.4, dt);
  const dScale = isPortrait ? (0.62 + 0.38 * S.grow) : 1;
  S.discScale = dScale;
  /* 节拍脉冲：盘体随低频轻微胀缩（transform 已有 scale，叠加一个脉动量） */
  const dPulse = 1 + S.beat * (isPortrait ? .045 : .062);
  const dTransform = `translate(-50%,-50%) rotate(${S.rot.toFixed(3)}deg) scale(${(dScale * dPulse).toFixed(4)})`;
  disc.style.left = dLeft;
  disc.style.transform = dTransform;
  glowEl.style.left = dLeft;
  waterLite.style.left = dLeft;
  waterLite.style.opacity = (S.slide * .5 + S.beat * .3).toFixed(3);

  /* 音频能量：渲染模式查离线表；交互模式走实时 analyser */
  if (RENDER && window.ENERGY) {
    const e = energyAt(t);
    S.bass = e.b; S.bassSlow = e.b;
    S.mid  = e.m; S.high = e.h; S.highSlow = e.h;
    S.level = clamp(e.m * 1.15, 0, 1);
    beatGrid(t);
    S.prevBass = e.b;
  } else if (analyser && S.playing) {
    analyser.getByteFrequencyData(freqData);
    let b = 0; for (let i = 0; i < 24; i++) b += freqData[i]; b /= 24 * 255;
    let m = 0; for (let i = 60; i < 240; i++) m += freqData[i]; m /= 180 * 255;
    let h = 0; for (let i = 240; i < 800; i++) h += freqData[i]; h /= 560 * 255;
    S.bass     = damp(S.bass, b, 26, dt);
    S.bassSlow = damp(S.bassSlow, b, 1.0, dt);
    S.mid      = damp(S.mid, m, 26, dt);
    S.high     = damp(S.high, h, 26, dt);
    S.highSlow = damp(S.highSlow, h, 1.0, dt);
    S.level    = damp(S.level, clamp(m * 1.15, 0, 1), 8, dt);

    /* 低频 onset：用「未平滑的原始低頻」对上一帧的抬升来判拍。
       平滑后的 S.bass 变化太小（实测 8 秒最大仅 .012），拿它当阈值会永不触发。
       有 BPM 信息时改用节拍网格（更稳、更踩点）。 */
    if (!beatGrid(t) && b - S.prevBass > .04 && b > .45 && now - S.lastBeat > 300) {
      S.lastBeat = now;
      S.beat = 1;
      spawnBurst();
      spawnDrip();
    }
    S.prevBass = b;
  } else if (S.playing) {
    /* 直开模式：无可用声谱，用歌曲时间合成呼吸感能量 */
    const ph = ct * .85;
    S.level = damp(S.level, .40 + .15 * Math.sin(ph) * Math.sin(ph * .41 + 1.2) + .10 * Math.sin(ph * 2.1), 5, dt);
    S.bass  = damp(S.bass, S.level, 6, dt);
    S.mid   = damp(S.mid, S.level * .9, 6, dt);
    S.high  = damp(S.high, .20 + .13 * Math.sin(ph * 1.7 + .6), 6, dt);
  } else {
    S.level = damp(S.level, 0, 3, dt);
    S.bass  = damp(S.bass, 0, 3, dt);
    S.mid   = damp(S.mid, 0, 3, dt);
    S.high  = damp(S.high, 0, 3, dt);
  }
  /* 脉冲包络：衰减放慢到 ~0.4s，肉眼才跟得上（原 4.2 只剩一闪） */
  S.beat = Math.max(0, S.beat - dt * 2.6);
  S.themeMix = damp(S.themeMix, S.ambientTarget || 0, 2.6, dt);

  /* 背景：剪映式「左右摇摆」，低强度（约 ±0.9°），周期 7.5s */
  const ts = now / 1000;
  const sway = Math.sin(ts * TAU / 7.5) * .9;
  const swayX = Math.sin(ts * TAU / 7.5 + .7) * 8;
  const bgTf = `translate(${swayX.toFixed(2)}px, 0px) rotate(${sway.toFixed(3)}deg) scale(${(1 + S.level * .008).toFixed(4)})`;
  bgImg.style.transform = bgTf;
  if (bgImgRefl) bgImgRefl.style.transform = bgTf;
  /* 背景只随整体能量缓慢呼吸；不跟节拍跳变（逐拍瞬变看起来就是"整屏在闪"） */
  bgShade.style.opacity = (1 - S.level * .06).toFixed(3);
  bgGlow.style.opacity = (.40 + S.level * .45).toFixed(3);
  bgGlow.style.transform = `translate(${(-swayX * 1.7).toFixed(2)}px, 0px) scale(${(1 + S.level * .06).toFixed(4)})`;

  /* 唱片光晕：亮度 + 半径都随脉冲涨落 */
  const glow = clamp(S.level * 1.0 + S.beat * 1.2, 0, 1) * (0.42 + S.fxLevel * .58);
  glowEl.style.opacity = glow.toFixed(3);
  glowEl.style.transform = `translate(-50%,-50%) scale(${(1 + S.beat * .4).toFixed(3)})`;

  /* 面板电平表 */
  if (eqBars.length) {
    const v = active ? 1 : 0;
    eqBars[0].style.transform = `scaleY(${(.22 + S.level * .78 * v).toFixed(3)})`;
    eqBars[1].style.transform = `scaleY(${(.22 + clamp(S.level * 1.25 + S.beat * .3, 0, 1) * .78 * v).toFixed(3)})`;
    eqBars[2].style.transform = `scaleY(${(.22 + S.high * 1.5 * .78 * v).toFixed(3)})`;
  }

  /* 歌词 */
  updateLyrics(ct);
  /* 滚动收拢：虚拟时间驱动（渲染模式确定性；交互模式等效 680ms） */
  if (rollCleanupAt >= 0 && ct >= rollCleanupAt) {
    rollCleanupAt = -1;
    lyTrack.style.transition = 'none';
    lyTrack.removeChild(lyTrack.children[0]);
    lyTrack.style.transform = 'translateY(0px)';
    void lyTrack.offsetHeight;
    lyTrack.style.transition = '';
  }

  /* 进度 */
  const p = dur > 0 ? clamp(ct / dur, 0, 1) : 0;
  progFill.style.width = (p * 100).toFixed(2) + '%';
  progHead.style.left = (p * 100).toFixed(2) + '%';
  track.style.setProperty('--p', (p * 100).toFixed(2) + '%');
  track.setAttribute('aria-valuenow', Math.round(p * 100));
  tCur.textContent = fmtTime(ct);

  /* 渲染模式：正片结束后亮致谢卡（交互模式由 audio ended 事件触发） */
  if (RENDER && !S.ended && t >= dur + 1.4) {
    S.ended = true;
    outro.classList.add('is-on');
  }

  drawSpectrum(t);
  drawFx(dt, t);
}

/* 帧调度：优先 rAF；若宿主（内嵌 webview / 后台标签）挂起 rAF，
   则用看门狗切换到定时器，保证动画不中断。 */
let rafHealthy = true, framePending = false, rafWatch = 0, rafStamp = 0;
/* 后台标签 rAF 被节流不等于挂起：回到前台必须恢复 rAF */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) rafHealthy = true;
});
function schedule() {
  if (framePending) return;
  framePending = true;
  if (rafHealthy) {
    rafStamp = performance.now();
    requestAnimationFrame(tick);
    clearTimeout(rafWatch);
    rafWatch = setTimeout(() => {
      if (!document.hidden && framePending && performance.now() - rafStamp > 600) {
        rafHealthy = false; framePending = false; schedule();
      }
    }, 700);
  } else {
    setTimeout(() => tick(performance.now()), 16);
  }
}

/* ── 12. 播放控制 ──────────────────────────────────────── */
function revealStage() {
  if (S.started) return;
  S.started = true;
  intro.classList.add('is-leaving');
  body.classList.add('is-live');
}
function startPlayback() {
  revealStage();
  ensureAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  /* 起拍前稍作延迟，形成「落针」般的仪式感 */
  setTimeout(() => {
    audio.play().catch(() => { $('#fallback').hidden = false; });
  }, 620);
}
function togglePlay() {
  if (!S.started || S.ended) { startPlayback(); return; }
  if (audio.paused) { ensureAudio(); actx && actx.resume(); audio.play(); }
  else audio.pause();
}
function restart() {
  clearTimeout(outroTimer);         // 否则重播 1.4s 后致谢层会突然弹出
  outro.classList.remove('is-on');
  S.ended = false;
  audio.currentTime = 0;
  S.curIdx = -1;
  clearRows();
  ensureAudio(); actx && actx.resume();
  audio.play();
}
function seekFromEvent(e) {
  const r = track.getBoundingClientRect();
  const p = clamp((e.clientX - r.left) / r.width, 0, 1);
  const dur = trackDur();
  audio.currentTime = p * dur;
  S.curIdx = -1;
  if (S.ended) { S.ended = false; outro.classList.remove('is-on'); if (!audio.paused) {} }
}

audio.addEventListener('play', () => {
  S.playing = true;
  body.classList.add('is-playing');
  body.classList.remove('is-paused');
});
audio.addEventListener('pause', () => {
  S.playing = false;
  body.classList.remove('is-playing');
  body.classList.add('is-paused');
});
audio.addEventListener('ended', () => {
  S.playing = false; S.ended = true;
  body.classList.remove('is-playing');
  body.classList.add('is-paused');
  /* 结尾：唱盘惯性减速后亮起致谢 */
  clearTimeout(outroTimer);
  outroTimer = setTimeout(() => outro.classList.add('is-on'), 1400);
});
audio.addEventListener('loadedmetadata', () => { tTot.textContent = fmtTime(trackDur()); });
audio.addEventListener('error', () => { $('#fallback').hidden = false; });

$('#btnStart').addEventListener('click', startPlayback);
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnRestart').addEventListener('click', restart);
$('#btnPrev').addEventListener('click', () => stepTrack(-1));
$('#btnNext').addEventListener('click', () => stepTrack(1));
$('#btnAgain').addEventListener('click', restart);
/* 进度条：按下 + 拖动（含指针捕获），不只是单击 */
let seeking = false;
track.addEventListener('pointerdown', (e) => {
  seeking = true;
  try { track.setPointerCapture(e.pointerId); } catch (_) {}
  seekFromEvent(e);
});
track.addEventListener('pointermove', (e) => { if (seeking) seekFromEvent(e); });
['pointerup', 'pointercancel'].forEach((ev) => track.addEventListener(ev, () => { seeking = false; }));

/* ── 主题（全部来自 config.js，可任意增删） ── */
let THEMES = [];
function hexToRgb(h) {
  h = String(h || '#e23a4b').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function applyTheme(t) {
  if (!t) return;
  S.theme = t.id;
  const [r, g, b] = hexToRgb(t.accent);
  const hi = t.accentHi ? hexToRgb(t.accentHi) : [r, g, b];
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-hi', `rgb(${hi[0]},${hi[1]},${hi[2]})`);
  root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},.38)`);
  root.style.setProperty('--accent-ghost', `rgba(${r},${g},${b},.14)`);
  root.style.setProperty('--accent-halo', `rgba(${r},${g},${b},.16)`);
  root.setAttribute('data-theme', t.id);
  /* bgImage 可选：只换背景插画，唱片/方盒仍用 cover（同图时可省略 bgImage） */
  const bgUrl = t.bgImage || t.cover;
  for (const el of [bgImg, bgImgRefl]) {
    el.style.backgroundImage = `url("${bgUrl}")`;
    if (t.bg) el.style.backgroundPosition = t.bg;
  }
  for (const im of coverImgs) im.src = t.cover;
  $('#btnSkin').textContent = t.label || t.id;
  /* 粒子主题：0=墨(餘燼) 1=嵐(氣泡) 2=白(落雪)，可连续混合 */
  S.ambientTarget = { embers: 0, caustic: 1, snow: 2 }[t.particles] ?? 0;
  try { localStorage.setItem('vinyl-theme', t.id); } catch (_) {}
  readAccent();
}
function cycleTheme() {
  if (THEMES.length < 2) return;
  const i = THEMES.findIndex(t => t.id === S.theme);
  const next = THEMES[(i + 1 + THEMES.length) % THEMES.length];
  applyTheme(next);
  try { localStorage.setItem('vinyl-theme', next.id); } catch (_) {}
}
$('#btnSkin').addEventListener('click', cycleTheme);

/* 直开模式：手动选择音频 → 同源 blob，可启用实时声谱 */
$('#btnNoticeClose').addEventListener('click', () => { notice.hidden = true; });
$('#btnEnableFx').addEventListener('click', () => { try { filePick.click(); } catch (_) {} });
filePick.addEventListener('change', () => {
  const f = filePick.files && filePick.files[0];
  if (!f) return;
  try {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(f);
    audio.src = audioUrl;
    audio.load();
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    audio.play();
  } catch (_) { notice.hidden = true; }
});

/* 键盘 */
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') { audio.currentTime = Math.min((trackDur()), audio.currentTime + 5); S.curIdx = -1; }
  else if (e.key === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - 5); S.curIdx = -1; }
  else if (e.key === 'r' || e.key === 'R') restart();
  else if (e.key === '[') stepTrack(-1);
  else if (e.key === ']') stepTrack(1);
  else if (e.key === 'Enter' && !S.started) startPlayback();
});

/* 无 UI 感：控件平时隐藏，动鼠标 / 点按才浮现 */
let idleTimer = 0;
function poke() {
  body.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (S.playing && !S.ended) body.classList.add('is-idle'); }, 2600);
}
window.addEventListener('pointermove', poke, { passive: true });
window.addEventListener('pointerdown', poke, { passive: true });

/* 点画面任意处 = 播放 / 暂停（控件与提示条除外） */
stage.addEventListener('click', (e) => {
  if (e.target.closest('.chrome,.notice,button,.outro,.intro')) return;
  togglePlay();
});

/* ── 12b. 调试面板（仅交互模式） ───────────────────────────
   ` 键开关、Esc 关闭；渲染模式（window.__RENDER_MODE__）不创建、不响应。
   调样式用：背景明暗 / 暗角 / 粒子数量·尺寸·速度·形态。
   值存 localStorage('vinyl-debug')，只影响交互模式，不参与渲染。 */
function initDebug() {
  if (RENDER) return;
  const panel = $('#debugPanel');
  if (!panel) return;

  const DEF = { bgB: .62, vig: 1, ptN: 1, ptS: 1, ptV: 1, ptShape: 'auto' };
  let cur = { ...DEF };
  try {
    const saved = JSON.parse(localStorage.getItem('vinyl-debug') || 'null');
    if (saved && typeof saved === 'object') Object.assign(cur, DEF, saved);
  } catch (_) {}

  const root = document.documentElement;
  const els = {
    bgB: $('#dbgBgB'),   bgBV: $('#dbgBgBV'),
    vig: $('#dbgVig'),   vigV: $('#dbgVigV'),
    ptN: $('#dbgPtN'),   ptNV: $('#dbgPtNV'),
    ptS: $('#dbgPtS'),   ptSV: $('#dbgPtSV'),
    ptV: $('#dbgPtV'),   ptVV: $('#dbgPtVV'),
    ptShape: $('#dbgPtShape'), stat: $('#dbgStat'),
  };

  function syncUi() {
    els.bgB.value = Math.round(cur.bgB * 100); els.bgBV.textContent = cur.bgB.toFixed(2);
    els.vig.value = Math.round(cur.vig * 100); els.vigV.textContent = cur.vig.toFixed(2);
    els.ptN.value = Math.round(cur.ptN * 100); els.ptNV.textContent = '×' + cur.ptN.toFixed(2);
    els.ptS.value = Math.round(cur.ptS * 100); els.ptSV.textContent = '×' + cur.ptS.toFixed(2);
    els.ptV.value = Math.round(cur.ptV * 100); els.ptVV.textContent = '×' + cur.ptV.toFixed(2);
    els.ptShape.value = cur.ptShape;
  }

  function apply(reseed) {
    root.style.setProperty('--dbg-bg-b', cur.bgB.toFixed(3));
    root.style.setProperty('--dbg-vig', cur.vig.toFixed(3));
    S.ptN = cur.ptN; S.ptS = cur.ptS; S.ptV = cur.ptV; S.ptShape = cur.ptShape;
    if (reseed) seedAmbient();
    try { localStorage.setItem('vinyl-debug', JSON.stringify(cur)); } catch (_) {}
  }

  els.bgB.addEventListener('input', () => { cur.bgB = +els.bgB.value / 100; els.bgBV.textContent = cur.bgB.toFixed(2); apply(false); });
  els.vig.addEventListener('input', () => { cur.vig = +els.vig.value / 100; els.vigV.textContent = cur.vig.toFixed(2); apply(false); });
  els.ptN.addEventListener('input', () => { cur.ptN = +els.ptN.value / 100; els.ptNV.textContent = '×' + cur.ptN.toFixed(2); apply(true); });
  els.ptS.addEventListener('input', () => { cur.ptS = +els.ptS.value / 100; els.ptSV.textContent = '×' + cur.ptS.toFixed(2); apply(false); });
  els.ptV.addEventListener('input', () => { cur.ptV = +els.ptV.value / 100; els.ptVV.textContent = '×' + cur.ptV.toFixed(2); apply(false); });
  els.ptShape.addEventListener('change', () => { cur.ptShape = els.ptShape.value; apply(false); });

  $('#dbgReset').addEventListener('click', () => {
    cur = { ...DEF };
    syncUi(); apply(true);
    try { localStorage.removeItem('vinyl-debug'); } catch (_) {}
  });

  /* 状态行：fps + 播放秒数，仅在面板打开时计 */
  let timer = 0, raf = 0, frames = 0, last = 0;
  function loop() { frames++; raf = requestAnimationFrame(loop); }
  function setOpen(open) {
    panel.hidden = !open;
    if (!open) { clearInterval(timer); cancelAnimationFrame(raf); els.stat.textContent = '—'; return; }
    syncUi();
    frames = 0; last = performance.now();
    raf = requestAnimationFrame(loop);
    timer = setInterval(() => {
      const now = performance.now();
      const fps = frames * 1000 / Math.max(1, now - last);
      frames = 0; last = now;
      els.stat.textContent = fps.toFixed(0) + ' fps · ' + (audio.currentTime || 0).toFixed(1) + ' s';
    }, 500);
  }
  $('#dbgClose').addEventListener('click', () => setOpen(false));

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === '`' || e.key === '~') { e.preventDefault(); setOpen(panel.hidden); }
    else if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  syncUi(); apply(true);   // 载入时套上保存值
}

/* ── 13. 启动 / 多轨 ────────────────────────────────────── */
let TRACKS = [];
let trackIdx = 0;

/* 把一首歌的信息铺到页面上 */
function applyTrackMeta(t) {
  const title = t.title || '未命名';
  const titleEn = t.titleEn || '';
  const artist = t.artist || '';
  const version = t.version || '';
  const number = t.number || '';
  const who = [artist, version].filter(Boolean).join(' · ');
  document.title = [title, titleEn].filter(Boolean).join(' · ') + ' — Vinyl Session';

  S.durFallback = t.duration || 0;
  S.bpm = t.bpm || 0;
  S.beatPhase = t.beatPhase || 0;
  if (t.audio) audio.src = t.audio;
  tTot.textContent = fmtTime(t.duration || 0);   // metadata 到了会被真实时长覆盖

  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = v; };
  set('titleCn', title);
  set('titleEn', titleEn);
  set('titleArtist', who);
  set('introEn', titleEn);
  set('introArtist', who);
  set('outroTitle', title);
  set('outroEn', titleEn);
  set('introKicker', ['VINYL SESSION', number].filter(Boolean).join(' · '));
  set('outroMeta', [who, number].filter(Boolean).join(' · '));

  /* 进场标题逐字（任意字数） */
  const it = document.getElementById('introTitle');
  if (it) {
    it.innerHTML = [...String(title)].map((ch, i) =>
      `<span style="--i:${i}">${ch.replace('<', '&lt;')}</span>`).join('');
  }

  THEMES = (t.themes && t.themes.length) ? t.themes : [];
  SECTIONS = (t.sections && t.sections.length) ? t.sections : [];
  const btn = $('#btnSkin');
  if (btn) btn.style.display = THEMES.length > 1 ? '' : 'none';
  const multi = TRACKS.length > 1;
  for (const id of ['btnPrev', 'btnNext']) {
    const b = document.getElementById(id);
    if (b) b.style.display = multi ? '' : 'none';
  }
}

/* 歌词来源优先级：lyricsUrl(http) → lyricsFile(script，file:// 也行)
   → lyrics(内嵌兜底) → 内置示例 */
function loadScript(url) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
async function applyLyrics(t) {
  let txt = '';
  if (t.lyricsUrl) {
    try { const r = await fetch(t.lyricsUrl); if (r.ok) txt = await r.text(); } catch (_) {}
  }
  if (!txt && t.lyricsFile) {
    /* 切轨会重复注入同一协议的文件，先清掉旧全局再读新的 */
    try { delete window.LRC_WORD_TEXT; } catch (_) {}
    await loadScript(t.lyricsFile);
    if (window.LRC_WORD_TEXT && window.LRC_WORD_TEXT.trim()) txt = window.LRC_WORD_TEXT;
  }
  if (!txt) txt = t.lyrics || '';
  LINES = parseWordLRC(txt || LRC_FALLBACK);
  S.curIdx = -1;
}

/* 切轨：暂停 → 换元数据 / 歌词 / 音频 → 需要时继续播 */
async function loadTrack(i, autoplay, fit = true) {
  trackIdx = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
  const t = TRACKS[trackIdx];

  audio.pause();
  clearTimeout(outroTimer);
  outro.classList.remove('is-on');
  Object.assign(S, {
    playing: false, ended: false, curIdx: -1, lastBreak: false,
    section: '', fxLevel: .55, karaokeIdx: -1, curChars: [], lastBeatIdx: -1, beat: 0,
  });
  lyBreak.classList.remove('is-on');

  applyTrackMeta(t);
  if (fit) fitTheme();      // 新曲目没有当前主题就退回它的第一套
  audio.src = t.audio;
  audio.currentTime = 0;
  audio.load();
  await applyLyrics(t);
  clearRows();

  if (autoplay) {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    audio.play().catch(() => {});
  }
}
function stepTrack(dir) { loadTrack(trackIdx + dir, S.playing); }

/* 主题记忆是全局的：新曲目有同 id 就沿用，否则用第一套 */
function pickTheme() {
  let saved = null;
  try { saved = localStorage.getItem('vinyl-theme'); } catch (_) {}
  /* ?theme=<id> 可固定主题（分享链接 / 渲染出片用），优先于 localStorage 记忆 */
  let q = '';
  try { q = new URLSearchParams(location.search).get('theme') || ''; } catch (_) {}
  const th = THEMES.find(x => x.id === q) || THEMES.find(x => x.id === saved) || THEMES[0];
  if (th) applyTheme(th);
}
/* 切轨时收敛到当前曲目拥有的主题（不重读 localStorage） */
function fitTheme() {
  const cur = THEMES.find(x => x.id === S.theme);
  if (cur || THEMES[0]) applyTheme(cur || THEMES[0]);
}

(async function init() {
  const cfg = window.TEMPLATE_CONFIG || {};
  TRACKS = (cfg.tracks && cfg.tracks.length) ? cfg.tracks : [cfg];
  await loadTrack(0, false, false);   // 首次不收敛主题，交给 pickTheme 读记忆
  pickTheme();
  resize();
  seedAmbient();
  window.addEventListener('resize', seedAmbient);

  if (RENDER) {
    /* 调试面板只属于交互模式：渲染时直接从 DOM 移除，避免任何出镜可能 */
    const dbgPanel = $('#debugPanel');
    if (dbgPanel) dbgPanel.remove();
    /* 离线能量数据（script 注入，file:// 也能用） */
    if (!window.ENERGY) await loadScript('assets/energy.js');
    if (!freqData) freqData = new Uint8Array(1024);
    /* 时长优先取音轨真实 metadata， configs 里的 duration 只是兜底 */
    await new Promise((res) => {
      if (isFinite(audio.duration) && audio.duration > 0) return res();
      audio.addEventListener('loadedmetadata', () => res(), { once: true });
      setTimeout(res, 4000);
    });
    if (isFinite(audio.duration) && audio.duration > 0) S.durFallback = audio.duration;

    S.started = true;
    body.classList.add('is-live');
    intro.style.display = 'none';
    if (window.__NOGRAIN__) $('.grain').style.display = 'none';
    /* DUR / 字体等待 / CSS 动画虚拟时钟 / renderAt / __ready 由 web-kit 渲染运行时收尾 */
    await MK.renderRuntime.install({
      fps: 30,
      duration: S.durFallback + OUTRO_TAIL,
      update: (t, dt, now) => update(t, dt, now),
    });
  } else {
    body.classList.add('is-idle');
    lastT = performance.now();
    initDebug();
    schedule();
  }
})();
