#!/usr/bin/env python3
"""Create the reviewed demo stack. Does not enable model or banking access."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--profile', default='pennyahead')
parser.add_argument('--region', default='us-east-1', choices=['us-east-1'])
parser.add_argument('--vpc', required=True)
parser.add_argument('--subnet', required=True)
parser.add_argument('--commit', required=True)
args = parser.parse_args()
if len(args.commit) != 40 or any(c not in '0123456789abcdef' for c in args.commit):
    raise SystemExit('Use the exact 40-character reviewed public Git commit.')
params = [{'ParameterKey': key, 'ParameterValue': value} for key, value in {
    'VpcId': args.vpc, 'SubnetId': args.subnet, 'Commit': args.commit,
    'OriginToken': secrets.token_hex(32),
}.items()]
with tempfile.NamedTemporaryFile(mode='w', prefix='pennyahead-parameters-', suffix='.json') as handle:
    os.chmod(handle.name, 0o600)
    json.dump(params, handle)
    handle.flush()
    subprocess.run(['aws', 'cloudformation', 'create-stack', '--profile', args.profile,
        '--region', args.region, '--stack-name', 'pennyahead-demo',
        '--template-body', f'file://{Path(__file__).resolve().with_name("aws.yml")}',
        '--parameters', f'file://{handle.name}', '--capabilities', 'CAPABILITY_IAM',
        '--tags', 'Key=Project,Value=PennyAhead'], check=True)
