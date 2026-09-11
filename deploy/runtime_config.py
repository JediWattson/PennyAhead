"""Select only deployment settings; never copy local AWS credentials or access overrides."""
import json
from pathlib import Path

RUNTIME_KEYS = {
    'PENNYAHEAD_PLAID_SANDBOX_ENABLED', 'PLAID_ENV', 'PLAID_CLIENT_ID',
    'PLAID_SECRET', 'PLAID_ACCESS_TOKEN', 'PENNYAHEAD_SANDBOX_SAMPLE_ROTH',
    'PENNYAHEAD_ALPACA_SANDBOX_ENABLED', 'ALPACA_BROKER_SANDBOX_KEY_ID',
    'ALPACA_BROKER_SANDBOX_SECRET_KEY', 'ALPACA_BROKER_ROTH_ACCOUNT_ID',
}


def runtime_config(path: Path | None, assistant: str) -> dict[str, str]:
    settings = {}
    if path:
        for line in path.read_text().splitlines():
            key, separator, value = line.partition('=')
            key = key.strip()
            if not separator or key not in RUNTIME_KEYS:
                continue
            value = value.strip()
            if value.startswith(('"', "'")):
                if len(value) < 2 or value[-1] != value[0]:
                    raise ValueError('Malformed quoted runtime value')
                value = value[1:-1]
            if any(char in value for char in '\r\n\x00'):
                raise ValueError('Runtime values must be single-line strings')
            settings[key] = value
    if settings.get('PENNYAHEAD_PLAID_SANDBOX_ENABLED') == 'true':
        if (settings.get('PLAID_ENV') != 'sandbox'
                or not settings.get('PLAID_ACCESS_TOKEN', '').startswith('access-sandbox-')
                or not settings.get('PLAID_CLIENT_ID') or not settings.get('PLAID_SECRET')):
            raise ValueError('Enabled Plaid requires complete Sandbox credentials')
    if settings.get('PENNYAHEAD_ALPACA_SANDBOX_ENABLED') == 'true':
        if not all(settings.get(key) for key in (
                'ALPACA_BROKER_SANDBOX_KEY_ID', 'ALPACA_BROKER_SANDBOX_SECRET_KEY')):
            raise ValueError('Enabled Alpaca requires complete Sandbox credentials')
    if assistant == 'bedrock':
        settings.update(AWS_REGION='us-east-1', BEDROCK_MODEL_ID='us.amazon.nova-2-lite-v1:0')
    if len(json.dumps(settings).encode()) > 4096:
        raise ValueError('Runtime configuration exceeds the deployment parameter limit')
    return settings
