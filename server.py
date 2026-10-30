"""奶龙模仿挑战 —— 本地静态服务器。

浏览器摄像头只能在 localhost / https 下使用，所以不要直接双击 index.html，
请通过 start.ps1（或 python server.py）打开本页。
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = int(os.environ.get("NAILONG_PORT", "8899"))
HOST = "127.0.0.1"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
    }

    def end_headers(self) -> None:
        path = self.path.split("?")[0]
        if path.startswith("/vendor/") or path.startswith("/models/"):
            # 模型和 wasm 共约 20MB，允许浏览器缓存，刷新时不用重新下载。
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        # MediaPipe 的 JS 包里带有性能遥测端点 odml.pa.googleapis.com；
        # 这里用 CSP 把网络连接限制在本机，画面和指标都不会发出去。
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'wasm-unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            "connect-src 'self'; "
            "worker-src 'self' blob:; "
            "font-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "form-action 'none'; "
            "frame-ancestors 'none'",
        )
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        if self.path.split("?")[0] == "/api/health":
            payload = json.dumps(
                {"ok": True, "app": "nailong-laugh-challenge", "time": time.time()}
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(
            "[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args)
        )


def find_port(preferred: int, attempts: int = 20) -> int:
    for port in range(preferred, preferred + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((HOST, port))
            except OSError:
                continue
            return port
    raise SystemExit(f"端口 {preferred}~{preferred + attempts - 1} 都被占用了。")


def main() -> None:
    port = find_port(DEFAULT_PORT)
    handler = partial(Handler, directory=str(ROOT))
    server = ThreadingHTTPServer((HOST, port), handler)
    url = f"http://{HOST}:{port}/"
    print("=" * 52)
    print("  奶龙模仿挑战 已启动")
    print(f"  请在浏览器打开: {url}")
    print("  按 Ctrl+C 停止")
    print("=" * 52)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("\n已停止。")


if __name__ == "__main__":
    main()
