#!/usr/bin/env python3
"""Generate private judge invitations; never print the bearer tokens."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='https://pennyahead.famtrees.net')
parser.add_argument('--count', type=int, default=5)
parser.add_argument('--output', type=Path, default=Path('web/work/private/judge-invites.json'))
args = parser.parse_args()
url = urlparse(args.base_url)
if url.scheme != 'https' or not url.hostname or url.path not in ('', '/') or url.query or url.fragment or url.username or url.password:
    parser.error('Use an HTTPS origin without a path, credentials, query or fragment.')
if not 1 <= args.count <= 50:
    parser.error('Choose between 1 and 50 invitations.')
invitations = []
for index in range(args.count):
    token = secrets.token_urlsafe(32)
    invitations.append({
        'label': f'Judge {index + 1}',
        'token': token,
        'hash': hashlib.sha256(token.encode()).hexdigest(),
        'url': f'{args.base_url.rstrip("/")}/unlock#token={token}',
    })
args.output.parent.mkdir(parents=True, exist_ok=True)
descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as handle:
    json.dump({'invitations': invitations}, handle, indent=2)
    handle.write('\n')
print(f'Created {len(invitations)} private invitations in {args.output}. Keep this file private; share only one invitation per judge.')
