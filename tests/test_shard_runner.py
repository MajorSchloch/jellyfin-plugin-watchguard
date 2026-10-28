import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import unittest
import run_shard

class ShardRunnerTests(unittest.TestCase):
    def test_evidence_is_isolated_while_inputs_remain_available(self):
        with tempfile.TemporaryDirectory() as temp:
            artifacts=Path(temp)
            for name in ['WatchGuard','RollbackV031','testing']:
                (artifacts/name).mkdir();(artifacts/name/'data').write_text('original')
            (artifacts/'candidate.zip').write_text('input')
            (artifacts/'candidate.zip.sha256').write_text('digest')
            (artifacts/'settings-validation.json').write_text('first')
            run_shard.archive_suite(artifacts,'first')
            self.assertEqual((artifacts/'suites/first/settings-validation.json').read_text(),'first')
            self.assertFalse((artifacts/'testing').exists())
            (artifacts/'settings-validation.json').write_text('second')
            run_shard.archive_suite(artifacts,'second')
            self.assertEqual((artifacts/'suites/first/settings-validation.json').read_text(),'first')
            self.assertEqual((artifacts/'suites/second/settings-validation.json').read_text(),'second')
            for name in ['WatchGuard/data','RollbackV031/data','candidate.zip','candidate.zip.sha256']:
                self.assertTrue((artifacts/name).is_file())
            with self.assertRaises(FileExistsError):run_shard.archive_suite(artifacts,'first')

    def test_failed_suite_is_archived_and_never_retried_or_followed(self):
        calls=[]
        def run(command,**kwargs):
            calls.append((command,kwargs))
            return type('Result',(),{'returncode':7 if 'tests/run_suite.py' in command else 0})()
        with patch('sys.argv',['run_shard.py','enforcement-legacy']),patch.object(run_shard.subprocess,'run',side_effect=run),patch.object(run_shard,'archive_suite') as archive,patch.dict('os.environ',{'WATCHGUARD_REQUIRE_PROXY_MATRIX':'1'}):
            with self.assertRaises(SystemExit) as error:run_shard.main()
            self.assertEqual(error.exception.code,7)
            self.assertEqual(len(calls),2)
            self.assertEqual(calls[0][0],['python3','tests/run_suite.py','server-enforcement'])
            self.assertEqual(calls[0][1]['env']['WATCHGUARD_PROXY_MATRIX'],'1')
            archive.assert_called_once_with(run_shard.ROOT/'artifacts','server-enforcement')
