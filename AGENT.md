# AGENT — 使用提示（给 AI agent）

你拿到的是一个**可运行的「黑胶放映室」模板**：纯 HTML / CSS / 原生 JS，无构建、无依赖、无框架。
默认自带一首示例曲《雪落》（本地 AI 生成的原创音频 / 封面 / 歌词），打开就能跑。

你的任务通常是：**按用户给的歌替换内容**，或**在模板基础上做视觉/交互调整**。

---

## 0. 先读这三个文件（按顺序）

1. `TEMPLATE.md` —— 换歌 / 换图 / 加轨的全部字段说明
2. `config.js` —— 唯一需要常规修改的文件
3. `js/main.js` 顶部的分节注释 —— 改逻辑前先看它分成哪几块

## 1. 快速开始（每次改完都要做）

```bash
python serve.py            # 默认 8000；或 python serve.py 8011
# 打开 http://127.0.0.1:8000/
```

- 想直接双击 `index.html`（`file://`）也可以，但**声谱可视化会被浏览器安全策略屏蔽**，
  程序会自动进「直开模式」（声音正常、可视化合成）。要验证实时声谱必须走 `serve.py`。
- 无依赖、无 npm、无构建：**不要**在这个工程里跑 `npm install`，也不要引入框架。

## 2. 任务 A：换歌（最常见）

1. 把 `mp3` 放进 `assets/`，在 `config.js` 对应曲目改 `audio`。
2. 把封面放进 `assets/`，在 `themes` 里填 `cover`（+ `accent` / `accentHi` / `bg`）。
3. 歌词：
   - 有句级 LRC：直接写进 `lyrics` 字段，或放成文件用 `lyricsFile` / `lyricsUrl`。
   - 要逐字卡拉 OK：见任务 B。
4. 调 `sections`（段落时间点 + 视觉强度 `fx`），不需要就 `[]`。
5. 改 `title / titleEn / artist / version / number / duration`。

> 只改 `config.js`，不要改 HTML / CSS / JS 的骨架。

## 3. 任务 B：生成逐字歌词（逐字卡拉 OK）

模板卖点是逐字点亮，数据格式是 **Enhanced LRC / A2**：
`[行首]<字首>字<字首>字…`

```bash
# 1) 把句级 LRC 放到 assets/（例如 assets/lyrics-xxx-line.lrc）
# 2) 生成（faster-whisper 词级时间戳 + LRC 对齐，约 2 分钟，需 ffmpeg）
python research/asr_align.py
# → 输出 assets/lyrics-kimono.lrc + assets/lyrics-kimono.js
# 3) config.js 的 lyricsFile 指向生成的 .js
```

已有 faster-whisper 词级 JSON（`*.lrc.asr.json`）时**直接复用**，省掉重新转写：

```bash
VINYL_LRC=assets/lyrics-xxx-line.lrc \
VINYL_OUT=assets/lyrics-xxx.lrc \
VINYL_ASR_JSON=/abs/path/xxx.lrc.asr.json \
python research/asr_align.py
```

没有 GPU / 不想跑模型：`python research/onset_align.py`（零下载 onset 版，精度略低）。

**注意**：生成的 JS 必须用 `window.LRC_WORD_TEXT = \`…\`;` 赋值（不能是 `const`），
否则切轨重复注入会撞声明。脚本已经这么输出。

## 4. 任务 C：加第二首（多轨切轨）

在 `config.js` 的 `tracks` 数组里再放一项完整配置即可，控制栏会出现 ‹ ›，
键盘 `[` / `]` 也可切。只有一首时切轨按钮自动隐藏。

- 切轨行为：暂停旧轨 → 换元数据 / 歌词 / 音轨 → 正在播就自动接着播。
- 主题记忆是全局的：新曲目有同 id 主题就沿用，否则退回它的第一套。

## 5. 任务 D：视觉 / 交互调整

- **主题**：`themes` 里改 `accent` / `accentHi` / `cover` / `bg` / `bgImage` / `particles`。
- **粒子种类**：`particles` = `embers`（餘燼+墨滴）| `caustic`（氣泡）| `snow`（落雪）；
  主题间用 `themeMix`（0→1→2）连续淡入淡出。
