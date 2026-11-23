# 换歌 / 换图 / 加轨

**只改 `config.js` 一个文件**，其余（HTML / CSS / JS）都不用动。

```js
window.TEMPLATE_CONFIG = {
  // 多轨：每一首都是完整一项；只有一首时就是单轨（切轨按钮自动隐藏）
  tracks: [
    {
      title: '雪落',              // 歌名（进场会逐字浮现，任意字数）
      titleEn: 'SNOW FALLS AGAIN',// 英文副标题，可留空 ''
      artist: 'NOCTCODE',
      version: '',                // 可留空
      number: '0094',             // 编号，出现在角标 / 结尾
      duration: 181.8,            // 可选：metadata 到达前显示的总时长
      bpm: 67,                    // 可选：节拍网格用；缺省则退回 onset 检测
      beatPhase: 0.152,           // 网格相位（秒），由 research/render_energy.py 自动标定
      audio: 'assets/kimono-sad.mp3',

      // 歌词：数据文件路径写进 lyricsFile（script 注入，file:// 也能用）
      lyricsFile: 'assets/lyrics-kimono.js',
      lyricsUrl: '',              // 可选：http 下优先 fetch 这个 .lrc
      lyrics: '',                 // 兜底：直接内嵌一段文本

      // 主题：想加几套加几套，封面 + 主色即可（高光 / 光晕会自动派生）
      // particles 选 'embers'(餘燼+墨滴) | 'caustic'(氣泡) | 'snow'(落雪)
      // bgImage 可选：只换背景插画，唱片 / 方盒仍用 cover
      themes: [
        { id:'shiro',  label:'白', accent:'#e8e4da', accentHi:'#ffffff',
          cover:'assets/pal-c02-white.png', bgImage:'assets/pal-c02-white.png',
          bg:'50% 58%', particles:'snow' },
        { id:'sumi',   label:'墨', accent:'#e23a4b', accentHi:'#ff7a6a',
          cover:'assets/cover-kimono.png',  bg:'62% 26%', particles:'embers' },
        { id:'arashi', label:'岚', accent:'#4fd8e8', accentHi:'#9df0f8',
          cover:'assets/cover-caustic.png', bg:'50% 38%', particles:'caustic' },
      ],

      // 段落：切换视觉强度 + 段落冲击；不需要就写 []
      sections: [ { t: 0, label: '序章', fx: .45 }, … ],
    },
    { title: '下一首', … },   // 第二首：‹ › 就有的切了
  ],
};
```

## 换歌三步

1. 把 mp3 放进 `assets/`，改 `audio`。
2. 把封面放进 `assets/`，在 `themes` 里填路径 + 主色。
3. 把歌词数据文件放进 `assets/`，改 `lyricsFile`（**只换文件，不动 config 其它内容**）。

歌词文件两种写法（文件名随意，只要路径对）：

- **逐字数据**（推荐）：一个 JS 文件，内容为
  `window.LRC_WORD_TEXT = \`[00:15.74]<00:15.74>你<00:16.56>走…\`;`
  —— `research/asr_align.py` 直接生成这个格式。用 `window.` 赋值而不是 `const`，
  切轨时重复注入不会撞声明（前端在加载前会 `delete window.LRC_WORD_TEXT`）。
- **句级 LRC**：`[00:15.74] 你走后的夜特别长`，字会在行内均分。
  直接把 `.lrc` 内容粘进 `lyrics` 字段也行（适合临时试）。

## 逐字卡拉 OK 怎么来

```bash
# 1) 句级 LRC 放到 assets/（如 assets/lyrics-kimono-line.lrc）
# 2) 生成逐字数据（faster-whisper 强制对齐，约 2 分钟）
python research/asr_align.py        # → assets/lyrics-kimono.lrc + .js
# 3) config.js 里 lyricsFile 指向它
```

已有 faster-whisper 词级输出 `*.lrc.asr.json` 时可直接复用，跳过重新转写：

```bash
VINYL_LRC=assets/lyrics-kimono-line.lrc \
VINYL_OUT=assets/lyrics-kimono.lrc \
VINYL_ASR_JSON=/path/to/xxx.lrc.asr.json \
python research/asr_align.py
```

没有 GPU / 不想跑模型：`python research/onset_align.py`（零下载 onset 版，精度略低）。

## 节拍脉冲

唱片按节拍脉冲（盘体胀缩 + 光晕 + 涟漪 + 迸发粒子）。判拍两种模式：

- **有 `bpm`**：按 `60/bpm` 的规则网格踩点，每拍强度由低频能量决定（保底很轻，强拍才放迸发粒子）——稳、踩点。
- **没有 `bpm`**：退回低频 onset 检测（跟能量走，可能成簇/留空）。

`bpm` / `beatPhase` 可由 `research/render_energy.py` 自动标定（输出里的 `网格 bpm=… phase=…`），把这两个值填进 config 即可。

## 说明

- `bg` 是背景插画定位（`background-position`），竖屏 / 桌面共用；封面与背景用同一张没问题。
- 只写一个 theme 时，右上角主题按钮自动隐藏。
- `sections` 留空 `[]` 就完全没有段落标签 / 切换冲击。
- 主题选择存在 `localStorage`；切轨时同 id 主题沿用，没有则退回该曲第一套。
- 间奏卡只在「本句人声已结束 + 距下一句还有 >4s 静默」时出现，长句不会被误判。
- `file://` 直开可用，但声谱可视化会被浏览器安全策略屏蔽（自动进「直开模式」）；
  要完整效果跑 `python serve.py`。
