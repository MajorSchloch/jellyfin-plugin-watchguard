import importlib.util
import os
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('browser_environment',Path(__file__).resolve().parents[1]/'scripts/ci/browser-node.py')
environment=importlib.util.module_from_spec(spec);spec.loader.exec_module(environment)

class BrowserEnvironmentTests(unittest.TestCase):
    def test_same_paths_loopback_network_pinned_node_and_proxy_ca(self):
        command=environment.command(['/work/repo/tests/startup-browser.cjs','/tmp/fixture.json'],'/opt/node/bin/node',Path('/work/repo'),'/tmp/fixture/caddy-root.crt')
        self.assertIn('--network=host',command)
        self.assertIn('/tmp:/tmp',command)
        self.assertIn('/work/repo:/work/repo',command)
        self.assertIn('/opt/node/bin:/opt/node/bin:ro',command)
        self.assertIn('NODE_EXTRA_CA_CERTS='+str(Path('/tmp/fixture/caddy-root.crt').resolve()),command)
        self.assertEqual(command[-3:],['/opt/node/bin/node','/work/repo/tests/startup-browser.cjs','/tmp/fixture.json'])
        self.assertIn('@sha256:',environment.IMAGE)
        self.assertFalse(any('GITHUB_TOKEN' in part or 'GH_TOKEN' in part for part in command))
        self.assertFalse(any('docker.sock' in part for part in command))

    def test_unrelated_trust_root_rejected(self):
        with self.assertRaises(ValueError):
            environment.command([], '/opt/node/bin/node',Path('/work/repo'),'/etc/private/root.crt')
