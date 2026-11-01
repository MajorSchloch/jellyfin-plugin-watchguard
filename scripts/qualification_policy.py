"""Render/select the single release policy; no second hand-maintained matrix."""
import argparse
import json
from pathlib import Path
from qualification import POLICY, MATRIX, PAIRS, SHARDS, PLAN


def documentation():
    lines = ['# Required release qualification', '', 'Generated from `scripts/qualification-policy.json`. Run `python3 scripts/qualification_policy.py --write-doc` after a policy change.', '',
             'One candidate ZIP is built and deterministically rebuilt. Every required job tests those exact bytes. Published assets and historical evidence are unchanged.', '',
             '| Host | Level | Shard | Required suites |', '|---|---|---|---|']
    for row in MATRIX:
        host, shard = row['jellyfin_version'], row['shard']
        lines.append(f"| {host} | {POLICY['hosts'][host]['level']} | {shard} | {', '.join(SHARDS[shard])} |")
    lines += ['', f'{len(MATRIX)} integration jobs; {len(PAIRS)} blocking host/suite reports. Current Chromium is Playwright 1.56.1; Chromium 79 uses an actual pinned executable, not user-agent emulation.', '',
              '## Scenarios', '', '| Suite | Required scenarios |', '|---|---|']
    for name, commands in PLAN.items(): lines.append(f"| {name} | {' → '.join(c['id'] for c in commands)} |")
    lines += ['', '## Retired mandatory coverage', ''] + ['- '+item for item in POLICY['retired']]
    lines += ['', 'These fixtures remain available for explicit investigations. Their old evidence is historical, not current qualification. Data-format migrations and backend security assertions remain intact.', '',
              'The minimum package ABI remains '+POLICY['minimumAbi']+'. This is a loading/dependency floor, not a claim of full native testing on that host. Prior 12.2 qualification remains historical. No runtime compatibility policy changes in this tooling PR.', '']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix', action='store_true')
    parser.add_argument('--suites')
    parser.add_argument('--write-doc', action='store_true')
    parser.add_argument('--check', action='store_true')
    a=parser.parse_args()
    if a.matrix: print(json.dumps({'include':MATRIX},separators=(',',':')))
    if a.suites: print(json.dumps(SHARDS[a.suites]))
    path=Path('docs/qualification-policy.md')
    if a.write_doc: path.write_text(documentation())
    if a.check:
        assert path.read_text()==documentation(), 'Regenerate qualification policy documentation'
        assert all(set(c)=={'id','command','env'} for rows in PLAN.values() for c in rows)
        assert all(shard in SHARDS for row in POLICY['hosts'].values() for shard in row['shards'])
if __name__=='__main__': main()
