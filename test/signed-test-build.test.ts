import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('signed test packaging and notification', () => {
  it('builds prefixed upload destinations and notification links for each test target', () => {
    execFileSync('python3', ['-c', String.raw`
import contextlib, os, sys, tempfile, types
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path('.github/scripts').resolve()))
import signed_test_build as build

with tempfile.TemporaryDirectory() as work:
    directory = Path(work)
    for name in ['bisheng-mac-arm64.dmg', 'bisheng-mac-x64.dmg', 'bisheng-windows-x64-setup.exe']:
        (directory / name).write_text('content', encoding='utf-8')
    for target, count in [('all', 3), ('macos', 2), ('windows', 1)]:
        files = build.installer_paths(directory, target)
        assert len(files) == count
        notes = build.build_notification('1.0.0-test.1', files, 'example/desktop', 'test/1.0.0-test.1/42', 'https://github.com/example/desktop/actions/runs/42')
        assert notes.count('/resolve/master/test/') == count
        assert '测试建议' in notes
        assert '本次为签名测试安装包' not in notes
        assert '已通过签名' not in notes
        assert '客户端中更新' not in notes
    assert build.test_prefix('1.0.0-test.1', '42') == 'test/1.0.0-test.1/42'
    for version in ['../latest', 'v1.0.0', '1.0.0/test']:
        try:
            build.test_prefix(version, '42')
        except ValueError:
            pass
        else:
            raise AssertionError(f'invalid version accepted: {version}')
    for run_id in ['0', '-1', 'abc']:
        try:
            build.test_prefix('1.0.0-test.1', run_id)
        except ValueError:
            pass
        else:
            raise AssertionError(f'invalid run_id accepted: {run_id}')
`], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  })

  it('uploads all target installers and notifies only after public download verification', () => {
    execFileSync('python3', ['-c', String.raw`
import contextlib, os, sys, tempfile, types
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path('.github/scripts').resolve()))
import signed_test_build as build

with tempfile.TemporaryDirectory() as work:
    directory = Path(work)
    (directory / 'bisheng-windows-x64-setup.exe').write_text('content', encoding='utf-8')
    events = []
    api = MagicMock()
    api.upload_file.side_effect = lambda **kwargs: events.append(('upload', kwargs['path_in_repo']))
    sdk = types.ModuleType('modelscope.hub.api')
    sdk.HubApi = lambda: api
    env = dict(MODELSCOPE_REPO_ID='example/desktop', MODELSCOPE_TOKEN='fixture', FEISHU_RELEASE_WEBHOOK='fixture', GITHUB_SERVER_URL='https://github.com', GITHUB_REPOSITORY='example/desktop', GITHUB_STEP_SUMMARY=str(directory / 'summary'))
    argv = ['signed_test_build.py', '--directory', work, '--target', 'windows', '--version', '1.0.0-test.1', '--run-id', '42']
    with patch.dict(sys.modules, {'modelscope': types.ModuleType('modelscope'), 'modelscope.hub': types.ModuleType('modelscope.hub'), 'modelscope.hub.api': sdk}), patch.dict(os.environ, env), patch.object(sys, 'argv', argv), patch.object(build, 'build_test_changes', return_value='feat: New Office preview\nDescription of preview') as changes, patch.object(build, 'verify_download', side_effect=lambda *args: events.append(('verify', args[0]))) as verify, patch.object(build, 'send_feishu_notification', side_effect=lambda *args, **kw: events.append(('notify', kw))) as notify:
        build.main()
        assert [e[0] for e in events] == ['upload', 'verify', 'upload', 'verify', 'notify']
        assert events[0][1] == 'test/1.0.0-test.1/42/bisheng-windows-x64-setup.exe'
        assert events[2][1] == 'test/1.0.0-test.1/42/test-changes.md'
        assert events[4][1] == {'test_build': True}
        assert 'Description of preview' in notify.call_args.args[2]
        assert 'Windows x64' in (directory / 'summary').read_text(encoding='utf-8')
        notify.reset_mock()
        api.upload_file.side_effect = RuntimeError('upload failed')
        try:
            build.main()
        except RuntimeError:
            pass
        else:
            raise AssertionError('upload failure swallowed')
        notify.assert_not_called()
        verify.side_effect = None
        changes.side_effect = RuntimeError('git history unavailable')
        api.upload_file.reset_mock()
        try:
            build.main()
        except RuntimeError:
            pass
        else:
            raise AssertionError('missing change evidence accepted')
        api.upload_file.assert_not_called()
        notify.assert_not_called()
        changes.side_effect = None
        api.upload_file.side_effect = None
        verify.side_effect = RuntimeError('public download failed')
        try:
            build.main()
        except RuntimeError:
            pass
        else:
            raise AssertionError('unverified installer published')
        notify.assert_not_called()
print('signed test build behavior passed')
`], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  })

  it('waits for the selected platform verification gates in signed mode', () => {
    const yaml = require('js-yaml') as { load(source: string): { jobs: Record<string, { needs: string[]; if: string }> } }
    const workflow = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8'))
    const job = workflow.jobs['publish-signed']
    expect(job?.needs).toEqual(['macos', 'sign-windows'])
    expect(job?.if).toContain("inputs.mode == 'signed'")
    expect(job?.if).toContain("inputs.target == 'windows' && needs.sign-windows.result == 'success'")
    expect(job?.if).toContain("inputs.target == 'macos' && needs.macos.result == 'success'")
  })

  it('lists features and descriptions since the nearest reachable tag using real git history', () => {
    const output = execFileSync('python3', ['-c', String.raw`
import contextlib, os, sys, tempfile, subprocess
from pathlib import Path
sys.path.insert(0, str(Path('.github/scripts').resolve()))
import signed_test_build as build
original_directory = Path.cwd()
# Restore cwd before TemporaryDirectory cleanup: Windows locks the current directory.
with tempfile.TemporaryDirectory() as work, contextlib.chdir(work):
    os.environ.update(GIT_AUTHOR_NAME='Test', GIT_COMMITTER_NAME='Test', GIT_AUTHOR_EMAIL='test@example.com', GIT_COMMITTER_EMAIL='test@example.com')
    def git(*args):
        return subprocess.check_output(['git', *args], text=True).strip()
    git('init', '-q')
    def commit(title, body=''):
        git('commit', '--allow-empty', '-qm', title, '-m', body)
    commit('feat: Historical feature')
    git('tag', 'v1.0.0')
    commit('feat(office): Per-page preview', 'Shows each completed page before the batch ends.')
    commit('fix: Keep old versions', 'Retains archive history after release.')
    # An unrelated newer tag must not become the baseline.
    git('checkout', '-qb', 'unrelated', 'v1.0.0')
    commit('feat: Unrelated branch')
    git('tag', 'v9.0.0')
    git('checkout', '-q', '-')
    notes = build.build_test_changes('https://github.com/example/desktop')
    assert '上一个 tag：'+chr(96)+'v1.0.0' in notes
    assert '**功能**' in notes and '**修复**' in notes
    assert 'Per-page preview' in notes and 'Shows each completed page' in notes
    assert 'Retains archive history' in notes
    assert 'Historical feature' not in notes and 'Unrelated branch' not in notes
    assert '/compare/' not in notes
    assert '完整代码比较' not in notes
    git('tag', 'V1.1.0')
    assert 'Per-page preview' in build.build_test_changes('https://github.com/example/desktop')
    commit('perf: Faster conversion')
    notes = build.build_test_changes('https://github.com/example/desktop')
    assert 'V1.1.0' in notes and 'Faster conversion' in notes
    assert 'Per-page preview' not in notes
    git('tag', '-d', 'v1.0.0', 'V1.1.0', 'v9.0.0')
    notes = build.build_test_changes('https://github.com/example/desktop')
    assert '无历史版本 tag' in notes and 'Historical feature' in notes
assert Path.cwd() == original_directory
assert not Path(work).exists()
print('tag range behavior passed')
`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(output).toContain('tag range behavior passed')
  })
})
