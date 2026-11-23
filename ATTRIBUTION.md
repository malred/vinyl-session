# 素材来源

## 代码

MIT，见 [LICENSE](LICENSE)。

## 内置示例素材（可公开）

模板自带的示例内容均为**本地 AI 生成的原创素材**，不含第三方版权内容：

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `assets/kimono-sad.mp3` | 示例曲《雪落》音轨 | 本地 AI 音乐生成 |
| `assets/lyrics-kimono*.lrc / .js` | 示例曲歌词（句级 + 逐字） | 本地 AI 生成歌词，逐字时间轴由 `research/asr_align.py` 对齐 |
| `assets/energy.js` | 渲染用离线能量包络 | 由 `research/render_energy.py` 从示例音轨计算生成 |
| `assets/pal-c02-white.png` | 封面 + 背景（白） | 本地 AI 图像生成 |
| `assets/cover-kimono.png` | 封面（墨） | 本地 AI 图像生成 |
| `assets/cover-caustic.png` | 封面（岚） | 本地 AI 图像生成 |

换成你自己的素材时，请确认你拥有相应授权；**不要**把未授权的真实音源 / 封面提交进公开仓库。

## 第三方字体（仅在前端 CDN 引用）

`index.html` 通过 Google Fonts 引用：Noto Serif SC、Cormorant Garamond、IBM Plex Mono。
这些字体分别受其自身许可约束（多为 SIL OFL），打包再分发时需一并遵守。
离线使用时可把字体下载到本地并改 `index.html` 的 `@font-face`。

## 工具

`research/` 下的对齐脚本依赖 `faster-whisper` / `numpy` / `ffmpeg`（按需），
这些依赖有其各自的许可，仅在你运行时安装，不随模板再分发。
