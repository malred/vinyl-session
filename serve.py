#!/usr/bin/env python3
"""本地 Range 播放服务器 —— 让 HTML 页里的音频/视频进度条可以精确拖拽。

用法：
    python serve-range.py [端口]        # 默认 8000

相比 `python -m http.server`，这里支持 HTTP Range（<audio>/<video> seek 需要）。
直接双击 index.html（file://）同样可以正常播放与拖拽，但没有进度条 seek。

权威源：scripts/serve-range.py；消费工程的 serve.py 是它的 vendor 副本
（node scripts/vendor-web-kit.mjs 再生成 / --check 漂移检查）。
"""
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class _Limited:
    """把文件对象截断到指定长度，用于返回 206 的部分内容。"""

    def __init__(self, fh, length):
        self._fh = fh
        self._left = length

    def read(self, size=-1):
        if self._left <= 0:
            return b""
        if size is None or size < 0 or size > self._left:
            size = self._left
        data = self._fh.read(size)
        self._left -= len(data)
        return data

    def close(self):
        self._fh.close()


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        range_header = self.headers.get("Range")
        path = self.translate_path(self.path)
        if range_header and os.path.isfile(path):
            match = re.match(r"bytes=(\d*)-(\d*)", range_header.strip())
            if match:
                try:
                    size = os.path.getsize(path)
                    start = int(match.group(1)) if match.group(1) else 0
                    end = int(match.group(2)) if match.group(2) else size - 1
                    if start >= size:
                        raise ValueError("range start out of bounds")
                    end = min(end, size - 1)
                    length = end - start + 1
                    fh = open(path, "rb")
                    fh.seek(start)
                    self.send_response(206)
                    self.send_header("Content-Type", self.guess_type(path))
                    self.send_header("Content-Range",
                                     "bytes %d-%d/%d" % (start, end, size))
                    self.send_header("Content-Length", str(length))
                    self.end_headers()
                    return _Limited(fh, length)
                except Exception:
                    pass
        return super().send_head()

    def log_message(self, fmt, *args):
        pass  # 保持控制台安静


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), RangeHandler) as httpd:
        print("vinyl-session Range server → http://127.0.0.1:%d/" % PORT)
        print("按 Ctrl+C 停止。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
