"""Serve only public game assets; never expose deployment config or local tokens."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes
import argparse
import re

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = {"/" + name: ROOT / name for name in
          ["index.html", "style.css", "game.js", "fonts/ArchitectsDaughter.woff2", "music/LICENSE.txt"]}
PUBLIC["/"] = ROOT / "index.html"
PUBLIC.update({"/audio/" + file.name: file for file in (ROOT / "audio").glob("*.m4a")})

PUBLIC.update({"/music/" + file.name: file for file in (ROOT / "music").glob("*.m4a")})


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve(True)

    def do_HEAD(self):
        self.serve(False)

    def serve(self, body):
        file = PUBLIC.get(urlsplit(self.path).path)
        if not file or not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        # Safari only plays <audio> from servers that answer byte-range requests.
        status, total, span = 200, len(data), re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if span and (span.group(1) or span.group(2)):
            start = int(span.group(1)) if span.group(1) else max(0, total - int(span.group(2)))
            end = min(int(span.group(2)), total - 1) if span.group(1) and span.group(2) else total - 1
            if start > end:
                self.send_error(416)
                return
            status, data = 206, data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, start + len(data) - 1, total))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5174)
    args = parser.parse_args()
    print("Game preview: http://127.0.0.1:" + str(args.port), flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
