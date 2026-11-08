"""Frame Studio local server: serves the editor page and keeps the outbox.

  python server.py --port 48123 --workdir <session dir>

GET  /              the editor (editor.html beside this file)
GET  /api/ping      {"ok": true}
POST /api/send      {instruction, mode, canvas:{width,height}, frames:[{ms, png, shapes}], sheet, summary}
                    writes <workdir>/.frame-studio/<stamp>/ and queues a prompt
GET  /api/outbox    the queued prompts, oldest first
POST /api/ack       {"ids": [...]} removes delivered prompts
Binds 127.0.0.1 only. Standard library; Pillow (optional) adds the GIF.
"""
import argparse
import base64
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
WORKDIR = os.getcwd()
pending = []
lock = threading.Lock()


def data_url_bytes(url):
    if not isinstance(url, str) or not url.startswith("data:"):
        return None
    return base64.b64decode(url.split(",", 1)[1])


def make_gif(frame_paths, durations, out_path, size):
    try:
        from PIL import Image
    except ImportError:
        return None
    images = []
    for p in frame_paths:
        im = Image.open(p).convert("RGB")
        if size and im.size != tuple(size):
            im = im.resize(tuple(size), Image.LANCZOS)
        images.append(im)
    if len(images) < 2:
        return None
    images[0].save(out_path, save_all=True, append_images=images[1:], duration=durations, loop=0, disposal=2)
    return out_path


def handle_send(req):
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out = os.path.join(WORKDIR, ".frame-studio", stamp)
    os.makedirs(out, exist_ok=True)
    frames = req.get("frames", [])
    canvas = req.get("canvas", {})
    frame_paths, durations = [], []
    for i, fr in enumerate(frames, 1):
        png = data_url_bytes(fr.get("png"))
        if png is None:
            continue
        path = os.path.join(out, "frame_%02d.png" % i)
        with open(path, "wb") as f:
            f.write(png)
        frame_paths.append(path)
        durations.append(int(fr.get("ms", 500)))
    sheet_path = None
    sheet = data_url_bytes(req.get("sheet"))
    if sheet:
        sheet_path = os.path.join(out, "sheet.png")
        with open(sheet_path, "wb") as f:
            f.write(sheet)
    # images that were pasted in: saved beside, their data replaced by the file name
    scene = {"canvas": canvas, "frames": []}
    n_img = 0
    for fr in frames:
        shapes = []
        for s in fr.get("shapes", []):
            s = dict(s)
            img = data_url_bytes(s.pop("img", None))
            if img is not None:
                n_img += 1
                name = "img_%02d.png" % n_img
                with open(os.path.join(out, name), "wb") as f:
                    f.write(img)
                s["src"] = name
            shapes.append(s)
        scene["frames"].append({"ms": fr.get("ms", 500), "shapes": shapes})
    with open(os.path.join(out, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False, indent=1)
    gif_path = None
    if len(frame_paths) > 1:
        size = (int(canvas.get("width", 0)), int(canvas.get("height", 0))) if canvas.get("width") else None
        try:
            gif_path = make_gif(frame_paths, durations, os.path.join(out, "anim.gif"), size)
        except Exception as exc:  # the GIF is a bonus
            print("gif failed:", exc, file=sys.stderr)

    fwd = lambda p: p.replace("\\", "/")
    lines = [req.get("instruction", "").strip(), "", "---"]
    lines.append("[Frame Studio で作った絵: %d フレーム、キャンバス %s×%s px、PNG は 2 倍解像度]" % (
        len(frame_paths), canvas.get("width", "?"), canvas.get("height", "?")))
    if sheet_path:
        lines.append("- 全フレーム一覧: " + fwd(sheet_path))
    if len(frame_paths) == 1:
        lines.append("- 画像: " + fwd(frame_paths[0]))
    elif frame_paths:
        lines.append("- 各フレーム: " + " , ".join(fwd(p) for p in frame_paths))
    if gif_path:
        lines.append("- アニメーション GIF: " + fwd(gif_path))
    lines.append("- 図形データ (JSON): " + fwd(os.path.join(out, "scene.json")))
    lines.append("画像は Read ツールで開いて内容を確認してから対応してください。")
    summary = req.get("summary", "")
    if summary:
        lines += ["", "図形の概要（座標はキャンバス上の px）:", summary]
    item = {"id": uuid.uuid4().hex, "mode": req.get("mode", "submit"), "text": "\n".join(lines), "dir": out}
    with lock:
        pending.append(item)
    return {"ok": True, "dir": out, "gif": gif_path, "frames": frame_paths}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "editor.html"), "rb") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")
        if path == "/api/ping":
            return self._send(200, {"ok": True, "workdir": WORKDIR})
        if path == "/api/outbox":
            with lock:
                return self._send(200, list(pending))
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        try:
            req = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except ValueError:
            return self._send(400, {"ok": False, "error": "bad json"})
        try:
            if path == "/api/send":
                return self._send(200, handle_send(req))
            if path == "/api/ack":
                ids = set(req.get("ids", []))
                with lock:
                    pending[:] = [p for p in pending if p["id"] not in ids]
                return self._send(200, {"ok": True, "left": len(pending)})
        except Exception as exc:
            return self._send(500, {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)})
        self._send(404, {"ok": False, "error": "not found"})


def main():
    global WORKDIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=48123)
    ap.add_argument("--workdir", default=os.getcwd())
    args = ap.parse_args()
    WORKDIR = os.path.abspath(args.workdir)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    print("frame-studio server on http://127.0.0.1:%d (workdir %s)" % (args.port, WORKDIR), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