- **节拍脉冲**：`js/main.js` 里搜 `dPulse`（盘体胀缩）、`唱片光晕`（`glow`）、`S.beat` 衰减。
- **间奏卡**：搜 `isBreak`。判据是「本句人声结束 + 距下一句 >4s 静默」，
  改阈值要谨慎——太松会让长句后半段被误判成间奏。
- **竖屏构图**：`css/style.css` 里 `@media (max-width:1080px)`。
- **调试面板**：`` ` `` 键开关（`Esc` 关闭），实时调背景亮度 / 暗角 / 粒子数量·尺寸·速度·形态，
  值存 `localStorage`，附 fps 与播放秒数。只存在于交互模式，渲染模式自动不出现——**不要**在渲染模式依赖它。

## 5b. 任务 E：渲染成视频

模板自带确定性渲染模式（`renderAt` / `__ready` / `DUR`），不要改成实时动画再录屏。
出片需要同契约的外部单文件 HTML 渲染器（**本模板不含**）：

```bash
# 1) 离线能量（换歌 / 换 fps 后必须重算）
python research/render_energy.py assets/<歌>.mp3 --fps 30 --out assets/energy.js
# 2) 用兼容契约的渲染器：注入 __RENDER_MODE__ → 等 __ready → 逐帧 renderAt(t) 截图 → ffmpeg 合成
#    JPEG 截帧更快，可流式喂 ffmpeg 不落盘；混音用 apad 补静音
# 3) 校验：死动效 / 空画布 / 控制台报错
```

要点：
- 时长自动取音轨 metadata（+2s 尾声），**歌变长变短都会录完整**，不用手改。
- 渲染模式会 **seek + pause** 所有 CSS 动画到虚拟时钟，这是「双渲染 SHA 一致」的前提，别删。
- 渲染模式的音频能量来自 `assets/energy.js`；缺了它频谱会退回静置微光。

## 6. 硬规则（不要破坏）

- **无构建、无依赖**：不装包、不引框架、不改造成 SPA。
- **素材路径一律相对**（`assets/…`），不要写绝对路径 / 指向外部仓。
- **不要动帧调度**：`tick()` + `schedule()` 的 rAF 看门狗降级逻辑，
  以及 `resize` / `transitionend` 的重算，是动画不中断的关键。
- **确定性来源**：播放进度来自动音频时钟，不用 `requestAnimationFrame` 直接推进内容。
- **素材**：内置示例素材随模板提供（本地 AI 原创，见 ATTRIBUTION.md）；只有模型缓存 `research/fw-small/` 不入库。
- **版权**：默认素材是本地 AI 生成的原创，可公开；换成真实歌曲 / 封面时，
  确认你有授权，且**不要**把真实音源提交进公开仓库。

## 7. 验收清单（改完逐项过）

- [ ] `python serve.py` 能起，控制台无报错
- [ ] 进场 → 点击播放 → 唱片抽出并恒速旋转
- [ ] 逐字歌词按时间点亮（不是整行同时亮）
- [ ] 段落切换有冲击；间奏卡只在长静默出现（长句不误判）
- [ ] 主题按钮切换正常，粒子连续过渡；`localStorage` 记忆生效
- [ ] 多轨时 ‹ › / `[` `]` 切轨，标题 / 歌词 / 音轨都换，正在播会自动续播
- [ ] 竖屏（≤1080px）构图正常
- [ ] 进度条拖拽、空格 / 方向键、`R` 重播
- [ ] 结尾致谢卡 + 「再听一次」

## 8. 可直接复制给 agent 的提示词

```
你在一个「Vinyl Session 黑胶放映室」模板工程里（纯 HTML/CSS/JS，无构建）。
先读 AGENT.md 与 TEMPLATE.md，再读 config.js。
任务：把当前示例曲换成下面这首——
  歌名：<title>  英文：<titleEn>  歌手：<artist>  编号：<number>
  音频：<path>   封面：<path>   句级歌词：<path 或文本>
要求：
1) 只改 config.js（需要新主题/粒子可在 themes 里加），骨架 HTML/CSS/JS 尽量不动；
2) 如果要逐字卡拉 OK，用 research/asr_align.py 生成 A2 数据，已有 ASR json 就用 VINYL_ASR_JSON 复用；
3) 改完跑 python serve.py，自己开浏览器逐段检查：逐字点亮、段落、间奏、主题、切轨、竖屏；
4) 不要引入依赖、不要写死绝对路径、不要提交真实音源。
```
