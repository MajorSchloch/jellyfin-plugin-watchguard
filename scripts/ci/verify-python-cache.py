"""Prove hosted setup uses the pinned interpreter that existed before setup."""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RECORD = ROOT / 'artifacts/python-selection.json'


def cached_python(version, cache):
    folder = cache / 'Python' / version
    executable = folder / 'x64/bin/python3'
    if not (folder / 'x64.complete').is_file() or not executable.is_file():
        raise RuntimeError(f'Python {version} is not preinstalled in {folder}. '
                           'Review the hosted image inventory before changing .python-version.')
    observed = subprocess.check_output(
        [str(executable), '-c', 'import platform; print(platform.python_version())'], text=True).strip()
    if observed != version:
        raise RuntimeError(f'Cached Python reports {observed}; expected {version}')
    return {'version': observed, 'executable': str(executable.resolve())}


def verify_selected(before, version, executable):
    if version != before['version'] or str(Path(executable).resolve()) != before['executable']:
        raise RuntimeError('setup-python did not select the previously verified local interpreter')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['before', 'after'])
    args = parser.parse_args()
    required = (ROOT / '.python-version').read_text().strip()
    if args.phase == 'before':
        result = {'required': required, 'before': cached_python(required, Path(os.environ['RUNNER_TOOL_CACHE'])),
                  'image': os.environ.get('ImageOS'), 'imageVersion': os.environ.get('ImageVersion')}
        RECORD.parent.mkdir(parents=True, exist_ok=True)
    else:
        result = json.loads(RECORD.read_text())
        if result['required'] != required:
            raise RuntimeError('Python policy changed during setup')
        verify_selected(result['before'], platform.python_version(), sys.executable)
        result['after'] = {'version': platform.python_version(), 'executable': str(Path(sys.executable).resolve())}
        result['result'] = 'PASS: selected the verified preinstalled interpreter'
    RECORD.write_text(json.dumps(result, indent=2) + '\n')
    print(RECORD.read_text())


if __name__ == '__main__':
    main()
