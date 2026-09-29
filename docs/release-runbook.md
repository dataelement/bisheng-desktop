# Desktop release runbook

## Manual workflow dispatch

The `Release desktop installers` workflow accepts a `mode` on `workflow_dispatch`. `target` is always honored: `macos` does not start Windows jobs, and `windows` does not start macOS jobs.

- `development` (default): unsigned Dev packages, no signing, no publish.
- `signed`: production-identity signed packages only. Fill `signed_version` with a non-`v` semver such as `0.9.2-test.1`. Artifacts stay on the workflow run; GitHub Release and Feishu do not run. Online update checks remain disabled in these builds.
- `smoke`: recheck an existing `windows-x64` signed artifact without rebuilding or signing. Set `target=windows` and `smoke_run_id` to the source release workflow run ID. The Windows runner installs that exact artifact using the current branch's smoke script.
- `resign`: sign an existing `windows-x64-unsigned` artifact without rerunning the Windows build. Set `target=windows`, `unsigned_run_id` to its source release run, and `signed_version` to the exact version used for that artifact. The self-hosted signer downloads it directly and the final signed Windows installer still runs the installation smoke.
- `prerelease`: production-identity signed packages. Fill `prerelease_tag` with a non-`v` semver such as `2.1.0-rc.1`. Publish to GitHub `--prerelease` only when `target` is `all`. A single-platform prerelease signs that platform and skips publish.

Official releases are still created by pushing a `v*` tag, not by filling the dispatch form. Do not put `v0.9.1` in `prerelease_tag` or `signed_version`.

Online update checks remain disabled while `dataelement/bisheng-work` is private. The package metadata names GitHub Release as the planned feed, but installed clients do not query it or the legacy DSH feed. Before enabling checks, provide a publicly accessible feed and verify a complete signed release on installed macOS and Windows builds; do not embed a GitHub token in the app.

## Build layout and timing

Local `npm test` and `package:*` commands still prepare their own inputs. Already compressed installer artifacts use `compression-level: 0` during upload to avoid redundant compression.

The self-hosted signer downloads artifacts in six concurrent 32 MiB ranges through `gh`, retries bounded requests, and checks the complete archive against GitHub's SHA-256 digest before extraction. A short response, failed transfer or digest mismatch leaves an existing verified output untouched and removes temporary parts.

PPT packages are generated under `.build/ppt-runtime/packages/` and overlaid into the Electron package. The `afterPack` gate checks the physical `dsh-ppt` and `dsh-ppt-composer` directories, including native imports and template previews. A successful source build alone does not verify the packaged paths.

## Local macOS packaging runner

Both macOS jobs use the same self-hosted Apple Silicon runner as CoAligne, with the `self-hosted`, `macOS`, and `ARM64` labels. They run serially when only one runner is available. The Apple Silicon job installs ARM64 Node 22. The Intel job requires Rosetta 2, installs x64 Node 22, and runs `npm ci`, tests, typecheck, and packaging under x64 Bash. Keep the two installs in separate Actions job workspaces: `verify-target` checks the executing Node and the bundled Node architecture before packaging.

Before dispatching, confirm that GitHub Actions is enabled for this repository, that the organization runner group grants it access, and that the runner is online. Install Rosetta 2 on the runner once (`softwareupdate --install-rosetta --agree-to-license`) if the Intel job's preflight reports it missing. Do not install dependencies on the runner's persistent checkout by hand; each job uses `npm ci`.

For a first packaging check, dispatch `Release desktop installers` on `main` with `target=macos` and `mode=development`. This creates unsigned, isolated Dev artifacts in the workflow run and does not publish them. Signed builds additionally require the Apple signing and notarization secrets listed in the workflow. Verify both architecture artifacts and their bundled runtime before using a signed package as a release candidate.

## GitHub Actions parameters for signing and publishing

Add these under **Settings → Secrets and variables → Actions** for this repository. Existing secrets in CoAligne or DSH Desktop cannot be read back through GitHub and are not automatically available to Bisheng Work. The same Apple certificate and API key may be reused only if their owner confirms that this app should be signed under that Apple team.

