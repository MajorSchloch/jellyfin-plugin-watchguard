#!/usr/bin/env python3
"""Validate publication copy separately from repository preparation status."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET


def validate(text, version):
    if not text.startswith('# WatchGuard v' + version + ' — '):
        raise ValueError('Publication notes must identify the package version')
    if re.search(r'unpublished|release candidate|do not (merge|publish|deploy)|qualification.*(?:pending|running)', text, re.I):
        raise ValueError('Preparation status belongs in release-preparation.md, not publication copy')
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if not target.startswith('https://'):
            raise ValueError('Published release documentation links must be absolute HTTPS URLs')


if __name__ == '__main__':
    version = ET.parse('Directory.Build.props').findtext('./PropertyGroup/Version')
    validate(Path('docs/releases/v' + version + '.md').read_text(), version)
    print('Publication copy is separate from preparation status; links are absolute.')
