#!/usr/bin/env python3
"""Loopback-only log collector for the GBP Tampermonkey helper."""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 17891
ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
LOG_FILE = LOG_DIR / "gdgbpx-debug.ndjson"
MAX_BODY = 2 * 1024 * 1024
MAX_LOG_SIZE = 10 * 1024 * 1024
ROTATIONS = 3
MAX_LOG_AGE_DAYS = 7
WRITE_LOCK = threading.Lock()


def rotate_if_needed() -> None:
    if not LOG_FILE.exists() or LOG_FILE.stat().st_size < MAX_LOG_SIZE:
        return
    oldest = LOG_FILE.with_suffix(LOG_FILE.suffix + f".{ROTATIONS}")
    oldest.unlink(missing_ok=True)
    for index in range(ROTATIONS - 1, 0, -1):
        source = LOG_FILE.with_suffix(LOG_FILE.suffix + f".{index}")
        target = LOG_FILE.with_suffix(LOG_FILE.suffix + f".{index + 1}")
        if source.exists():
            source.replace(target)
    LOG_FILE.replace(LOG_FILE.with_suffix(LOG_FILE.suffix + ".1"))


def cleanup_expired_logs() -> None:
    """Keep a small, recent local diagnostic window without manual cleanup."""
    if not LOG_DIR.exists():
        return
    cutoff = datetime.now(timezone.utc).timestamp() - MAX_LOG_AGE_DAYS * 24 * 60 * 60
    for candidate in LOG_DIR.glob("gdgbpx-debug.ndjson*"):
        try:
            if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                candidate.unlink()
        except OSError:
            pass


def write_entries(payload: dict) -> int:
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise ValueError("entries must be a list")
    received_at = datetime.now(timezone.utc).isoformat()
    version = str(payload.get("scriptVersion", ""))[:40]
    lines = []
    for entry in entries[:200]:
        if not isinstance(entry, dict):
            continue
        record = {
            "receivedAt": received_at,
            "scriptVersion": version,
            **entry,
        }
        lines.append(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
    if not lines:
        return 0
    with WRITE_LOCK:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        cleanup_expired_logs()
        rotate_if_needed()
        with LOG_FILE.open("a", encoding="utf-8", newline="\n") as output:
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
    return len(lines)


class Handler(BaseHTTPRequestHandler):
    server_version = "GBPDebugBridge/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        self.send_json(200, {"ok": True, "logFile": str(LOG_FILE)})

    def do_POST(self) -> None:
        if self.path != "/ingest":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if self.headers.get("X-GBP-Logger") != "v1":
            self.send_json(403, {"ok": False, "error": "invalid logger header"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "error": "invalid content length"})
            return
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"ok": False, "error": "invalid body size"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")
            written = write_entries(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self.send_json(400, {"ok": False, "error": str(error)[:300]})
            return
        self.send_json(200, {"ok": True, "written": written})


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cleanup_expired_logs()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"GBP debug bridge listening on http://{HOST}:{PORT}", flush=True)
    print(f"Writing logs to {LOG_FILE}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
