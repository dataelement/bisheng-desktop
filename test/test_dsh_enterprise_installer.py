import importlib.util
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from io import StringIO
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/install-dsh-enterprise.py'
spec = importlib.util.spec_from_file_location('enterprise_installer', SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerConfigTest(unittest.TestCase):
    def test_rejects_an_existing_install_directory_before_running_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(tag='v3.0.0-beta2', public_url='https://ai.example.com',
                                   install_dir=Path(directory))
            with self.assertRaisesRegex(installer.InstallError, '安装目录已存在'):
                installer.validate_inputs(args)

    def test_mysql_failure_does_not_print_password_or_sql(self):
        failure = SimpleNamespace(returncode=1, stdout='', stderr="SQL error near 'private-password'")
        with patch.object(installer.subprocess, 'run', return_value=failure):
            with self.assertRaises(installer.InstallError) as caught:
                installer.run(['docker', 'compose'], input_text="CREATE USER 'private-password'", sensitive=True)
        self.assertNotIn('private-password', str(caught.exception))
        self.assertIn('输出可能包含凭据，已隐藏', str(caught.exception))

    def test_mysql_password_file_is_removed_after_query_failure(self):
        copied = []
        removed_from_container = []

        def fake_compose(_directory, *command, **_kwargs):
            if command[0] == 'cp':
                copied.append(Path(command[1]))
                self.assertTrue(copied[-1].is_file())
            elif command[:3] == ('exec', '-T', 'mysql') and command[3] == 'rm':
                removed_from_container.append(command)
            elif command[:3] == ('exec', '-T', 'mysql'):
                raise installer.InstallError('query failed')
            return ''

        with patch.object(installer, 'base_compose', side_effect=fake_compose):
            with self.assertRaisesRegex(installer.InstallError, 'query failed'):
                installer.mysql_input(Path('/tmp'), 'root-secret', 'SELECT 1;')
        self.assertEqual(len(copied), 1)
        self.assertFalse(copied[0].exists())
        self.assertEqual(len(removed_from_container), 1)

    def test_streams_carriage_return_download_progress(self):
        output = []
        process = SimpleNamespace(stdout=StringIO('Downloading 12MB/100MB\rDownloading 100MB/100MB\nDone\n'),
                                  wait=lambda: 0)
        with patch.object(installer.subprocess, 'Popen', return_value=process), \
             patch.object(installer, 'say', side_effect=output.append):
            installer.run(['docker', 'pull', 'image'], stream=True)
        self.assertEqual(output, ['  Downloading 12MB/100MB', '  Downloading 100MB/100MB', '  Done'])

    def test_prepares_matching_gateway_backend_and_nginx_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / 'docker'
            (docker / 'bisheng/config').mkdir(parents=True)
            (docker / 'nginx/conf.d').mkdir(parents=True)
            (docker / 'bisheng/config/config.yaml').write_text(
                'redis_url: "redis://redis:6379/1"\n'
                'sso_sync:\n  gateway_hmac_secret: "old"\n  signature_header: "X-Signature"\n'
            )
            (docker / 'nginx/conf.d/default.conf').write_text(
                'server {\n  listen 3001;\n  location ~ ^(/workspace)?/api(/|$) {\n    proxy_pass http://backend_server;\n  }\n}\n'
            )
            template = root / 'application.yml'
            template.write_text(
                'spring:\n  datasource:\n    password: __DSH_GATEWAY_DB_PASSWORD__\n'
                'bisheng:\n  gateway-hmac-secret: __DSH_GATEWAY_HMAC_SECRET__\n'
                '  home-url: __DSH_PUBLIC_URL__\n  web-home-url: __DSH_PUBLIC_URL__\n'
            )
            sql = root / 'init.sql'
            sql.write_text('CREATE TABLE gt_example (id INT);\n')
            installer.prepare_files(docker, SimpleNamespace(gateway_config=template, gateway_sql=sql),
                                    'https://ai.example.com', 'db-secret', 'hmac-secret')
            app = (docker / 'gateway/application.yml').read_text()
            backend = (docker / 'bisheng/config/config.yaml').read_text()
            nginx = (docker / 'nginx/conf.d/default.conf').read_text()
            overlay = (docker / 'docker-compose.gateway.yml').read_text()
            self.assertIn('password: db-secret', app)
            self.assertIn('gateway-hmac-secret: hmac-secret', app)
            self.assertIn('gateway_hmac_secret: !env BS_SSO_SYNC__GATEWAY_HMAC_SECRET', backend)
            self.assertIn('platform_public_url: "https://ai.example.com"', backend)
            self.assertLess(nginx.index('location ~ ^/api/dsh/'), nginx.index('location ~ ^(/workspace)?/api'))
            self.assertIn('X-Forwarded-Proto https', nginx)
            self.assertIn('BS_SSO_SYNC__GATEWAY_HMAC_SECRET: "hmac-secret"', overlay)
            self.assertEqual((docker / 'gateway/application.yml').stat().st_mode & 0o777, 0o600)

    def test_public_url_rejects_credentials_and_paths(self):
        for value in ('https://user:pass@example.com', 'https://example.com/path', 'file:///tmp/a'):
            with self.assertRaises(installer.InstallError):
                installer.validate_public_url(value)


if __name__ == '__main__':
    unittest.main()
