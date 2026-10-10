#!/usr/bin/env python3
"""Notify Feishu after signed test installers are publicly downloadable."""

from __future__ import annotations

import argparse
import os
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

from feishu_release_notes import send_feishu_notification

INSTALLERS = {
    "macos": [
        ("macOS Apple Silicon", "bisheng-mac-arm64.dmg"),
        ("macOS Intel", "bisheng-mac-x64.dmg"),
    ],
    "windows": [("Windows x64", "bisheng-windows-x64-setup.exe")],
}


def verify_download(url: str, expected_size: int) -> None:
    # Read only one byte: checking a large installer must not download it again.
    request = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_range = response.headers.get("Content-Range")
                # ModelScope's CDN can return a valid range with HTTP 200.
                if content_range:
                    valid = response.status in (200, 206) and content_range == f"bytes 0-0/{expected_size}"
                else:
                    valid = response.status == 200 and response.headers.get("Content-Length") == str(expected_size)
                if not valid or len(response.read(1)) != 1:
                    raise ValueError(f"Unexpected download response: status={response.status}, range={content_range}, length={response.headers.get('Content-Length')}")
            return
        except Exception as error:
            if attempt == 5:
                raise RuntimeError(f"ModelScope test installer is not publicly downloadable: {url}") from error
            time.sleep(10)


def notify(directory: Path, target: str, version: str, repo_id: str, webhook: str) -> None:
    if not webhook:
        raise ValueError("Feishu webhook is required for signed test builds")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version):
        raise ValueError("signed_version must be a non-v semver")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo_id):
        raise ValueError("Invalid ModelScope repository ID")
    if target not in ("all", *INSTALLERS):
        raise ValueError("Invalid test target")
    platforms = list(INSTALLERS) if target == "all" else [target]
    links = []
    for platform in platforms:
        for label, name in INSTALLERS[platform]:
            file = directory / name
            if not file.is_file() or file.stat().st_size == 0:
                raise ValueError(f"Missing or empty signed installer: {name}")
            url = f"https://modelscope.cn/models/{repo_id}/resolve/master/releases/test/{quote(version, safe='')}/{name}"
            verify_download(url, file.stat().st_size)
            links.append(f"- [{label}]({url})")
    send_feishu_notification(
        webhook,
        version,
        "本次为签名测试安装包，用于安装和功能验收，请手动下载安装。在线更新未启用。",
        signed_test=True,
        download_links="**ModelScope 下载地址**\n" + "\n".join(links),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--target", choices=["all", "macos", "windows"], required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    notify(args.directory, args.target, args.version, os.environ["MODELSCOPE_REPO_ID"], os.environ["FEISHU_RELEASE_WEBHOOK"])


if __name__ == "__main__":
    main()
