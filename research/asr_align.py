#!/usr/bin/env python3
"""用 faster-whisper 的词级时间戳 + 可信句级 LRC，生成逐字歌词（Enhanced LRC / A2）。

比 onset 检测准得多：ASR 本来就在听人声，词边界即字边界。
若 ASR 不可用，回退到 onset_align.py 的结果。

权威源：packages/web-kit/tools/（消费工程经 vendor 副本或环境变量使用）。
路径与来源都可用环境变量覆盖，便于给别的歌复用同一脚本：
    VINYL_ROOT / VINYL_MP3 / VINYL_LRC / VINYL_OUT / VINYL_ASR_JSON
VINYL_ASR_JSON 指向已有的 faster-whisper 词级 JSON（如 *.lrc.asr.json）时，
直接复用其中的词时间戳，跳过重新转写（省掉几分钟 CPU）。
"""
import difflib
import io
import json
import os
import re
import sys
import tempfile

ROOT = os.environ.get("VINYL_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP3 = os.environ.get("VINYL_MP3", os.path.join(ROOT, "assets", "kimono-sad.mp3"))
LRC = os.environ.get("VINYL_LRC", os.path.join(ROOT, "assets", "lyrics-kimono-line.lrc"))
OUT = os.environ.get("VINYL_OUT", os.path.join(ROOT, "assets", "lyrics-kimono.lrc"))
ASR_JSON = os.environ.get("VINYL_ASR_JSON", "")
MODEL = os.environ.get("WHISPER_MODEL", "small")


def read_lrc(path):
    out = []
    for raw in io.open(path, encoding="utf-8").read().splitlines():
        m = re.match(r"^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$", raw)
        if not m:
            continue
        t = int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3)) / 10 ** len(m.group(3)) if m.group(3) else 0)
        out.append((t, m.group(4).strip()))
    out.sort()
    return out


def fmt(t):
    m = int(t // 60)
    return f"{m:02d}:{t - m * 60:05.2f}"


def _patch_audio_decode():
    """本机 PyAV 版本过旧且不支持 metadata_errors，这里改用 ffmpeg 自行解码。"""
    import subprocess
    import wave as _wave
    import numpy as np
    import faster_whisper.transcribe as _tw

    def decode(path, sampling_rate=16000, **kw):
        tmp = os.path.join(tempfile.gettempdir(), "vinyl_asr_16k.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path),
                        "-ac", "1", "-ar", str(sampling_rate), "-f", "wav", tmp], check=True)
        with _wave.open(tmp, "rb") as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
            return x.astype(np.float32) / 32768.0

    _tw.decode_audio = decode


def transcribe():
    if ASR_JSON:
        print(f"复用 ASR：{ASR_JSON}")
        segs = json.load(io.open(ASR_JSON, encoding="utf-8"))
        words = []
        for s in segs:
            for w in s.get("words") or []:
                tx = (w.get("word") or "").strip()
                if tx:
                    words.append((float(w["start"]), float(w["end"]), tx))
        return words
    from faster_whisper import WhisperModel
    _patch_audio_decode()
    local = os.path.join(ROOT, "research", "fw-small")
    src = local if os.path.isfile(os.path.join(local, "model.bin")) else MODEL
    print(f"模型：{src}")
    model = WhisperModel(src, device="cpu", compute_type="int8")
    # 本机 PyAV/ONNX 组合下 VAD 会把人声整段滤掉，故关闭，靠 LRC 时间窗约束
    segs, info = model.transcribe(MP3, language="zh", word_timestamps=True,
                                  vad_filter=False, beam_size=5)
    words = []
    for s in segs:
        if not s.words:
            continue
        for w in s.words:
            tx = w.word.strip()
            if tx:
                words.append((float(w.start), float(w.end), tx))
    return words


