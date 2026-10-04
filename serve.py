"""Local web server for the game.

Like `python -m http.server`, but it only listens on this computer and tells
the browser not to cache files, so code changes show up on a normal reload.
It keeps connections open and also answers on IPv6 (::1): on Windows the
browser tries "localhost" there first, and a new connection for every file
cost a fraction of a second each (Bot Arena's threads load the game's ~50
files every time one starts).
"""

import http.server
import os
import socket
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8016


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}
    # keep-alive: many files over one connection
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # keep the console quiet


class Server(http.server.ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second server silently share the port,
    # so only reuse addresses elsewhere (where it just skips TIME_WAIT).
    allow_reuse_address = os.name != "nt"
    request_queue_size = 64


class Server6(Server):
    address_family = socket.AF_INET6


os.chdir(os.path.dirname(os.path.abspath(__file__)))
try:
    httpd = Server(("127.0.0.1", PORT), Handler)
except OSError:
    # most likely the game's server is already running in another window
    print(f"Port {PORT} is already in use - the game server is probably already running.")
    print(f"Open http://localhost:{PORT} in your browser.")
    sys.exit(0)
try:
    httpd6 = Server6(("::1", PORT), Handler)
    threading.Thread(target=httpd6.serve_forever, daemon=True).start()
except OSError:
    pass  # no IPv6 here: IPv4 alone works, just slower to connect
with httpd:
    print(f"Retro Strike: Bot Arena - http://localhost:{PORT}  (close this window to stop)", flush=True)
    print("Keep this window open while you play (Bot Arena needs it too).", flush=True)
    print("Oynarken bu pencereyi acik tutun (Bot Arenasi da buna ihtiyac duyar).", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
