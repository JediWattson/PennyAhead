#!/usr/bin/env python3
"""Create the reviewed demo stack. Does not enable model or banking access."""
import argparse
import json
import os
import re
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
parser.add_argument('--domain', help='Full custom hostname, for example pennyahead.famtrees.net')
parser.add_argument('--certificate-arn', help='Issued us-east-1 ACM certificate covering --domain')
args = parser.parse_args()
if len(args.commit) != 40 or any(c not in '0123456789abcdef' for c in args.commit):
    raise SystemExit('Use the exact 40-character reviewed public Git commit.')
if bool(args.domain) != bool(args.certificate_arn):
    parser.error('Provide both --domain and --certificate-arn.')
if args.domain:
    if len(args.domain) > 253 or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+', args.domain):
        parser.error('Use a lowercase DNS hostname without a protocol, port or path.')
    if not re.fullmatch(r'arn:aws:acm:us-east-1:\d{12}:certificate/[a-f0-9-]{36}', args.certificate_arn):
        parser.error('Use an ACM certificate ARN in us-east-1.')
    certificate = json.loads(subprocess.check_output([
        'aws', 'acm', 'describe-certificate', '--profile', args.profile,
        '--region', args.region, '--certificate-arn', args.certificate_arn,
        '--query', 'Certificate.{Status:Status,Names:SubjectAlternativeNames}', '--output', 'json',
    ], text=True))
    covered = any(name == args.domain or (name.startswith('*.') and args.domain.split('.', 1)[1] == name[2:])
        for name in certificate.get('Names', []))
    if certificate.get('Status') != 'ISSUED' or not covered:
        raise SystemExit('The certificate must be issued and cover the exact custom hostname before deployment.')
params = [{'ParameterKey': key, 'ParameterValue': value} for key, value in {
    'VpcId': args.vpc, 'SubnetId': args.subnet, 'Commit': args.commit,
    'OriginToken': secrets.token_hex(32),
    'DomainName': args.domain or '', 'CertificateArn': args.certificate_arn or '',
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
