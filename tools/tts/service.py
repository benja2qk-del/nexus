"""Loopback-only TTS broker. Parent pipe lifetime and short leases own workers."""
import atexit
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT = Path(os.environ['NEXUS_TTS_ROOT'])
CATALOG = json.loads(Path(__file__).with_name('catalog.json').read_text(encoding='utf-8'))
VOICES = {v['id']: v for v in CATALOG['voices']}
BOOT = json.loads(sys.stdin.readline())
TOKEN = BOOT['token']
PORT = int(BOOT.get('port', 4786))
if PORT not in (4786, 4788):
    raise ValueError('Invalid local voice port')
IDLE_SECONDS = max(60, min(1800, int(BOOT.get('idleSeconds', 300))))
workers = {}
workers_lock = threading.RLock()
gpu_lock = threading.Lock()
last_used = time.monotonic()
lease_until = 0
call_stopped = False
closing = threading.Event()


class Worker:
    def __init__(self, engine, runtime=None):
        runtime = runtime or ('neural' if engine in ('kokoro', 'qwen') else 'piper-gpu' if engine == 'piper' and (ROOT / 'piper-gpu' / 'Scripts' / 'python.exe').exists() else engine)
        self.runtime = runtime
        exe = ROOT / runtime / 'Scripts' / 'python.exe'
        self.lock = threading.Lock()
        self.ready = set()
        self.error = None
        self.log = (ROOT / (engine + '.log')).open('a', encoding='utf-8')
        self.process = subprocess.Popen([str(exe), '-u', str(Path(__file__).with_name('worker.py')), engine],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, encoding='utf-8',
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}, creationflags=subprocess.CREATE_NO_WINDOW)

    def run(self, request):
        # Lock before checking readiness; audio requests never queue behind model loading.
        if not self.lock.acquire(blocking=bool(request.get('warm'))):
            raise RuntimeError('Voice is busy. Use device speech for this sentence.')
        timeout = threading.Timer(120 if request.get('warm') else 60, self.terminate)
        timeout.daemon = True
        timeout.start()
        try:
            if self.process.poll() is not None:
                raise RuntimeError('Voice worker stopped. Restart the call.')
            self.process.stdin.write(json.dumps(request) + '\n')
            self.process.stdin.flush()
            while True:
                line = self.process.stdout.readline()
                if not line:
                    raise RuntimeError('Voice worker disconnected.')
                msg = json.loads(line)
                yield msg
                if msg['type'] == 'error':
                    self.error = msg['error']
                    break
                if msg['type'] == 'done':
                    self.ready.add(request['voice'])
                    self.error = None
                    break
        finally:
            timeout.cancel()
            self.lock.release()

    def terminate(self):
        if self.process.poll() is None:
            subprocess.run(['taskkill.exe', '/PID', str(self.process.pid), '/T', '/F'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)

    def close(self):
        self.terminate()
        self.process.wait(timeout=10)
        self.process.stdin.close()
        self.process.stdout.close()
        self.log.close()


def get_worker(voice):
    engine = VOICES[voice]['engine']
    with workers_lock:
        worker = workers.get(engine)
        if worker and worker.process.poll() is not None:
            worker.close()
            del workers[engine]
        if engine not in workers:
            workers[engine] = Worker(engine)
        return workers[engine]


def warm(voices):
    wanted = {VOICES[v]['engine'] for v in voices}
    with gpu_lock:
        with workers_lock:
            # Keep at most the selected language pair; never evict mid-request.
            for engine in list(workers):
                if engine not in wanted:
                    workers.pop(engine).close()
        for voice in voices:
            try:
                worker = get_worker(voice)
                if voice in worker.ready:
                    continue
                for _ in worker.run({'voice': voice, 'warm': True}):
                    pass
                if worker.error and worker.runtime == 'piper-gpu':
                    worker.close()
                    with workers_lock:
                        workers['piper'] = worker = Worker('piper', runtime='piper')
                    for _ in worker.run({'voice': voice, 'warm': True}):
                        pass
            except Exception as error:
                print(str(error), file=sys.stderr, flush=True)


def cleanup():
    closing.set()
    with workers_lock:
        for worker in workers.values():
            worker.close()
        workers.clear()


atexit.register(cleanup)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        # No browser origin, CORS, arbitrary host, or network binding.
        return (self.client_address[0] == '127.0.0.1'
                and self.headers.get('Host') == '127.0.0.1:' + str(PORT)
                and not self.headers.get('Origin')
                and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN))

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/health':
            return self.reply(404, {'error': 'Unknown route'})
        with workers_lock:
            ready = [v for w in workers.values() if w.process.poll() is None for v in w.ready]
        self.reply(200, {'protocol': 1, 'ready': ready})

    def do_POST(self):
        global last_used, lease_until, call_stopped
        if not self.allowed():
            return self.reply(403, {'error': 'Forbidden'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 2 or size > 12000:
                return self.reply(413, {'error': 'Request too large'})
            request = json.loads(self.rfile.read(size))
            last_used = time.monotonic()
            if self.path == '/lease':
                lease_until = last_used + 20 if request.get('active') else 0
                call_stopped = not request.get('active')
                return self.reply(200, {'ok': True})
            if self.path == '/warm':
                voices = request.get('voices', [])
                if not isinstance(voices, list) or len(voices) > 2 or any(v not in VOICES for v in voices):
                    return self.reply(400, {'error': 'Unknown voice'})
                threading.Thread(target=warm, args=(voices,), daemon=True).start()
                return self.reply(202, {'ok': True})
            if self.path != '/synthesize':
                return self.reply(404, {'error': 'Unknown route'})
            voice = request.get('voice')
            text = request.get('text')
            if voice not in VOICES or not isinstance(text, str) or not 1 <= len(text.strip()) <= 700:
                return self.reply(400, {'error': 'Invalid voice or sentence'})
            worker = get_worker(voice)
            if voice not in worker.ready or not gpu_lock.acquire(blocking=False):
                return self.reply(503, {'error': 'Voice is warming up or busy'})
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-ndjson')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.close_connection = True
                disconnected = False
                # Drain a canceled worker reply to keep the next request framed correctly.
                for msg in worker.run({'voice': voice, 'text': text}):
                    if not disconnected:
                        try:
                            self.wfile.write((json.dumps(msg) + '\n').encode())
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                            disconnected = True
            finally:
                gpu_lock.release()
        except Exception as error:
            self.close_connection = True
            try:
                self.reply(500, {'error': str(error)})
            except OSError:
                pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    server.daemon_threads = True

    def parent_watch():
        # EOF includes crashes and server termination. No orphaned GPU workers.
        for _ in sys.stdin:
            pass
        closing.set()
        server.shutdown()

    def idle_watch():
        while not closing.wait(5):
            now = time.monotonic()
            if now > lease_until and now - last_used > (15 if call_stopped else IDLE_SECONDS):
                server.shutdown()
                return

    threading.Thread(target=parent_watch, daemon=True).start()
    threading.Thread(target=idle_watch, daemon=True).start()
    print('NEXUS_TTS_READY', flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        cleanup()


if __name__ == '__main__':
    main()
