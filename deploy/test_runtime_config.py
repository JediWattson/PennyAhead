import tempfile
import unittest
from pathlib import Path

from runtime_config import runtime_config


class RuntimeConfigTests(unittest.TestCase):
    def parse(self, text, assistant='bedrock'):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'runtime.env'
            path.write_text(text)
            return runtime_config(path, assistant)

    def test_only_selected_integration_values_leave_the_machine(self):
        result = self.parse('AWS_PROFILE=personal\nAWS_ACCESS_KEY_ID=private\n'
                            'AWS_SECRET_ACCESS_KEY=private\nOPENAI_API_KEY=private\n'
                            'PENNYAHEAD_ACCESS_MODE=disabled\nPENNYAHEAD_ORIGIN_TOKEN=private\n'
                            'PLAID_ENV="sandbox"\n')
        self.assertEqual(result, {'PLAID_ENV': 'sandbox', 'AWS_REGION': 'us-east-1',
                                  'BEDROCK_MODEL_ID': 'us.amazon.nova-2-lite-v1:0'})

    def test_enabled_plaid_requires_sandbox_credentials(self):
        valid = ('PENNYAHEAD_PLAID_SANDBOX_ENABLED=true\nPLAID_ENV=sandbox\n'
                 'PLAID_CLIENT_ID=test\nPLAID_SECRET=test\nPLAID_ACCESS_TOKEN=access-sandbox-test\n')
        self.assertEqual(self.parse(valid)['PLAID_ACCESS_TOKEN'], 'access-sandbox-test')
        for bad in (valid.replace('access-sandbox-', 'access-production-'),
                    valid.replace('PLAID_SECRET=test\n', ''),
                    valid.replace('PLAID_ENV=sandbox', 'PLAID_ENV=production')):
            with self.assertRaises(ValueError):
                self.parse(bad)

    def test_mock_without_runtime_file_has_no_integration_settings(self):
        self.assertEqual(runtime_config(None, 'mock'), {})

    def test_invalid_or_oversized_values_are_rejected(self):
        for text in ('PLAID_SECRET="unterminated', 'PLAID_SECRET=abc\x00def',
                     'PLAID_SECRET=' + 'a' * 4096,
                     'PENNYAHEAD_ALPACA_SANDBOX_ENABLED=true'):
            with self.assertRaises(ValueError):
                self.parse(text)


if __name__ == '__main__':
    unittest.main()
