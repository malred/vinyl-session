# Vinyl Session — 黑胶放映室

一个**唱片播放代码动画**模板：一台会呼吸的黑胶唱机 + 一部逐字点亮的歌词字幕机。
纯 HTML / CSS / 原生 JS，**无构建、无依赖**，克隆下来就能跑。

- 逐字卡拉 OK 歌词（Enhanced LRC / A2）
- 多轨：控制栏 ‹ › 或 `[` `]` 切上一首 / 下一首
- 三套主题（白 / 墨 / 岚）与三种粒子（落雪 / 餘燼 / 氣泡），切换时连续淡入淡出
- 实时声谱、节拍脉冲、涟漪与迸发粒子（Web Audio）
- 桌面 / 竖屏两套构图，`prefers-reduced-motion` 友好

内置一首示例曲《雪落》（音频 / 封面 / 歌词均为本地 AI 生成的原创素材），
换歌只需改一个文件，见 [TEMPLATE.md](TEMPLATE.md)。给 AI agent 的使用说明见 [AGENT.md](AGENT.md)。

## 快速开始

```bash
# 方式一（推荐）：带 Range 的本地服务器，进度条可精确拖拽
python serve.py            # → http://127.0.0.1:8000/

# 方式二：直接双击 index.html（file:// 也能放，声谱可视化会退化为合成驱动）
```

操作：点画面 = 播放/暂停；`空格` 播放暂停；`←` `→` 快退快进 5s；`R` 重播；
`[` `]` 切轨；鼠标动一下唤出控件，2.6s 无操作自动隐藏。

调试面板：`` ` `` 键开关（`Esc` 关闭），可实时调**背景亮度 / 暗角 / 粒子数量·尺寸·速度·形态**，
值存 `localStorage`，附 fps 与播放秒数。**仅交互模式可用，渲染模式不出现**（不会穿帮进视频）。

## 目录

```
config.js     唯一需要改的文件：曲目 / 主题 / 段落
index.html    结构与舞台
css/style.css 视觉系统（令牌、关键帧）
js/main.js    LRC 解析 / 唱机物理 / 卡拉 OK / 可视化 / 编排 / 切轨
serve.py      支持 HTTP Range 的本地服务器
assets/       音频 / 封面 / 歌词数据
research/     逐字歌词时间轴生成器（faster-whisper / onset）
```

## 换歌 / 换图 / 加轨

只改 `config.js`，详见 [TEMPLATE.md](TEMPLATE.md)。

固定主题：URL 加 `?theme=<id>`（如 `index.html?theme=sumi`），优先级高于 localStorage 记忆，
方便分享链接，也是按主题渲染视频的方式。

## 渲染成视频

模板带**确定性渲染模式**：时间轴由 `renderAt(t)` 驱动，音频能量来自离线预计算，
画面可逐帧复现（两次渲染 SHA 一致）。出片需要一个实现下列契约的外部单文件 HTML 渲染器
（**本模板不含渲染器**，需自备或自写）：

- 渲染前注入 `window.__RENDER_MODE__ = true`，页面即进入确定性模式
- 等 `window.__ready === true`，逐帧调用 `window.renderAt(t)`（虚拟秒）并截图
- 总时长读 `window.DUR`

准备能量（换歌 / 换 fps 后要重算）：

```bash
python research/render_energy.py assets/kimono-sad.mp3 --fps 30 --out assets/energy.js
```

- 时长不用手写：页面从音轨 metadata 读真实时长，再加 2s 尾声（`window.DUR`）。
  **换一首更长的歌，会自动录完整**。
- 逐帧截图建议用 JPEG（比 PNG 快一个量级）；截图直接喂 ffmpeg 可以完全不落盘。
- 混音时给音轨补静音（`apad`），否则画面尾部的致谢卡会被按时长裁掉。
- 渲染模式会 seek + pause 所有 CSS 动画到虚拟时钟，这是「双渲染 SHA 一致」的前提，别删。

## 许可

代码：MIT，见 [LICENSE](LICENSE)。
素材：音频、封面、歌词均为本地 AI 生成的原创内容，见 [ATTRIBUTION.md](ATTRIBUTION.md)。
换成你自己的素材时，请自行确认授权。