def align_line(chars, words, t0, t1):
    """把 ASR 字序列对齐到 LRC 字序列，返回每个 LRC 字的起播时刻。"""
    ac = []
    for (s, e, tx) in words:
        if e < t0 - 0.5 or s > t1 + 0.8:
            continue
        n = len(tx)
        for i, ch in enumerate(tx):
            ac.append((s + (e - s) * i / n, ch))
    if not ac:
        return None
    sm = difflib.SequenceMatcher(None, [c for _, c in ac], list(chars), autojunk=False)
    out = [None] * len(chars)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            if 0 <= blk.b + k < len(out):
                out[blk.b + k] = ac[blk.a + k][0]
    # 未匹配上的字：先按位置均摊（句首/句尾/中间），保证不挤在一起
    known = [(i, v) for i, v in enumerate(out) if v is not None]
    if not known:
        return None
    fi, fv = known[0]
    li, lv = known[-1]
    for i in range(0, fi):
        out[i] = t0 + (fv - t0) * (i + 1) / (fi + 1)
    for i in range(li + 1, len(out)):
        out[i] = lv + (t1 - lv) * (i - li) / (len(out) - li)
    for i in range(len(out)):
        if out[i] is None:
            left = max([k for k in known if k[0] < i], key=lambda k: k[0], default=None)
            right = min([k for k in known if k[0] > i], key=lambda k: k[0], default=None)
            if left and right:
                out[i] = left[1] + (right[1] - left[1]) * (i - left[0]) / (right[0] - left[0])
            elif left:
                out[i] = left[1]
            else:
                out[i] = right[1]
    return spread([min(max(v, t0), t1 - .02) for v in out], t0, t1)


def spread(ts, t0, t1, min_gap=0.09):
    """排序后强制最小字间隔，并保证全部落在 [t0, t1] 内。"""
    ts = sorted(ts)
    n = len(ts)
    hi = t1 - .02
    for i in range(1, n):
        if ts[i] < ts[i - 1] + min_gap:
            ts[i] = ts[i - 1] + min_gap
    for _ in range(3):
        if ts[-1] <= hi and ts[0] >= t0:
            break
        if ts[-1] > hi:
            ts[-1] = hi
            for i in range(n - 2, -1, -1):
                if ts[i] > ts[i + 1] - min_gap:
                    ts[i] = ts[i + 1] - min_gap
        if ts[0] < t0:
            d = t0 - ts[0]
            ts = [v + d for v in ts]
    return ts


def main():
    lines = read_lrc(LRC)
    dur = lines[-1][0] + 6 if lines else 213.0
    words = transcribe()
    print(f"ASR 词数 {len(words)}")

    res, stats = [], []
    for i, (t0, text) in enumerate(lines):
        if not text:
            res.append(f"[{fmt(t0)}]")
            continue
        t1 = lines[i + 1][0] if i + 1 < len(lines) else dur
        ts = align_line(list(text), words, t0, t1)
        if ts is None:
            ts = [t0 + (t1 - t0) * (i + .5) / len(text) for i in range(len(text))]
        body = "".join(f"<{fmt(ts[k])}>{c}" for k, c in enumerate(text))
        res.append(f"[{fmt(t0)}]{body}")
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        stats.append((len(text), max(gaps) if gaps else 0, sum(gaps) / len(gaps) if gaps else 0))

    payload = "\n".join(res) + "\n"
    io.open(OUT, "w", encoding="utf-8").write(payload)
    # 同时生成前端直接引用的 JS 数据（script 标签不受 file:// 的 CORS 限制）。
    # 用 window 赋值而不是 const：切歌时重复注入同一脚本不会撞声明，
    # 前端在加载前 delete window.LRC_WORD_TEXT 即可拿到新数据。
    js = os.path.splitext(OUT)[0] + ".js"
    io.open(js, "w", encoding="utf-8").write(
        "/* 由 asr_align.py 生成：逐字歌词（Enhanced LRC / A2） */\n"
        "window.LRC_WORD_TEXT = `" + payload.replace("`", "\\`") + "`;\n")
    print(f"输出 → {OUT}\n输出 → {js}\n")
    print(f"{'字数':>4} {'最大间隔':>8} {'平均间隔':>8}")
    for n, mx, av in stats:
        print(f"{n:>4} {mx:>8.2f} {av:>8.2f}")


if __name__ == "__main__":
    main()
