<h1 align="center">
  <img src="docs/images/readme-logo-black-v020.png" width="274" alt="BISHENG" valign="middle" />
</h1>

<p align="center">
  <strong>BISHENG Desktop is a desktop Agent connecting local work with enterprise AI.</strong><br />
  Employees use an enterprise account to access authorized models, knowledge bases, tools and skills: Chat handles cloud Q&A and multi-step tasks, while Work processes local materials in authorized directories. The enterprise centrally manages resources, permissions, credits and usage.<br />
  <a href="https://dshdesktop.com/zh/enterprise/">Download BISHENG Desktop</a> · <a href="https://github.com/dataelement/bisheng">BISHENG server repository</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.es.md">Español</a> · <a href="README.pt.md">Português</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

## What BISHENG Desktop can do

- **Chat: delegate tasks to your enterprise cloud.** Ask questions about materials, or use task mode for multi-step processing, skills and file generation, with visibility into progress and results.
- **Work: keep working with local materials.** Select an authorized directory to organize materials, analyze data and create editable Word, Excel and PowerPoint files, then refine and save them in the permitted directory.
- **Use enterprise resources with the right permissions.** Access authorized models, knowledge spaces, API/MCP tools and skills through your enterprise account, and open published applications, assistants and workflows in the Application Center.
- **Central enterprise management.** Administrators configure resources and permissions, distribute plugins and workbenches, and manage monthly credits and call usage. Enterprise model calls in Chat and Work share the current user's credit ledger.
- **Web and desktop collaboration.** When the same enterprise account opens the same server-side task in web and desktop Chat, both can show synchronized task events and completion status. Local Work tasks and their outputs are managed as separate records.

![BISHENG web, desktop and mobile interfaces](docs/images/bisheng-platform-overview.png)

> The mobile app is coming soon; features and release plans depend on the relevant release documentation. Enterprise integration capabilities, deployment requirements, and open-source and enterprise edition availability also depend on the relevant release documentation.

## BISHENG platform and related projects

**BISHENG is an open-source, all-in-one enterprise Agent platform** focused on office productivity and enterprise AI adoption. It provides the client with models, knowledge, tools, skills, applications and centralized management.

- [BISHENG enterprise platform](https://github.com/dataelement/bisheng): deploy enterprise AI services and centrally manage organizational resources, permissions and usage.
- [DSH Desktop](https://github.com/dataelement/dsh-desktop): an open-source desktop Agent foundation built on DeepSeek Harness. BISHENG Desktop builds on it to connect enterprise AI services.

## Download and install

Get the installer from the [BISHENG Desktop website](https://dshdesktop.com/zh/enterprise/) and use it with your enterprise's BISHENG deployment. Sign in with your enterprise account to use the resources configured and authorized by your administrator.

For standalone personal use, visit the [DSH Desktop website](https://dshdesktop.com/zh/).

## Office files and desktop capabilities

- **Office file delivery**: choose a template in the built-in PPT mode, describe the content and generate an editable PPTX. The desktop runtime includes Python and Office libraries for generating and checking DOCX, PPTX and XLSX files. See the [PPT guide](packages/ppt-runtime/README.md) for templates and validation.
- **Local workspaces and configuration**: manage workspaces through the native directory picker. Profiles, plugins, sessions and model settings are stored outside the installation directory and retained on upgrades. See [Preset packages](docs/preset-packages.md) for importing and exporting custom configurations.
- **Updates and recovery**: online updates are not yet enabled in current installed builds. Get a newer installer from the [website](https://dshdesktop.com/zh/enterprise/); availability of online updates depends on the release documentation. For plugin failures, choose “Restart in Safe Mode…” from the `Harness` menu to temporarily disable third-party plugins while preserving normal Profile data. Diagnostics are written to `harness.log`. See [plugin recovery](docs/architecture.md#profiles-and-plugin-recovery) and [updates](docs/architecture.md#updates).

## Phone connection and data boundaries

The desktop runtime retains QR-code phone pairing: choose “Connect phone…” from the `Harness` menu and scan over WiFi. An internet tunnel also requires the connection password shown on the computer. By default it expires in 5 minutes; a persistent password is created only after explicit opt-in. Disconnecting on the desktop invalidates the phone session. If the connection fails, use “Can't open the QR link? Try another route” to switch routes.

This browser pairing capability is separate from the upcoming mobile app. Harness runs on a random local loopback port; phone access uses a separate pairing Bridge. It does not automatically synchronize local Work and enterprise cloud tasks. See [mobile access boundaries](docs/architecture.md#mobile-access-boundary).

The Renderer has no Node.js privileges and uses Context Isolation and Sandbox. External pages open in the system browser. Profiles and sessions are stored in the user-level application data directory. See [window and IPC security](docs/architecture.md#window-and-ipc-security).

## Platform support

| Platform | Distribution | Status |
| --- | --- | --- |
| macOS Apple Silicon | Signed and notarized DMG/ZIP | Supported |
| macOS Intel | Signed and notarized DMG/ZIP | Supported |
| Windows x64 | Code-signed NSIS installer | Supported |
| Windows ARM64 | — | Not currently supported |
| Linux | — | Not currently supported |

Harness includes native dependencies for each target platform, so official installers are built on the corresponding operating system and architecture.

## Development and architecture

Contributions are welcome. Engineering documentation is organized into:

- [Development guide](docs/development.md) — local environment, validation, patch maintenance and native packaging
- [Runtime architecture](docs/architecture.md) — startup, persistence, security boundaries, recovery, phone connection and updates
- [Release runbook](docs/release-runbook.md) — signing and official release controls
- [Preset package format](docs/preset-packages.md) — portable Agent Preset contract

Before submitting changes, run `npm test`, `npm run typecheck` and `npm run build`, and exercise the affected application flows. Do not include real API keys in issues, logs, screenshots or test data.

## Community

For discussion of the shared desktop foundation, join the [DSH Desktop Discord community](https://discord.gg/7Xgf3qe3Qp), or scan the WeChat group QR code below.

<img src="docs/images/wechat-group-20260815.png" width="220" alt="DSH Desktop community WeChat group QR code" />

## License

DSH Desktop is open source under the [MIT License](LICENSE).

DeepSeek Harness and its dependencies remain subject to their respective upstream licenses and trademark rules. DSH Desktop is an independent community desktop application.

## Selected customers

BISHENG serves leading enterprises across industries. Here are some of our customers.

![China Meteorological Administration, HSBC, Bosch, Watsons, China Mobile and COFCO](docs/images/bisheng-customer-logos-row-1.png)

![Shougang Group, China Baowu, CICC, SINOSURE, PetroChina and ICBC](docs/images/bisheng-customer-logos-row-2.png)

![Bank of Chongqing, PowerChina, Huatai Securities, Huaxia Bank, Liaoning Financial Holdings and China Minsheng Bank](docs/images/bisheng-customer-logos-row-3.png)

![Longhua Capital, JSTI, China CITIC Bank, AVIVA-COFCO, BAIC Group and China Bond Rating](docs/images/bisheng-customer-logos-row-4.png)

## Enterprise inquiries

Contact us about BISHENG enterprise deployment, desktop client integration, product demonstrations or business partnerships.

[Contact the BISHENG team through the Feishu form](https://dataelem.feishu.cn/share/base/form/shrcnVow7GQwwKYEBCD41Bu5qoh)
