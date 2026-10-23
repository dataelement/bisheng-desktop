import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))
import signed_test_build as build
import signed_test_notification as notification
import test_change_summary as summary

VALID = {"功能": ["企业模型支持推理强度设置和原生响应接口。"], "问题修复": ["修复授权撤销后会话模型选择无法恢复的问题。"]}


class TestChangeSummary(unittest.TestCase):
    def test_chinese_output_and_empty_categories(self):
        text = summary.render_summary(json.dumps(VALID))
        self.assertEqual(text, "**功能**\n\n- 企业模型支持推理强度设置和原生响应接口。\n\n**问题修复**\n\n- 修复授权撤销后会话模型选择无法恢复的问题。")
        self.assertIn("暂无可确认的变更", summary.render_summary('{"功能":[],"问题修复":[]}'))

    def test_allows_more_than_four_items_per_category(self):
        data = {section: [f"{section}第 {index} 项独立变更。" for index in range(7)] for section in summary.SECTIONS}
        text = summary.render_summary(json.dumps(data))
        for items in data.values():
            for item in items:
                self.assertIn(f"- {item}", text)
        self.assertNotIn("最多 4 条", summary.PROMPT)

    def test_rejects_history_english_and_unbounded_output(self):
        invalid_items = [
            "enterprise: 支持推理", "feat(enterprise): 新增能力", "Only English text",
            "修复问题 (#55)", "Co-authored-by: 作者", "修复 123abcd 问题", "中文\n额外内容",
            "中文" * 51, "", " 中文说明", "中文 https://example.test", 42,
        ]
        for item in invalid_items:
            with self.subTest(item=item), self.assertRaises(ValueError):
                summary.render_summary(json.dumps({"功能": [item], "问题修复": []}))
        for data in [[], {}, {**VALID, "其他变更": []}, {"功能": "中文", "问题修复": []},
                     {"功能": ["中文说明"] * 5, "问题修复": []},
                     {"功能": ["中文说明"], "问题修复": ["中文说明"]}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                summary.render_summary(json.dumps(data))
        with self.assertRaises(ValueError):
            summary.render_summary("not JSON")

    def test_model_prompt_and_timeout(self):
        with patch.dict(os.environ, {"COPILOT_GITHUB_TOKEN": "fixture", "RELEASE_NOTES_MODEL": "fixture-model"}), patch.object(summary.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(VALID))) as run:
            text = summary.summarize_changes("enterprise: reasoning", "adapter.py | 2", "diff --git adapter.py")
        args = run.call_args.args[0]
        self.assertEqual(args[0], "copilot")
        self.assertEqual(args[args.index("--model") + 1], "fixture-model")
        self.assertIn("--no-ask-user", args)
        self.assertEqual(run.call_args.kwargs["timeout"], 180)
        prompt = args[args.index("-p") + 1]
        self.assertIn("不要逐条翻译或罗列提交历史", prompt)
        self.assertIn("不可信数据", prompt)
        self.assertIn("diff --git adapter.py", prompt)
        self.assertNotIn("enterprise:", text)
        self.assertIn("企业模型", text)

    def test_failure_never_falls_back_to_raw_commits(self):
        failures = [FileNotFoundError(), subprocess.TimeoutExpired("copilot", 180),
                    subprocess.CalledProcessError(1, "copilot", stderr="secret"),
                    subprocess.CompletedProcess([], 0, "enterprise: English history")]
        for failure in failures:
            kwargs = {"return_value": failure} if isinstance(failure, subprocess.CompletedProcess) else {"side_effect": failure}
            with self.subTest(failure=failure), patch.dict(os.environ, {"COPILOT_GITHUB_TOKEN": "fixture"}), patch.object(summary.subprocess, "run", **kwargs), contextlib.redirect_stdout(io.StringIO()) as logs:
                text = summary.summarize_changes("raw secret history", "", "")
            self.assertEqual(text, summary.UNAVAILABLE)
            self.assertNotIn("secret", text + logs.getvalue())
        with patch.dict(os.environ, {"COPILOT_GITHUB_TOKEN": ""}), patch.object(summary.subprocess, "run") as run:
            self.assertEqual(summary.summarize_changes("raw history", "", ""), summary.UNAVAILABLE)
            run.assert_not_called()

    def test_real_git_range_and_code_evidence(self):
        with tempfile.TemporaryDirectory() as work, contextlib.chdir(work), patch.dict(os.environ, {
            "GIT_AUTHOR_NAME": "Test", "GIT_COMMITTER_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.com", "GIT_COMMITTER_EMAIL": "test@example.com",
        }), patch.object(build, "summarize_changes", return_value="中文总结") as summarize:
            def git(*args):
                return subprocess.check_output(["git", *args], text=True).strip()

            def commit(title, name, content):
                Path(name).write_text(content, encoding="utf-8")
                git("add", name)
                git("commit", "-qm", title)

            def evidence():
                self.assertEqual(build.build_test_changes("https://github.com/example/desktop"), "中文总结")
                return summarize.call_args.args

            git("init", "-q")
            commit("feat: Historical feature", "old.txt", "baseline")
            git("tag", "v1.0.0")
            commit("feat: Per-page preview", "preview.txt", "preview implementation")
            commit("fix: Keep old versions", "archive.txt", "archive implementation")
            git("checkout", "-qb", "unrelated", "v1.0.0")
            commit("feat: Unrelated branch", "unrelated.txt", "unrelated")
            git("tag", "v9.0.0")
            git("checkout", "-q", "-")
            commits, statistics, code = evidence()
            self.assertIn("Per-page preview", commits)
            self.assertIn("Keep old versions", commits)
            self.assertNotIn("Historical feature", commits)
            self.assertNotIn("Unrelated branch", commits)
            self.assertIn("preview.txt", statistics)
            self.assertIn("+preview implementation", code)
            self.assertNotIn("+baseline", code)
            git("tag", "V1.1.0")
            self.assertIn("Per-page preview", evidence()[0])
            commit("perf: Faster conversion", "fast.txt", "fast implementation")
            commits, _, code = evidence()
            self.assertIn("Faster conversion", commits)
            self.assertNotIn("Per-page preview", commits)
            self.assertNotIn("preview.txt", code)
            git("tag", "-d", "v1.0.0", "V1.1.0", "v9.0.0")
            commits, _, code = evidence()
            self.assertIn("Historical feature", commits)
            self.assertIn("+baseline", code)
            self.assertNotIn("Unrelated branch", commits)

    def test_chinese_summary_reaches_notification_without_history(self):
        text = summary.render_summary(json.dumps(VALID))
        with tempfile.TemporaryDirectory() as work:
            directory = Path(work)
            (directory / "bisheng-windows-x64-setup.exe").write_bytes(b"installer")
            with patch.object(notification, "build_test_changes", return_value=text), patch.object(notification, "verify_download"), patch.object(notification, "send_feishu_notification") as send:
                notification.notify(directory, "windows", "1.1.0-test.1", "example/desktop", "fixture")
            notes = send.call_args.args[2]
            self.assertIn(text, notes)
            self.assertNotIn("Co-authored-by", notes)
            self.assertNotIn("其他变更", notes)
            self.assertLess(len(notes), 1200)


if __name__ == "__main__":
    unittest.main()
