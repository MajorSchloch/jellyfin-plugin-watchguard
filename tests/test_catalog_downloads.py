"""Real anonymous curl transfers with a disposable release server; no GitHub writes."""
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).resolve().parents[1] / 'scripts/catalog.py')
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


@contextmanager
def release_server(respond):
    calls, headers = Counter(), []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            calls[self.path] += 1
            headers.append(self.headers)
            status, body = respond(self.path, calls[self.path])
            self.send_response(status)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', calls, headers
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


class CatalogDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'Jellyfin.Plugin.WatchGuard-v0.7.11.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr(catalog.DLL, b'test runtime')
            archive.writestr('LICENSE', b'test license')
        self.sidecar = self.archive.with_suffix('.zip.sha256')
        self.sidecar.write_text(f'{catalog.inspect_zip(self.archive)[1]}  {self.archive.name}\n')
        self.manifest = self.root / 'manifest.json'
        self.manifest.write_text('[]\n')
        self.original = self.manifest.read_bytes()
        self.base = 'https://github.com/Fixture/WatchGuard/releases/download/v0.7.11/'
        self.release = {'draft': False, 'prerelease': False, 'published_at': '2026-10-30T13:57:38Z',
                        'assets': [{'name': self.archive.name + suffix,
                                    'browser_download_url': self.base + self.archive.name + suffix}
                                   for suffix in ('', '.sha256')]}

    def content(self, path):
        if path == '/release':
            return json.dumps(self.release).encode()
        return self.sidecar.read_bytes() if path.endswith('.sha256') else self.archive.read_bytes()

    @contextmanager
    def transfers(self, respond):
        download = catalog.download
        deadlines = []
        with release_server(respond) as (base, calls, headers):
            def redirect(url, destination, *, deadline):
                deadlines.append(deadline)
                path = '/release' if '/releases/tags/' in url else '/' + url.rsplit('/', 1)[1]
                return download(base + path, destination, deadline=deadline)
            # Real curl / HTTP status handling; omit wall-clock backoff in tests.
            with patch.object(catalog, 'download', redirect), patch.object(catalog.time, 'sleep'):
                yield calls, headers, deadlines

    def add(self):
        catalog.add_release(self.manifest, 'Fixture/WatchGuard', 'v0.7.11', self.archive)

    def test_temporary_404_for_each_download_then_success_is_anonymous(self):
        with self.transfers(lambda path, attempt: (404, b'not yet') if attempt == 1 else (200, self.content(path))) as (calls, headers, deadlines):
            self.add()
        self.assertEqual(list(calls.values()), [2, 2, 2])
        self.assertEqual(len(set(deadlines)), 1, 'Metadata, ZIP and checksum must share a deadline')
        self.assertTrue(all(h.get('Authorization') is None and h.get('Cookie') is None for h in headers))
        result = json.loads(self.manifest.read_text())[0]['versions'][0]
        self.assertEqual(result['timestamp'], self.release['published_at'])
        self.assertEqual(result['sourceUrl'], self.base + self.archive.name)
        self.assertEqual(result['checksum'], catalog.inspect_zip(self.archive)[0])

    def test_retry_exhaustion_preserves_manifest(self):
        with self.transfers(lambda path, attempt: (404, b'not yet') if path.endswith('.sha256') else (200, self.content(path))) as (calls, _, __):
            with self.assertRaises(subprocess.CalledProcessError):
                self.add()
        self.assertEqual(calls['/' + self.sidecar.name], catalog.DOWNLOAD_ATTEMPTS)
        self.assertEqual(self.manifest.read_bytes(), self.original)

    def test_mismatched_public_content_fails_immediately_and_preserves_manifest(self):
        for suffix, message in [('.zip', 'Public ZIP differs'), ('.sha256', 'Public SHA-256 mismatch')]:
            with self.subTest(suffix=suffix):
                with self.transfers(lambda path, attempt: (200, b'wrong content' if path.endswith(suffix) else self.content(path))) as (calls, _, __):
                    with self.assertRaisesRegex(ValueError, message):
                        self.add()
                self.assertTrue(all(count == 1 for count in calls.values()))
                self.assertEqual(self.manifest.read_bytes(), self.original)

    def test_local_sidecar_mismatch_precedes_downloads_and_manifest_mutation(self):
        self.sidecar.write_text('0' * 64 + '  ' + self.archive.name)
        with patch.object(catalog, 'download') as download:
            with self.assertRaisesRegex(ValueError, 'SHA-256 sidecar mismatch'):
                self.add()
            download.assert_not_called()
        self.assertEqual(self.manifest.read_bytes(), self.original)

    def test_permanent_http_failure_is_not_retried(self):
        for status in (401, 403):
            with self.subTest(status=status), self.transfers(lambda path, attempt: (status, b'denied')) as (calls, _, __):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.add()
                self.assertEqual(sum(calls.values()), 1)
                self.assertEqual(self.manifest.read_bytes(), self.original)

    def test_connect_attempt_and_shared_total_budget_bound_stalled_downloads(self):
        elapsed, attempts, sleeps = [0.0], [], []

        def stalled(command, **kwargs):
            self.assertEqual(command[:2], ['curl', '--disable'])
            self.assertNotIn('--retry', command)  # No nested retry budget.
            limit = kwargs['timeout']
            self.assertEqual(float(command[command.index('--max-time') + 1]), limit)
            self.assertLessEqual(float(command[command.index('--connect-timeout') + 1]), min(10, limit))
            self.assertLessEqual(limit, min(30, 120 - elapsed[0]))
            attempts.append(limit)
            elapsed[0] += limit
            raise subprocess.TimeoutExpired(command, limit)

        def sleep(delay):
            sleeps.append(delay)
            elapsed[0] += delay

        with patch.object(catalog.time, 'monotonic', side_effect=lambda: elapsed[0]), \
             patch.object(catalog.time, 'sleep', side_effect=sleep), \
             patch.object(catalog.subprocess, 'run', side_effect=stalled):
            with self.assertRaises(TimeoutError):
                self.add()
        self.assertEqual(attempts, [30, 30, 30, 16])
        self.assertEqual(sleeps, [2, 4, 8])
        self.assertEqual(elapsed[0], 120)
        self.assertEqual(self.manifest.read_bytes(), self.original)


if __name__ == '__main__':
    unittest.main()
