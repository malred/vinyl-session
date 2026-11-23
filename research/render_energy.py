#!/usr/bin/env python3
"""离线预计算音频能量包络 —— 给「渲染模式」用。

交互模式下可视化靠 Web Audio 的 AnalyserNode 实时 FFT；但逐帧出片（render-html.mjs）
要求画面可复现，实时 FFT 不可用。这里把同一套频段能量提前算好写成 JS 数据，
渲染时查表，于是频谱环 / 节拍脉冲 / 粒子强度仍跟真歌一致，且两次渲染逐位一致。

频段与 web-kit energy.bands 的缺省分箱保持一致（48kHz / FFT 2048）：
    bass = 0–540Hz   mid = 1.4–5.6kHz   high = 5.6–18kHz
幅值映射沿用 AnalyserNode 默认动态范围：-100dB..-30dB → 0..1。

权威源：packages/web-kit/tools/（消费工程经 vendor 副本使用）。

用法：
    python render_energy.py <mp3> [--fps 30] [--out assets/energy.js] [--stats]
"""
import argparse
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 48000
FFT = 2048
# (lo Hz, hi Hz, dB 下限, dB 上限)：每个频段按自己的动态范围标定，
# 保证小声学段落也有可用的视觉摆幅。dB 以满幅正弦为 0 dBFS。
BANDS = {
    "bass": (20.0, 540.0, -62.0, -22.0),
    "mid": (1400.0, 5600.0, -82.0, -42.0),
    "high": (5600.0, 18000.0, -92.0, -52.0),
}

# 判拍（对低频包络做 onset 检测）
BEAT_DELTA = 0.03
BEAT_FLOOR = 0.42
BEAT_REFRACT = 0.30   # 秒


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def decode_mono(path, sr):
    """用 ffmpeg 解码成单声道 wav 再读成 float32（-1..1）。"""
    tmp = os.path.join(tempfile.gettempdir(), "vinyl_energy_16k.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "wav", tmp],
        check=True,
    )
    with wave.open(tmp, "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    try:
        os.remove(tmp)
    except OSError:
        pass
    return x


def band_env(x, sr, fps):
    hop = sr / fps
    n = max(1, int(math.floor((len(x) - FFT) / hop)) + 1)
    win = np.hanning(FFT)
    norm = win.sum() / 2.0                 # 满幅正弦峰值归一到 1.0
    freqs = np.fft.rfftfreq(FFT, 1.0 / sr)
    masks = {k: (freqs >= lo) & (freqs < hi) for k, (lo, hi, _, _) in BANDS.items()}
    wins = {k: (d0, d1) for k, (_, _, d0, d1) in BANDS.items()}
    out = {k: np.zeros(n, dtype=np.float64) for k in BANDS}
    for i in range(n):
        s = int(i * hop)
        seg = x[s:s + FFT]
        if len(seg) < FFT:
            seg = np.pad(seg, (0, FFT - len(seg)))
        sp = (np.abs(np.fft.rfft(seg * win)) / norm) ** 2
        for k, mask in masks.items():
            if not mask.any():
                continue
            db = 10.0 * np.log10(sp[mask] + 1e-12)   # 逐 bin dB
            d0, d1 = wins[k]
            out[k][i] = np.clip((db - d0) / (d1 - d0), 0.0, 1.0).mean()
    return out, n


def estimate_tempo(bass, fps, dur, lo=50.0, hi=90.0, step=0.5):
    """在低频段能量上扫 BPM + 相位，找对比度最大的规则网格。
    返回 (bpm, phase, contrast)；对比度太低说明曲子没有稳定拍感。"""
    n = len(bass)
    best = None
    bpm = lo
    while bpm <= hi + 1e-9:
        period = 60.0 / bpm
        steps = max(24, int(period * fps * 2))
        for s in range(steps):
            phi = s * period / steps
            cnt = int((dur - phi) / period)
            if cnt < 10:
                continue
            idx = np.floor((phi + np.arange(cnt) * period) * fps).astype(np.int64)
            idx = idx[(idx >= 0) & (idx < n)]
            if len(idx) < 10:
                continue
            grid = float(bass[idx].mean())
            other = float(np.delete(bass, idx).mean())
            score = grid - other
            if best is None or score > best[2]:
                best = (round(bpm, 2), round(phi, 4), score)
        bpm += step
    return best


def detect_beats(bass, fps):
    """低频 onset 判拍（3 帧平滑抗抖）。"""
    k = 3
    kernel = np.ones(k) / k
    bs = np.convolve(bass, kernel, mode="same")
    beats = np.zeros(len(bs), dtype=np.int64)
    last = -1e9
    gap = BEAT_REFRACT * fps
    for i in range(1, len(bs)):
        if bs[i] - bs[i - 1] > BEAT_DELTA and bs[i] > BEAT_FLOOR and (i - last) > gap:
            beats[i] = 1
            last = i
    return beats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--out", default=None)
    ap.add_argument("--stats", action="store_true", help="只打印分布，不写文件")
    args = ap.parse_args()

    if not os.path.isfile(args.mp3):
        sys.exit(f"找不到音轨: {args.mp3}")
    out_path = args.out or os.path.join(os.path.dirname(args.mp3), "energy.js")

    x = decode_mono(args.mp3, SR)
    dur = len(x) / SR
    env, n = band_env(x, SR, args.fps)
    beats = detect_beats(env["bass"], args.fps)

    if args.stats:
        for k in ("bass", "mid", "high"):
            a = env[k]
            q = np.percentile(a, [10, 50, 90, 99])
            print(f"{k:5s} n={n} mean={a.mean():.3f} p10={q[0]:.3f} p50={q[1]:.3f} p90={q[2]:.3f} p99={q[3]:.3f}")
        print(f"beats={int(beats.sum())} / {dur:.1f}s  ({beats.sum()/dur:.2f}/s)")
        return

    def arr(a):
        return [round(float(v), 3) for v in a]

    tempo = estimate_tempo(env["bass"], args.fps, dur)
    payload = {
        "fps": args.fps,
        "dur": round(dur, 3),
        "bpm": tempo[0],
        "phase": tempo[1],
        "bass": arr(env["bass"]),
        "mid": arr(env["mid"]),
        "high": arr(env["high"]),
        "beat": [int(v) for v in beats],
    }
    head = "/* 由 render_energy.py 生成：离线音频能量包络（渲染模式用，勿手改） */\n"
    io.open(out_path, "w", encoding="utf-8").write(
        head + "window.ENERGY = " + json.dumps(payload, separators=(",", ":")) + ";\n"
    )
    print(f"✓ {out_path}  {n} 帧 @ {args.fps}fps  时长 {dur:.2f}s  节拍 {int(beats.sum())} 次"
          f"  网格 bpm={tempo[0]} phase={tempo[1]}s（对比度 {tempo[2]:+.3f}）"
          f"（{os.path.getsize(out_path)/1024:.0f} KB）")


if __name__ == "__main__":
    main()
