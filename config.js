/* ═══════════════════════════════════════════════════════════
   VINYL SESSION —— 模板配置：换歌 / 换图只改这一个文件
  ───────────────────────────────────────────────────────────
  多轨：tracks 里每一首都是完整一项，控制栏有 ‹ › 可切上一首/下一首。
  只有一首时就是单轨（写法完全一样，切轨按钮会自动隐藏）。

  每一首需要：
    1) mp3 放进 assets/，改 audio
    2) 封面放进 assets/，在 themes 里加/改一项（封面 + 主色 + 背景定位）
    3) 歌词：把数据文件路径写进 lyricsFile（script 注入，file:// 也行）
       或改用 lyricsUrl 指向 .lrc（http 下优先 fetch）
    4) sections 可留空 [] —— 那样就没有段落标签与切换冲击
  ═══════════════════════════════════════════════════════════ */
window.TEMPLATE_CONFIG = {
  "tracks": [
    {
      "title": "雪落",
      "titleEn": "SNOW FALLS AGAIN",
      "artist": "NOCTCODE",
      "version": "",
      "number": "0094",
      "duration": 181.8,               // 仅用于 metadata 到达前显示总时长
      "bpm": 67,                       // 节拍网格用；缺省则退回 onset 检测
      "beatPhase": 0.152,              // 网格相位（秒），由 research/render_energy.py 标定
      "audio": "assets/kimono-sad.mp3",
      "lyricsFile": "assets/lyrics-kimono.js",
      "lyricsUrl": "",
      "lyrics": "",
      "themes": [
        {
          "id": "shiro",
          "label": "白",
          "accent": "#e8e4da",
          "accentHi": "#ffffff",
          "cover": "assets/pal-c02-white.png",
          "bgImage": "assets/pal-c02-white.png",
          "bg": "50% 58%",
          "particles": "snow"
        },
        {
          "id": "sumi",
          "label": "墨",
          "accent": "#e23a4b",
          "accentHi": "#ff7a6a",
          "cover": "assets/cover-kimono.png",
          "bg": "62% 26%",
          "particles": "embers"
        },
        {
          "id": "arashi",
          "label": "岚",
          "accent": "#4fd8e8",
          "accentHi": "#9df0f8",
          "cover": "assets/cover-caustic.png",
          "bg": "50% 38%",
          "particles": "caustic"
        }
      ],
      "sections": [
        { "t": 0,      "label": "序章 · 钢琴",       "fx": 0.45 },
        { "t": 15.74,  "label": "主歌 · 雪夜",       "fx": 0.60 },
        { "t": 31.56,  "label": "预副歌 · 如果那天", "fx": 0.75 },
        { "t": 38.06,  "label": "副歌 · 雪落",       "fx": 1 },
        { "t": 62.21,  "label": "主歌 · 茶还温着",   "fx": 0.60 },
        { "t": 78.38,  "label": "预副歌 · 如果时光", "fx": 0.75 },
        { "t": 84.64,  "label": "副歌 · 雪落",       "fx": 1 },
        { "t": 107.46, "label": "桥段 · 若有来生",   "fx": 0.82 },
        { "t": 124.02, "label": "终段 · 雪又落",     "fx": 1 },
        { "t": 162.08, "label": "尾声 · 钢琴",       "fx": 0.25 }
      ]
    }
  ]
};
