# research —— 逐字歌词时间轴 + 离线渲染能量

把句级 LRC 变成逐字卡拉 OK 数据（Enhanced LRC / A2：`[行首]<字首>字<字首>字…`）。

## asr_align.py（推荐）

用 faster-whisper 的词级时间戳 + 句级 LRC 做 `difflib` 对齐，再最小字间隔 / 均摊后处理。
需要 `faster-whisper`、`numpy`、`ffmpeg`。

```bash
# 用默认路径（assets/kimono-sad.mp3 + assets/lyrics-kimono-line.lrc）
python research/asr_align.py

# 已有 faster-whisper 词级 JSON 时直接复用，跳过重新转写
VINYL_LRC=assets/lyrics-xxx-line.lrc \
VINYL_OUT=assets/lyrics-xxx.lrc \
VINYL_ASR_JSON=/abs/path/xxx.lrc.asr.json \
python research/asr_align.py
```

输出两个文件：`<OUT>.lrc`（可读）与同名 `.js`（`window.LRC_WORD_TEXT = \`…\`;`，前端 `lyricsFile` 指向它）。

## onset_align.py（零下载兜底）

只用 `numpy` / `ffmpeg`，用人声 onset（谱通量峰值）给每个字分配起点，精度略低。

```bash
python research/onset_align.py
```

## render_energy.py —— 渲染模式的音频能量

交互模式可视化靠 Web Audio 实时 FFT；逐帧出片要求画面可复现，实时 FFT 不可用。
这个脚本把同一套频段能量提前算好写成 `assets/energy.js`，渲染时查表：

```bash
python research/render_energy.py assets/kimono-sad.mp3 --fps 30 --out assets/energy.js
# 看分布与节拍数，不写文件
python research/render_energy.py assets/kimono-sad.mp3 --stats
```

输出 `window.ENERGY = { fps, dur, bpm, phase, bass[], mid[], high[], beat[] }`。
其中 `bpm` / `phase` 是在低频段能量上扫出来的最踩点规则网格（对比度最高），
把这两个值填进 `config.js` 的 `bpm` / `beatPhase`，网页和视频就会按拍脉冲。
换了歌 / 换了 fps 都要重跑一次。

## 说明

- 模型默认下载到 `research/fw-small/`（已 gitignore）。设 `WHISPER_MODEL=small|base|…` 换模型。
- 生成的 JS 必须用 `window.` 赋值：切轨时前端会重复注入，`const` 会撞声明。
- 逐字数据缺失时，前端会自动退回句级均分（行内均匀点亮）。
