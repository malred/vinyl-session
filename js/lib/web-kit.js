/* @motion/web-kit vendored copy — DO NOT EDIT BY HAND
   权威源: packages/web-kit/src/{math.js, lyrics.js, karaoke.js, energy.js, ring-spectrum.js, render-runtime.js}
   再生成: node scripts/vendor-web-kit.mjs --project <dir>；漂移检查: --check */

/* ═══ @motion/web-kit · math ═══════════════════════════════════
   零依赖数学 / 种子随机原语。确定性契约：渲染期禁止 Math.random /
   Date.now，随机一律走 rnd()（固定种子，同序可复现）。
   来源：vinyl-session js/main.js 同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const damp  = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/* 有种子随机：渲染模式可复现（交互模式也只是换成确定性版本） */
let _seed = 0x9e3779b9;
function rnd() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

MK.math = { TAU, clamp, damp, rnd };
})(globalThis.MotionKit = globalThis.MotionKit || {});


/* ═══ @motion/web-kit · lyrics ═════════════════════════════════
   LRC 歌词解析。A2 逐字格式契约（Enhanced LRC）：

     [mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字<mm:ss.xx>…

   配套三文件约定（见包 README）：lyrics-line.lrc（句级源）/
   lyrics-word.lrc（逐字可读版）/ lyrics-word.js（script 注入，
   赋给 window.LRC_WORD_TEXT，file:// 也能用）。
   没有逐字数据时回退为句级 LRC（字在行内均分）。
   来源：vinyl-session js/main.js 同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const toSec = (a, b, c) => (+a) * 60 + (+b) + (c ? +c / Math.pow(10, c.length) : 0);

/* 句级 LRC：[{ t, text }]，按时间升序 */
function parseLRC(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const t = (+m[1]) * 60 + (+m[2]) + (m[3] ? +m[3] / Math.pow(10, m[3].length) : 0);
    out.push({ t, text: m[4].trim() });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/* 逐字 LRC：[{ t, text, chars: [{ t, ch }] }]
   一个时间戳圈住多个字时在圈内按字数均摊起点。 */
function parseWordLRC(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const t = toSec(m[1], m[2], m[3]);
    const body = m[4] || '';
    const chars = [];
    if (body.indexOf('<') >= 0) {
      const re = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>([\s\S]*?)(?=<|$)/g;
      const hits = [];
      let mm;
      while ((mm = re.exec(body))) hits.push({ t: toSec(mm[1], mm[2], mm[3]), text: mm[4] });
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const nxt = i + 1 < hits.length ? hits[i + 1].t : t;
        for (let k = 0; k < h.text.length; k++) {
          chars.push({ t: h.text.length > 1 ? h.t + (nxt - h.t) * k / h.text.length : h.t, ch: h.text[k] });
        }
      }
    }
    const text = chars.length ? chars.map(c => c.ch).join('') : body.trim();
    if (!chars.length) for (const ch of text) chars.push({ t, ch });
    out.push({ t, text, chars });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

MK.lyrics = { toSec, parseLRC, parseWordLRC };
})(globalThis.MotionKit = globalThis.MotionKit || {});


/* ═══ @motion/web-kit · karaoke ════════════════════════════════
   逐字卡拉OK填充核心：进度数学 + DOM 写入。
   DOM 结构（span.ch + --fill 渐变）由调用方或 CSS 负责；
   本模块只管「第 i 个字此刻该亮到哪」与「写 DOM 只写变化」。
   来源：vinyl-session js/main.js updateKaraoke 同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const clamp = MK.math.clamp;

/* 第 i 个字的填充进度 0..1。
   - line:    parseWordLRC 产出的一行 { t, text, chars }
   - n:       DOM 侧当前行的字 span 数（与 line.chars 等长时走逐字）
   - lineEnd: 下一行起点或音轨时长（调用方算好传入）
   逐字：按 chars[i].t → 下一字起点推进，尾字封顶 +2.5s；
   回退：句级均分 cp = clamp(p*n - i, 0, 1)。
   是否逐字记在 line._wt 上，逐行只判定一次（与原实现一致）。 */
function charFill(line, i, t, lineEnd, n) {
  const chars = line.chars || [];
  if (line._wt === undefined) line._wt = chars.length === n && new Set(chars.map(c => c.t)).size > 1;
  if (line._wt) {
    const c = chars[i];
    const end = (i + 1 < n) ? chars[i + 1].t : Math.min(lineEnd, c.t + 2.5);
    return clamp((t - c.t) / Math.max(.05, end - c.t), 0, 1);
  }
  /* 回退：句级均分 */
  const p = clamp((t - line.t) / Math.max(.001, lineEnd - line.t), 0, 1);
  return clamp(p * n - i, 0, 1);
}

