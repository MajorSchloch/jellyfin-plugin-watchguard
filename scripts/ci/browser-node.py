#!/usr/bin/env python3
"""Run native browser scripts in the pinned environment; keep fixture owners on host.

Linux hosted runners only. Identical bind paths and host networking preserve the
loopback-only fixtures, their private files and disposable proxy trust roots.
No GitHub credentials or unrelated environment variables enter the container.
"""
import os
from pathlib import Path
import subprocess
import sys

IMAGE = 'mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a'

def command(args, node, workspace, ca=None):
    node = Path(node).resolve()
    result = ['docker', 'run', '--rm', '--init', '--network=host', '--ipc=host',
              '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'HOME=/tmp',
              '-v', f'{workspace}:{workspace}', '-w', str(workspace),
              '-v', '/tmp:/tmp', '-v', f'{node.parent}:{node.parent}:ro']
    if ca:
        path = Path(ca).resolve()
        if not path.is_relative_to(Path('/tmp').resolve()) and not path.is_relative_to(workspace):
            raise ValueError('Proxy CA must belong to the disposable fixture')
        result += ['-e', 'NODE_EXTRA_CA_CERTS=' + str(path)]
    if os.environ.get('WATCHGUARD_CHROMIUM79'):
        old = Path(os.environ['WATCHGUARD_CHROMIUM79']).resolve()
        if not old.is_relative_to(Path('/tmp')): raise ValueError('Old engine must be a disposable /tmp input')
        result += ['-e', 'WATCHGUARD_CHROMIUM79=' + str(old)]
    return result + [IMAGE, str(node), *args]

if __name__ == '__main__':
    node = os.environ['WATCHGUARD_HOST_NODE']
    args = sys.argv[1:]
    if args and args[0].endswith('.cjs'):
        if sys.platform != 'linux':
            raise SystemExit('Preinstalled browser environment requires Linux host networking')
        args = command(args, node, Path.cwd().resolve(), os.environ.get('NODE_EXTRA_CA_CERTS'))
    else:
        args = [node, *args]
    raise SystemExit(subprocess.call(args))
