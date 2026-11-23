# STATUS —— 当前状态记录

> 最后更新：2026-11-22

## 这套东西是什么

「Vinyl Session 黑胶放映室」公开模板：纯 HTML/CSS/JS 的唱片播放代码动画，
逐字卡拉 OK、多轨切轨、三主题三粒子、实时声谱，且**可确定性渲染成视频**。

## 已完成

- **模板本体**：`index.html` / `css/style.css` / `js/main.js` / `config.js` / `serve.py`
- **换歌只改 config.js**：多轨、主题（封面 + 主色 + 背景定位 + 粒子）、段落
- **逐字歌词**：`research/asr_align.py`（faster-whisper 对齐）/ `onset_align.py`（零下载）
- **渲染管线**：
  - `research/render_energy.py` → `assets/energy.js`（离线音频能量包络）
  - 页面渲染模式：`renderAt(t)` / `__ready` / `DUR`，虚拟时钟 + 种子随机 + CSS 动画 seek/pause
  - 出片用同契约的外部单文件 HTML 渲染器（本模板不含）：逐帧截图 → ffmpeg，JPEG 截帧更快，混音用 apad 补静音
  - **双渲染 SHA-256 一致**（确定性验收通过）
- **文档**：README / TEMPLATE（换歌）/ AGENT（给 AI agent 的使用提示 + 提示词）/ LICENSE（MIT）/ ATTRIBUTION
- **调试面板**（2026-11-22）：`` ` `` 键开关、`Esc` 关闭；背景亮度 / 暗角 / 粒子数量·尺寸·速度·形态，
  localStorage 持久化 + fps/秒数状态行；仅交互模式，渲染模式从 DOM 移除
- **主题固定参数**（2026-11-22）：`?theme=<id>` 优先于 localStorage 记忆，用于固定主题 / 批量出片。
  已按 `?theme=shiro|sumi|arashi` 渲染横屏 1920×1080 与竖屏 1080×1920 各三条（30fps / 184s / 带音频）到 `out/`

## 已知取舍 / 待办

- **渲染模式的歌词换行是瞬跳**：CSS 过渡被冻结（否则画面不可复现）。要滑动需把滚动改 JS 驱动。
- **节拍脉冲已改为 BPM 网格**（2026-11-20）：有 `bpm` 时按 `60/bpm` 规则踩点、强度随低频能量，
  网页与视频共用同一套（示例曲标定 67 BPM / 相位 0.152s，由 `render_energy.py` 自动标定）；
  没有 `bpm` 的曲目退回 onset 检测。
- **素材已入库**：`assets/` 下的 mp3 / png 均为本地 AI 生成原创（见 ATTRIBUTION.md），随模板一起分发；
  只有模型缓存 `research/fw-small/` 被 gitignore。

## 最近一轮视觉调整（2026-11-20）

- 频谱环加强：加暗色衬底、柱长 `.22→.30`、竖屏 `.20→.27`（浅封面上看得见）
- 唱片：标签 `84%→90%`，碟体内阴影 `.7→.42`，套筒投影 `55px→38px`
- `.tt__disc` 的 `box-shadow` 已整条移除（用户要求）
- 已移除「爆豆」黑胶噪声（Web Audio 合成）功能

## 复现命令

```bash
# 交互预览
python serve.py                       # → http://127.0.0.1:8000/

# 离线能量（换歌 / 换 fps 后重算）
python research/render_energy.py assets/kimono-sad.mp3 --fps 30 --out assets/energy.js

# 出片（1080p / 30fps / 带音频）：需同契约的外部渲染器（本模板不含）
# 注入 __RENDER_MODE__ → 等 __ready → 逐帧 renderAt(t) 截图 → ffmpeg 合成
```
