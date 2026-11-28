"""Offline publisher checks; no credentials or network requests."""
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

source = Path(__file__).with_name("bisheng_append_version_index.py")
spec = importlib.util.spec_from_file_location("bisheng_index", source)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class BiShengHistoryTest(unittest.TestCase):
    def test_preserves_history_and_repairs_both_retained_and_new_archive_urls(self):
        previous = {"versions": [{"version": "1.2.0", "tag": "v1.2.0", "archiveUrl": "https://dshdesktop.com/updates/archive/1.2.0/"}]}
        api = Mock()
        published = {}
        def build(command, check):
            output = Path(command[3])
            output.write_text(json.dumps({"versions": previous["versions"] + [{"version": "1.3.0", "tag": "v1.3.0", "archiveUrl": "https://dshdesktop.com/updates/archive/1.3.0/"}]}), encoding="utf-8")
        def upload(**kwargs):
            published.update(json.loads(Path(kwargs["path_or_fileobj"]).read_text(encoding="utf-8")))
            self.assertEqual(kwargs["repo_id"], "alexyaojin/bisheng-work")
            self.assertEqual(kwargs["path_in_repo"], "releases/versions.json")
        api.upload_file.side_effect = upload
        with patch.object(publisher.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(previous).encode())) as fetch, patch.object(publisher.subprocess, "run", side_effect=build):
            publisher.append_version_index(api, "alexyaojin/bisheng-work", "test-token", "1.3.0")
        self.assertIn("alexyaojin/bisheng-work/", fetch.call_args.args[0].full_url)
        self.assertEqual([row["archiveUrl"] for row in published["versions"]], ["https://dshdesktop.com/work/updates/archive/1.2.0/", "https://dshdesktop.com/work/updates/archive/1.3.0/"])

    def test_wrong_product_and_unavailable_history_never_publish(self):
        api = Mock()
        with self.assertRaises(ValueError):
            publisher.append_version_index(api, "alexyaojin/dsh-desktop", "test-token", "1.3.0")
        with patch.object(publisher.urllib.request, "urlopen", side_effect=OSError("offline")), self.assertRaises(OSError):
            publisher.append_version_index(api, "alexyaojin/bisheng-work", "test-token", "1.3.0")
        api.upload_file.assert_not_called()


if __name__ == "__main__":
    unittest.main()
