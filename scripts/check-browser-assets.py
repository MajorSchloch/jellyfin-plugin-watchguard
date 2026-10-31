"""Extract and parse the actual package's browser assets before native qualification."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
parser.add_argument('--output', type=Path, default=Path('artifacts/browser-assets'))
args = parser.parse_args()
with tempfile.TemporaryDirectory() as temp:
    runtime = Path(temp) / 'Jellyfin.Plugin.WatchGuard.dll'
    with zipfile.ZipFile(args.archive) as archive:
        runtime.write_bytes(archive.read(runtime.name))
    subprocess.run(['dotnet', 'run', '--project', 'tests/BrowserAssets', '-c', 'Release', '--',
                    str(runtime), str(args.output)], check=True)
subprocess.run(['node', 'scripts/browser/check.cjs', str(args.output)], check=True)