| Secret | Needed for | Value to provide |
| --- | --- | --- |
| `DESKTOP_CSC_LINK` | Signed macOS | Base64 PKCS#12 Developer ID Application certificate, or a supported HTTPS source |
| `DESKTOP_CSC_KEY_PASSWORD` | Signed macOS | Password for that PKCS#12 certificate |
| `DESKTOP_APPLE_API_KEY` | Signed macOS | Raw App Store Connect `.p8` key contents for notarization |
| `DESKTOP_APPLE_API_KEY_ID` | Signed macOS | Key ID for the `.p8` key |
| `DESKTOP_APPLE_API_ISSUER` | Signed macOS | App Store Connect issuer UUID |
| `DESKTOP_APPLE_TEAM_ID` | Signed macOS | Apple Developer team ID matching the certificate and notarization key |
| `DESKTOP_WINDOWS_SIGNING_PIN` | Signed Windows | PIN for the SafeNet UKey connected to the local runner |

`MODELS_TOKEN` only enables generated release notes; the workflow has a deterministic fallback. `FEISHU_RELEASE_WEBHOOK` enables optional notifications. GitHub supplies `GITHUB_TOKEN` automatically for GitHub Release publication. Neither `MODELSCOPE_TOKEN` nor `CRASH_ADMIN_TOKEN` is needed by this release workflow. CoAligne's GCP parameters are not used by this workflow.

For a signing-only trial, dispatch `mode=signed` with `target=macos` or `target=windows` and a non-`v` `signed_version`. The output remains a workflow artifact. A tag release requires both macOS architectures and Windows signing before publication can finish.

## Local Windows UKey signing runner

Windows packaging and signing run as separate jobs. The GitHub-hosted Windows runner builds an unsigned NSIS installer and uploads a short-lived workflow artifact. A local macOS ARM64 runner downloads it, scans every PE by content, preserves existing vendor signatures, and signs unsigned PEs with Jsign and the SafeNet UKey. It signs the NSIS extraction helper and generated uninstaller during repackaging, then signs the final installer, regenerates the blockmap and `latest.yml`, and uploads the signed release set. Any missing archive, invalid PE, signing failure or repackaging failure stops the run. A second Windows runner installs the final signed artifact into isolated directories, verifies every PE signature and Harness startup, repeats the same-path installation, and checks that Profile data survives. GitHub publication requires both signing and that installed-artifact smoke to pass.

The pinned Windows NSIS template stages the application in a sibling directory before closing the old app, then renames the old directory to a backup and promotes the staged directory. A failed extraction or rename restores the previous installation. The signed installer smoke also locks the old executable to verify that a failed upgrade leaves it runnable. A user-selected different directory is an independent installation: the installer does not automatically uninstall the previous directory, which remains available until the user removes it. Keep the user-selected installation directory when changing this template; the build adapter rejects unexpected upstream template changes.

Runtime dependencies are unpacked beside `app.asar` because Harness, pnpm, native addons, and the standalone Windows Node process need physical paths. The macOS ARM64 test package contains a 6.2 MB `app.asar` and about 588 MB of unpacked dependencies; enabling asar alone did not reduce its 256 MB DMG. Do not remove `node.exe` from Windows yet: the pinned `node-addon-require-builtin@0.1.6` rejects Electron 43.4.0 in RunAsNode mode during Harness boot, even though the Koffi native probe passes ([Windows CI evidence](https://github.com/dataelement/dsh-desktop/actions/runs/35972303467)). Repeat the packaged Windows Harness and final signed-installer gates after a loader version explicitly supports the target Electron fingerprint before revisiting that removal.

Prepare the local runner once:

1. Register it with the `self-hosted`, `macOS`, and `ARM64` labels.
2. Install SafeNet Authentication Client and confirm `/usr/local/lib/libeTPkcs11.dylib` is readable.
3. Connect the UKey before pushing a release tag.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and create a repository secret named `DESKTOP_WINDOWS_SIGNING_PIN` containing the UKey PIN. For stronger release controls, use an environment secret and add the matching `environment` to the `sign-windows` job.
5. Restrict release tag creation and workflow changes to trusted maintainers. A self-hosted runner can access any secret injected into its job.

The workflow pins Jsign 7.5 by SHA-256 and uses the SafeNet `ETOKEN` store, SHA-256 signing, and a DigiCert RFC 3161 timestamp. GitHub injects the PIN only into the signing step. The step copies it to a mode-`600` temporary file, removes it from the shell environment, and deletes the file when the step exits. The workflow never prints the PIN or passes it as a command-line argument.

The configured update publisher is `Beijing Shuju Xiangsu Intelligence Technology Co., Ltd.`, taken from the signed v0.9.2 installer. If the signing certificate changes, update `build.win.signtoolOptions.publisherName` only after checking the new certificate subject and the updater's signature verification on an installed Windows build. After a tag release succeeds, verify that the Windows installer shows the expected publisher and a valid RFC 3161 timestamp in its Digital Signatures properties. Never reuse a published tag; fix the issue and release a new version.
