"""Local trailer preview with HTTP byte ranges so video chapter seeking works.

python trailer/serve.py
Only trailer files, bundled fonts, and the Three.js renderer module are served.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os, re

ROOT=Path(__file__).resolve().parent.parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def end_headers(self):
        self.send_header('Accept-Ranges','bytes')
        super().end_headers()

    def send_head(self):
        self.byte_range=None
        if self.path in ('/','/trailer','/trailer/'):
            self.path='/trailer/index.html'
        file=Path(self.translate_path(self.path)).resolve()
        allowed=[ROOT/'trailer',ROOT/'src/app/fonts',ROOT/'node_modules/three/build']
        if not any(file.is_relative_to(p) for p in allowed):
            self.send_error(404);return None
        value=self.headers.get('Range')
        if not value or not file.is_file():return super().send_head()
        match=re.fullmatch(r'bytes=(\d*)-(\d*)',value.strip())
        size=file.stat().st_size
        if not match or not any(match.groups()):
            self.send_error(416);return None
        first,last=match.groups()
        if first:
            start=int(first);end=min(int(last) if last else size-1,size-1)
        else:
            start=max(0,size-int(last));end=size-1
        if start>=size or end<start:
            self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return None
        self.send_response(206)
        self.send_header('Content-Type',self.guess_type(str(file)))
        self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length',str(end-start+1))
        self.send_header('Last-Modified',self.date_time_string(file.stat().st_mtime))
        self.end_headers();self.byte_range=(start,end)
        stream=file.open('rb');stream.seek(start);return stream

    def copyfile(self,source,output):
        if self.byte_range is None:return super().copyfile(source,output)
        start,end=self.byte_range;remaining=end-start+1
        while remaining:
            chunk=source.read(min(remaining,1024*1024))
            if not chunk:break
            try:output.write(chunk)
            except (BrokenPipeError,ConnectionResetError):return
            remaining-=len(chunk)

print('Trailer preview: http://127.0.0.1:3017/trailer/',flush=True)
ThreadingHTTPServer(('127.0.0.1',3017),Handler).serve_forever()
