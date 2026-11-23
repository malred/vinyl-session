#!/usr/bin/env python3
"""零依赖（只需 numpy/ffmpeg）的逐字时间戳估算：
用人声 onset（谱通量峰值）给句级 LRC 的每个字分配起点。

输出 Enhanced LRC（A2 风格）：
    [mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字...
词终点 = 下一个词起点，行尾用行终点。

权威源：packages/web-kit/tools/（消费工程经 vendor 副本或环境变量使用）。
路径可用环境变量覆盖（与 asr_align.py 同一套）：
    VINYL_ROOT / VINYL_MP3 / VINYL_LRC / VINYL_OUT
"""
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np


def find_peaks_simple(flux, min_dist, k=4):
    """极简峰值拾取：局部极大 + 强度阈值 + 最小间距（强到弱贪心）。"""
    if len(flux) < 3:
        return [], np.array([])
    loc = [i for i in range(1, len(flux) - 1)
           if flux[i] >= flux[i - 1] and flux[i] > flux[i + 1]]
    if not loc:
        return [], np.array([])
    thr = np.mean(flux) + k * np.std(flux)
    print(f"[diag] flux mean={np.mean(flux):.3f} std={np.std(flux):.3f} thr={thr:.3f} locals={len(loc)}")
    loc = [i for i in loc if flux[i] > thr]
    loc.sort(key=lambda i: -flux[i])
    chosen = []
    for i in loc:
        if all(abs(i - j) >= min_dist for j in chosen):
            chosen.append(i)
    chosen.sort()
    prom = np.array([max(0.0, flux[i] - min(flux[max(0, i - min_dist):i + min_dist + 1])) for i in chosen])
    return chosen, prom

ROOT = os.environ.get("VINYL_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 路径可用环境变量覆盖（与 asr_align.py 同一套）：VINYL_MP3 / VINYL_LRC / VINYL_OUT
MP3 = os.environ.get("VINYL_MP3", os.path.join(ROOT, "assets", "kimono-sad.mp3"))
LRC = os.environ.get("VINYL_LRC", os.path.join(ROOT, "assets", "lyrics-kimono-line.lrc"))
OUT = os.environ.get("VINYL_OUT", os.path.join(ROOT, "assets", "lyrics-kimono.lrc"))

SR = 22050
WIN = 1024
HOP = 256          # ≈11.6ms
BAND = (140, 3200)  # 人声主要能量带


def decode():
    tmp = os.path.join(tempfile.gettempdir(), "vinyl_onset_tmp.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", MP3,
                    "-ac", "1", "-ar", str(SR), "-f", "wav", tmp], check=True)
    with wave.open(tmp, "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    try:
        os.remove(tmp)
    except OSError:
        pass
    return x


def novelty(x):
    n = (len(x) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(WIN)
    spec = np.abs(np.fft.rfft(frames, axis=1))
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    band = (freqs >= BAND[0]) & (freqs <= BAND[1])
    spec = np.log1p(spec[:, band] * 100)
    flux = np.maximum(0.0, np.diff(spec, axis=0)).sum(axis=1)
    # 帧 i 的 onset 时刻 ≈ 第 i+1 帧中心
    times = (np.arange(n - 1) * HOP + WIN / 2 + HOP) / SR
    return times, flux


def read_lrc(path):
    out = []
    for raw in open(path, encoding="utf-8").read().splitlines():
        m = re.match(r"^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$", raw)
        if not m:
            continue
        t = int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3)) / 10 ** len(m.group(3)) if m.group(3) else 0)
        out.append((t, m.group(4).strip()))
    out.sort()
    return out


def pick(peaks, n, t0, t1):
    """DP 对齐：把 n 个字映到 [t0,t1] 内的 onset 上。
    代价 = 与「均匀期望位置」的偏差（主） − 归一化 onset 强度（次）。
    这样既贴住人声起音，又不会某字被甩出两三秒。"""
    cand = [(p, s) for p, s in peaks if t0 + 0.02 < p < t1 - 0.02]
    if n <= 0:
        return []
    span = max(0.2, t1 - t0)
    exp = [t0 + span * (i + .5) / n for i in range(n)]
    if len(cand) < n:
        # onset 不足：先按均匀铺，再把每个字吸附到最近的可用 onset
        out = []
        for e in exp:
            near = min(cand, key=lambda c: abs(c[0] - e)) if cand else None
            out.append(near[0] if near and abs(near[0] - e) < span / n * .7 else e)
        return sorted(set(round(v, 3) for v in out))
    smax = max(c[1] for c in cand) or 1.0
    m = len(cand)
    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    par = [[0] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            p, s = cand[j - 1]
            dev = ((p - exp[i - 1]) / span) ** 2
            cost = dev - (s / smax) * 0.06
            best, bj = INF, 0
            for jj in range(0, j):
                v = dp[i - 1][jj]
                if v + cost < best:
                    best, bj = v + cost, jj
            dp[i][j], par[i][j] = best, bj
    best, bj = INF, 0
    for j in range(1, m + 1):
        if dp[n][j] < best:
            best, bj = dp[n][j], j
    js, i, j = [], n, bj
    while i > 0 and j > 0:
        js.append(j - 1)
        j = par[i][j]
        i -= 1
    js.reverse()
    return [cand[k][0] for k in js]


def fmt(t):
    m = int(t // 60)
    s = t - m * 60
    return f"{m:02d}:{s:05.2f}"


def main():
    x = decode()
    times, flux = novelty(x)
    # 峰值拾取
    pk, prom = find_peaks_simple(flux, min_dist=int(0.09 * SR / HOP), k=1.1)
    peaks = list(zip(times[pk], prom))
    print(f"onset 候选总数 {len(peaks)}")

    lines = read_lrc(LRC)
    dur = len(x) / SR
    result, report = [], []
    for i, (t0, text) in enumerate(lines):
        if not text:
            result.append(f"[{fmt(t0)}]")
            continue
        t1 = lines[i + 1][0] if i + 1 < len(lines) else dur
        chars = list(text)
        ts = pick(peaks, len(chars), t0, t1)
        ts = ts + [t1] * (len(chars) - len(ts))
        ts = sorted(ts) + [t1]
        body = "".join(f"<{fmt(ts[k])}>{c}" for k, c in enumerate(chars))
        result.append(f"[{fmt(t0)}]{body}")
        near = len([p for p, _ in peaks if t0 < p < t1])
        report.append((fmt(t0), text, len(chars), near))

    open(OUT, "w", encoding="utf-8").write("\n".join(result) + "\n")
    print(f"\n输出 → {OUT}\n")
    print(f"{'行首':>9}  {'字数':>4} {'onset':>5}  歌词")
    for r in report:
        flag = "" if r[2] <= r[3] else "  ← onset 偏少"
        print(f"{r[0]:>9}  {r[2]:>4} {r[3]:>5}  {r[1]}{flag}")


if __name__ == "__main__":
    main()
