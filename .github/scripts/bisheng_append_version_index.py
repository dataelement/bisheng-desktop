"""Publish BiSheng history with the desktop product update source."""
import json
import subprocess
import tempfile
import urllib.request
import uuid
from pathlib import Path


def append_version_index(api, repo_id: str, token: str, version: str) -> None:
    project = Path(__file__).resolve().parents[2]
    metadata = json.loads((project / "package.json").read_text(encoding="utf-8"))
    base = metadata["dshDesktopUpdates"]["updatesBaseUrl"]
    if base != "https://dshdesktop.com/work/updates/":
        raise ValueError("Unexpected BiSheng release source")
    if repo_id != "alexyaojin/bisheng-work":
        raise ValueError("Refusing to publish BiSheng history to another product repository")
    request = urllib.request.Request(
        f"https://modelscope.cn/models/{repo_id}/resolve/master/releases/versions.json?release_index={uuid.uuid4().hex}",
        headers={"Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        previous = json.load(response)
    with tempfile.TemporaryDirectory() as work:
        root = Path(work)
        previous_file, names_file, output = (root / name for name in ("previous.json", "names.json", "versions.json"))
        previous_file.write_text(json.dumps(previous), encoding="utf-8")
        names_file.write_text(json.dumps([version]), encoding="utf-8")
        subprocess.run(["node", str(project / "scripts/release/build-version-index.mjs"), str(names_file), str(output), str(previous_file)], check=True)
        index = json.loads(output.read_text(encoding="utf-8"))
        # Repair retained entries made by the previous upstream-default generator too.
        for release in index["versions"]:
            release["archiveUrl"] = base + "archive/" + release["version"] + "/"
        output.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        api.upload_file(path_or_fileobj=str(output), path_in_repo="releases/versions.json", repo_id=repo_id, commit_message=f"Append BiSheng version {version} to release history", token=token)