/* 把进度写到一个字 span 上：--fill 百分比 + sung 类。
   只写变化，别每帧碰 DOM（与原实现一致）。
   opts: { fillVar = '--fill', sungClass = 'is-sung' } */
function applyFill(el, p, opts) {
  const o = opts || {};
  const fillVar = o.fillVar || '--fill';
  const sungClass = o.sungClass || 'is-sung';
  const pct = (p * 100).toFixed(1) + '%';
  if (el.style.getPropertyValue(fillVar) !== pct) el.style.setProperty(fillVar, pct);
  const sung = p >= 1;
  if (el.classList.contains(sungClass) !== sung) el.classList.toggle(sungClass, sung);
}

MK.karaoke = { charFill, applyFill };
})(globalThis.MotionKit = globalThis.MotionKit || {});


/* ═══ @motion/web-kit · energy ═════════════════════════════════
   频段能量三源统一：
   - live     实时 AnalyserNode 频谱数据按频段求均值（bands）
   - offline  离线能量表 window.ENERGY（tools/render_energy.py 生成）查帧（energyAt）
   - synth    渲染模式用三段能量合成一份「频谱」给 EQ/频谱柱（synthFreqData）
   window.ENERGY 契约：{ fps, dur, bpm, phase, bass[], mid[], high[], beat[] }。
   来源：vinyl-session js/main.js 同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const clamp = MK.math.clamp;

/* 离线能量表按帧查询；表不存在 / 为空返回 null（调用方走合成兜底） */
function energyAt(t) {
  const E = globalThis.ENERGY;
  if (!E || !E.bass || !E.bass.length) return null;
  const i = clamp(Math.floor(t * E.fps), 0, E.bass.length - 1);
  return { b: E.bass[i], m: E.mid[i], h: E.high[i], beat: E.beat[i] };
}

/* 渲染模式：用三段能量合成一份「频谱」写入 out（Uint8Array），同帧可复现 */
function synthFreqData(t, out) {
  const e = energyAt(t) || { b: 0, m: 0, h: 0 };
  const n = out.length, ph = Math.floor(t * 12);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const shape = e.b * Math.exp(-p * 7)
                + e.m * Math.exp(-Math.pow(p - .32, 2) * 26)
                + e.h * Math.exp(-Math.pow(p - .78, 2) * 34);
    const j = .78 + .22 * Math.sin(i * 12.9898 + ph * 78.233);
    out[i] = Math.max(0, Math.min(255, shape * 255 * j));
  }
  return out;
}

/* 实时模式：analyser 频谱数据按频段求三段平均（0..1）。
   bins: { b:[起,止), m:[起,止), h:[起,止) }；缺省为 vinyl-session @fftSize 2048 标定。 */
function bands(freqData, bins) {
  const B = bins || { b: [0, 24], m: [60, 240], h: [240, 800] };
  let b = 0; for (let i = B.b[0]; i < B.b[1]; i++) b += freqData[i]; b /= (B.b[1] - B.b[0]) * 255;
  let m = 0; for (let i = B.m[0]; i < B.m[1]; i++) m += freqData[i]; m /= (B.m[1] - B.m[0]) * 255;
  let h = 0; for (let i = B.h[0]; i < B.h[1]; i++) h += freqData[i]; h /= (B.h[1] - B.h[0]) * 255;
  return { b, m, h };
}

MK.energy = { energyAt, synthFreqData, bands };
})(globalThis.MotionKit = globalThis.MotionKit || {});


