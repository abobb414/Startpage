#!/usr/bin/env python3
"""起始页测试用的静态服务器。

比 http.server 多一件事：/__search__ 路径不返回文件，而是把收到的
路径 + 查询串回显成一页 HTML（带 __SEARCH_HIT__ 标记），
用来断言「回车搜索」真的拼出了正确的外部搜索地址。
"""
import http.server
import socketserver
import sys
from urllib.parse import unquote

ROOT = sys.argv[1]
PORT = int(sys.argv[2])


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith('/__search__'):
            body = ('<!doctype html><meta charset="utf-8"><title>search-echo</title>'
                    f'<p>__SEARCH_HIT__{self.path}</p>').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, *args):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler) as httpd:
    httpd.serve_forever()
