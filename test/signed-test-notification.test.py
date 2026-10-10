import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))
import signed_test_notification as module
import feishu_release_notes as sender


class SignedNotificationTest(unittest.TestCase):
    def test_current_packaging_names(self):
        package = json.loads((Path(__file__).resolve().parents[1] / "package.json").read_text())
        build = package["build"]
        mac_template = build["artifactName"]
        windows_template = build["nsis"]["artifactName"]
        names_by_target = {
            "macos": [mac_template.replace("${os}", "mac").replace("${arch}", arch).replace("${ext}", "dmg") for arch in ["arm64", "x64"]],
            "windows": [windows_template.replace("${arch}", "x64").replace("${ext}", "exe")],
        }
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for names in names_by_target.values():
                for name in names:
                    (directory / name).write_bytes(b"installer")
            for target in ["macos", "windows", "all"]:
                names = sum(names_by_target.values(), []) if target == "all" else names_by_target[target]
                with self.subTest(target=target), patch.object(module, "verify_download") as verify, patch.object(module, "send_feishu_notification") as send:
                    module.notify(directory, target, "0.11.0-test.2", "owner/product", "hook")
                    urls = [f"https://modelscope.cn/models/owner/product/resolve/master/releases/test/0.11.0-test.2/{name}" for name in names]
                    self.assertEqual(verify.call_args_list, [unittest.mock.call(url, 9) for url in urls])
                    send.assert_called_once()
                    for url in urls:
                        self.assertIn(url, send.call_args.kwargs["download_links"])

    def test_platform_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for entries in module.INSTALLERS.values():
                for _, name in entries:
                    (directory / name).write_bytes(b"test")
            for target, count in [("macos", 2), ("windows", 1), ("all", 3)]:
                with self.subTest(target=target), patch.object(module, "verify_download") as verify, patch.object(module, "send_feishu_notification") as send:
                    module.notify(directory, target, "1.0.2-test.1+ci", "owner/product", "hook")
                    self.assertEqual(verify.call_count, count)
                    send.assert_called_once()
                    links = send.call_args.kwargs["download_links"]
                    self.assertEqual(links.count("https://modelscope.cn/"), count)
                    self.assertIn("/releases/test/1.0.2-test.1%2Bci/", links)
                    self.assertTrue(send.call_args.kwargs["signed_test"])
                    self.assertEqual("windows-x64" in links, target != "macos")
                    self.assertEqual("mac-arm64" in links, target != "windows")
                    self.assertNotIn("/releases/latest/", links)
                    self.assertNotIn("smoke", send.call_args.args[2])
            with patch.object(module, "verify_download", side_effect=RuntimeError("not public")), patch.object(module, "send_feishu_notification") as send:
                with self.assertRaises(RuntimeError):
                    module.notify(directory, "all", "1.0.2", "owner/product", "hook")
                send.assert_not_called()
            (directory / module.INSTALLERS["windows"][0][1]).write_bytes(b"")
            with patch.object(module, "send_feishu_notification") as send:
                with self.assertRaises(ValueError):
                    module.notify(directory, "windows", "1.0.2", "owner/product", "hook")
                send.assert_not_called()

    def test_invalid_inputs(self):
        for target, version, repo, hook in [("all", "1.0.2", "owner/product", ""), ("all", "../bad", "owner/product", "hook"), ("all", "1.0.2", "../bad", "hook"), ("bad", "1.0.2", "owner/product", "hook")]:
            with patch.object(module, "send_feishu_notification") as send:
                with self.assertRaises(ValueError):
                    module.notify(Path("."), target, version, repo, hook)
                send.assert_not_called()

    def test_range_probe(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"t"
        for status, headers in [(206, {"Content-Range": "bytes 0-0/4"}), (200, {"Content-Range": "bytes 0-0/4"}), (200, {"Content-Length": "4"})]:
            response.status, response.headers = status, headers
            with patch.object(module.urllib.request, "urlopen", return_value=response) as request:
                module.verify_download("https://example.test/file", 4)
                self.assertEqual(request.call_args.args[0].get_header("Range"), "bytes=0-0")
                self.assertEqual(response.read.call_args.args, (1,))
        response.headers = {"Content-Length": "99"}
        with patch.object(module.urllib.request, "urlopen", return_value=response) as request, patch.object(module.time, "sleep"):
            with self.assertRaises(RuntimeError):
                module.verify_download("https://example.test/file", 4)
            self.assertEqual(request.call_count, 6)

    def test_card_and_feishu_error(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"code":0}'
        with patch.object(sender.urllib.request, "urlopen", return_value=response) as request:
            sender.send_feishu_notification("https://example.test/hook", "1.0.2", "notes", signed_test=True, download_links="test links")
            payload = json.loads(request.call_args.args[0].data)
            self.assertIn("测试打包完成", payload["card"]["header"]["title"]["content"])
            self.assertEqual(payload["card"]["header"]["template"], "orange")
            self.assertEqual(payload["card"]["elements"][1]["text"]["content"], "test links")
        response.read.return_value = b'{"code":123}'
        with patch.object(sender.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(SystemExit):
                sender.send_feishu_notification("https://example.test/hook", "1.0.2", "notes", signed_test=True, download_links="test links")


if __name__ == "__main__":
    unittest.main()
