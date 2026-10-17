import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from fixture_evidence import redact, Phases
from sanitize_trace import sanitize

class DiagnosticsTests(unittest.TestCase):
    def test_cleanup_does_not_erase_first_failure(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'phases.json'
            phases=Phases(file)
            phases.phase('media-indexing')
            phases.fail(AssertionError('missing movie'))
            phases.phase('teardown')
            phases.complete()
            rows=json.loads(file.read_text())['phases']
            self.assertEqual([(r['phase'],r['status']) for r in rows], [('workspace','PASS'),('media-indexing','FAIL'),('teardown','PASS')])
            self.assertEqual(rows[1]['message'],'missing movie')
    def test_credentials_redacted(self):
        for value in ['Authorization: Bearer secret','Token="secret"','password=secret','X-WatchGuard-Approval: secret','api_key=secret']:
            self.assertNotIn('secret',redact(value))
    def test_trace_drops_network_dom_and_input_values(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/'raw.zip';target=Path(root)/'trace.zip'
            with zipfile.ZipFile(source,'w') as archive:
                archive.writestr('trace.trace','\n'.join(json.dumps(e) for e in [
                    {'type':'before','callId':'1','method':'fill','params':{'value':'secret'}},
                    {'type':'after','callId':'1','error':{'message':'secret'}},
                    {'type':'console','text':'secret'},
                    {'type':'frame-snapshot','html':'secret'},
                ]))
                archive.writestr('trace.network','Authorization: secret')
                archive.writestr('resources/body','secret')
            sanitize(source,target)
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.namelist(),['trace.trace'])
                self.assertNotIn(b'secret',archive.read('trace.trace'))
                self.assertEqual(len(archive.read('trace.trace').splitlines()),2)

if __name__=='__main__':unittest.main()
