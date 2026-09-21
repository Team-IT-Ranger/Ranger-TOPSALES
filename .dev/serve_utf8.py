import http.server, socketserver, sys, os

# ยิงจาก root โปรเจกต์เสมอ (.claude/launch.json ตั้ง runtimeArgs เป็น [".dev/serve_utf8.py", "<port>", "<dir>"])
serve_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', serve_dir))

class UTF8Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith('.html') or self.path == '/':
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5501
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer(("", port), UTF8Handler) as httpd:
    httpd.serve_forever()