/* ═══ @motion/web-kit · ring-spectrum ══════════════════════════
   环绕 EQ（竖屏）/ 盘沿频谱（桌面），Canvas 2D 双 pass：
   暗色衬底（source-over）+ 主题色柱（lighter）。
   几何完全由调用方注入——本模块不关心唱片在哪：
     geom = { cx, cy, R, fade }   像素坐标；fade 0..1 整体透明度
     opts = { freqData, portrait, t, fxLevel, rgba }
       freqData  Uint8Array 频谱（渲染模式先经 energy.synthFreqData 合成）
       portrait  true 走单层环绕 EQ（左右镜像、重音在正上方、极慢自转）
       t         秒（自转相位）
       fxLevel   桌面段柱长增益（段落视觉强度）
       rgba      (alpha) => 主题色字符串
   来源：vinyl-session js/main.js drawSpectrum 绘制段同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const TAU = MK.math.TAU;

function draw(ctx, geom, opts) {
  const { cx, cy, R, fade } = geom;
  const freqData = opts.freqData;
  const rgba = opts.rgba;

  if (opts.portrait) {
    /* 竖屏：单层环绕 EQ —— 克制、低亮度，唱片才是主角
       左右镜像（重音在正上方），极慢自转，不做发光叠加 */
    const o = { r0: R * 1.03, base: .035, len: .27, rot: opts.t * .05,
                N: 120, wf: .42, pow: 1.5, bins: 240, gamma: 1.3, a0: .12, a1: .5 };
    ctx.lineWidth = Math.max(1, (TAU * R / o.N) * o.wf);
    ctx.lineCap = 'round';
    for (let i = 0; i < o.N; i++) {
      const tt = i / o.N;
      const m = 1 - Math.abs(tt * 2 - 1);            // 1 = 正上方（重音），0 = 正下方
      const bin = Math.floor(Math.pow(m, o.pow) * o.bins);
      const v = Math.pow(freqData[Math.min(bin, freqData.length - 1)] / 255, o.gamma);
      const a = -Math.PI / 2 + tt * TAU + o.rot;
      const r0 = o.r0;
      const len = Math.max(R * .022, o.base * R + v * o.len * R);
      const cos = Math.cos(a), sin = Math.sin(a);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(0,0,0,${(0.30 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len * 1.06), cy + sin * (r0 + len * 1.06));
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(Math.min(1, (o.a0 + v * o.a1) * fade));
      ctx.beginPath();
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  /* 桌面：贴着盘沿的细密频谱。先铺暗色衬底，浅色主题（白）在浅封面上才看得清 */
  const N = 140;
  const lw = (TAU * R / N) * .44;
  ctx.lineWidth = Math.max(1, lw);
  ctx.lineCap = 'round';
  const boost = 0.55 + (opts.fxLevel || 0) * 0.75;
  for (let i = 0; i < N; i++) {
    const bin = Math.floor(Math.pow(i / N, 1.35) * 260);
    const v = Math.pow(freqData[Math.min(bin, freqData.length - 1)] / 255, 1.7);
    const a = -Math.PI / 2 + (i / N) * TAU;
    const r0 = R * 1.035;
    const len = Math.max(v * R * .30 * boost, R * .014);
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(0,0,0,${(0.30 * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx + cos * r0, cy + sin * r0);
    ctx.lineTo(cx + cos * (r0 + len * 1.06), cy + sin * (r0 + len * 1.06));
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba((0.10 + v * 0.62) * fade);
    ctx.beginPath();
    ctx.moveTo(cx + cos * r0, cy + sin * r0);
    ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

MK.ringSpectrum = { draw };
})(globalThis.MotionKit = globalThis.MotionKit || {});


/* ═══ @motion/web-kit · render-runtime ═════════════════════════
   HTML 管线的确定性渲染契约运行时。

   scripts/render-html.mjs 通过 addInitScript 注入 window.__RENDER_MODE__；
   此时时间轴由 window.renderAt(t) 驱动：音频能量走离线表（energy.js），
   随机走 math.rnd()，CSS 动画/过渡纳入虚拟时钟逐帧 seek+pause，
   逐帧画面可复现（不再依赖 rAF / AudioContext / 真实时钟）。

   契约全局量：renderAt(t) / __ready / DUR / __RENDER_MODE__ /
   __NOANIM__ / ?noanim —— 详见包 README。
   来源：vinyl-session js/main.js 渲染模式段同码搬移（2026-11-22）。
   ═══════════════════════════════════════════════════════════════ */
(function (MK) {
'use strict';

const clamp = MK.math.clamp;

const RENDER = !!globalThis.__RENDER_MODE__;
let VT = 0;                    // 渲染模式下的虚拟秒
const nowSec = () => (RENDER ? VT : performance.now() / 1000);

/* CSS 动画 / 过渡也纳入虚拟时钟，否则漏光、颗粒、歌词滚动走真实时间，
   逐帧画面不可复现。冻结：否则动画会继续按真实时钟前进。 */
function seekAnimations(t) {
  if (!document.getAnimations) return;
  for (const a of document.getAnimations()) {
    try {
      a.currentTime = t * 1000;
      a.pause();
    } catch (_) {}
  }
}

/* 渲染模式收尾。页面先把自己的渲染模式准备做好（移除交互-only DOM、
   载入离线能量、等音轨 metadata、切 is-live 状态等），最后调这里：
     opts = { fps = 30, duration, update }
   duration 为总秒数（正片 + 尾卡），update(t, dt, nowMs) 为一帧推进。 */
async function install(opts) {
  const fps = (opts && opts.fps) || 30;
  const update = opts.update;
  globalThis.DUR = Math.ceil(opts.duration);
  await document.fonts.ready;
  if (globalThis.__NOANIM__ || new URLSearchParams(location.search).has('noanim')) {
    const kill = document.createElement('style');
    kill.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.appendChild(kill);
  }
  seekAnimations(0);
  globalThis.renderAt = (t) => {
    const dt = clamp(t - VT, 0, .05) || 1 / fps;
    VT = t;
    update(t, dt, t * 1000);
    seekAnimations(t);
  };
  globalThis.__ready = true;
}

MK.renderRuntime = { RENDER, nowSec, seekAnimations, install };
})(globalThis.MotionKit = globalThis.MotionKit || {});
