"""Run identical interface benchmark sources against the published v0.4.7 DLL."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
archive=ROOT/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.7.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='8046bbd611ba3e17bf003160e32d8bffdf07a22038f06863bd8414e78c08b6e0'
with tempfile.TemporaryDirectory(prefix='watchguard-model-') as temporary:
    root=Path(temporary)
    with zipfile.ZipFile(archive) as package:
        (root/'Jellyfin.Plugin.WatchGuard.dll').write_bytes(package.read('Jellyfin.Plugin.WatchGuard.dll'))
    source=ROOT/'tests/WatchGuard.Tests'
    project=(source/'WatchGuard.Tests.csproj').read_text().replace(
        '<ProjectReference Include="../../Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj" />',
        '<Reference Include="Jellyfin.Plugin.WatchGuard"><HintPath>Jellyfin.Plugin.WatchGuard.dll</HintPath></Reference>')
    (root/'Baseline.csproj').write_text(project)
    (root/'global.json').write_text((ROOT/'global.json').read_text())
    for name in ['DiscoveryBenchmarks.cs','VerificationBenchmarks.cs']:
        (root/name).write_text((source/name).read_text())
    output=ROOT/'artifacts/verification-model-v048-before.json'
    env={**os.environ,'WATCHGUARD_VERIFICATION_MODEL_OUTPUT':str(output),
         'WATCHGUARD_BENCHMARK_OUTPUT':str(ROOT/'artifacts/discovery-model-v048-before.json')}
    subprocess.run(['dotnet','test',str(root/'Baseline.csproj'),'-c','Release'],env=env,cwd=ROOT,check=True)
    after=Path(os.environ.get('WATCHGUARD_VERIFICATION_MODEL_OUTPUT','/tmp/verification-model-v048.json'))
    before=json.loads(output.read_text()); current=json.loads(after.read_text())
    for old,new in zip(before,current,strict=True):
        for key in ['users','titles','returned','episodeRows','LimitReached','Items','Coverage']:
            assert old[key]==new[key],(key,old[key],new[key])
        assert new['nativePlaybackBatches']==old['nativePlaybackBatches']
        assert new['Diagnostics']['EpisodeHydrationQueryCount']==100
        assert new['Diagnostics']['EpisodeQueryCount']==old['Diagnostics']['EpisodeQueryCount']
        assert new['Diagnostics']['EpisodeHydratedRows']==2400
    large_before=json.loads((ROOT/'artifacts/discovery-model-v048-before.json').read_text())
    large_after=json.loads(Path(os.environ.get('WATCHGUARD_BENCHMARK_OUTPUT','/tmp/discovery-model-v048.json')).read_text())
    for old,new in zip(large_before,large_after,strict=True):
        for key in ['episodeCount','episodeRows','nativePlaybackBatches','Items','Coverage']:
            assert old[key]==new[key],key
    print('Published/candidate model results and episode work match; native hydration occurs once per series; playback calls unchanged.')
