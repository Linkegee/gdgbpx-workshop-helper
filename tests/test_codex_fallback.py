import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import codex_fallback as fallback

class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.now = datetime(2026, 10, 29, 8, 0, tzinfo=timezone.utc)
        self.patcher = patch.object(fallback, 'PRIVATE', self.root / 'private')
        self.patcher.start()
        notifier = patch.object(fallback, 'notify_result', return_value='mocked')
        notifier.start()
        self.addCleanup(notifier.stop)
        self.addCleanup(self.patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def incident(self, scope='12345678-1234-1234-1234-123456789abc', **changes):
        data = {'accountScope':scope,'generatedAt':self.now.isoformat(),'context':'main',
                'state':{'status':'paused','phase':'login-required','userPaused':False}}
        data.update(changes)
        path = self.root / ('gdgbpx-auto-incident-'+scope[:6]+'-2026-10-29T08-00-00-000Z.json')
        path.write_text(json.dumps(data), encoding='utf-8')
        return path

    def test_one_dispatch_per_account_and_no_false_success_claim(self):
        path = self.incident(); calls=[]
        def launch(args, **kwargs):
            calls.append((args, kwargs));return SimpleNamespace(returncode=0)
        with patch.object(fallback.shutil,'which',return_value='codex.exe'):
            self.assertEqual(fallback.process(path,self.now,launch),'completed')
            self.assertEqual(fallback.process(path,self.now,launch),'already-attempted')
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][1]['timeout'],300)
        self.assertIn('不接管或操作 Firefox',calls[0][1]['input'])

    def test_explicit_stop_old_or_manual_files_do_not_dispatch(self):
        path = self.incident(state={'status':'stopped','phase':'stopped'})
        self.assertEqual(fallback.process(path,self.now,lambda *a,**k: self.fail()),'ignored')
        path = self.incident(generatedAt='2026-10-29T05:00:00+00:00')
        self.assertEqual(fallback.process(path,self.now,lambda *a,**k: self.fail()),'ignored')
        path.rename(self.root / 'gdgbpx-helper-log-123456.json')
        self.assertEqual(fallback.process(self.root / 'gdgbpx-helper-log-123456.json',self.now),'ignored')

    def test_daily_cap_and_failure_are_not_retried(self):
        def failed(*args, **kwargs): return SimpleNamespace(returncode=1)
        with patch.object(fallback.shutil,'which',return_value='codex.exe'):
            for i in range(4):
                path=self.incident(scope=f'{i:08x}-1234-1234-1234-123456789abc')
                self.assertEqual(fallback.process(path,self.now,failed),'cli-failed' if i<3 else 'daily-limit')
                self.assertEqual(fallback.process(path,self.now,failed),'already-attempted')

if __name__ == '__main__': unittest.main()
