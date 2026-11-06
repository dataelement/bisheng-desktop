<h1 align="center">
  <img src="docs/images/readme-logo-black-v020.png" width="274" alt="BISHENG" valign="middle" />
</h1>

<p align="center">
  <strong>BISHENG クライアントは、ローカル業務と企業 AI をつなぐデスクトップ Agent です。</strong><br />
  従業員は企業アカウントで許可されたモデル、ナレッジベース、ツール、スキルを利用し、Chat でクラウド上の Q&A や複数ステップのタスクを実行し、Work で許可されたディレクトリ内の資料を処理できます。企業はリソース、権限、クレジット、利用量を一元管理します。<br />
  <a href="https://dshdesktop.com/zh/enterprise/">BISHENG クライアントをダウンロード</a> · <a href="https://github.com/dataelement/bisheng">BISHENG サーバーのリポジトリ</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.es.md">Español</a> · <a href="README.pt.md">Português</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

## BISHENG クライアントでできること

- **Chat：企業のクラウドにタスクを任せる。** 資料について質問したり、タスクモードで複数ステップの処理、スキルの呼び出し、ファイルの作成を行い、進捗と結果を確認できます。
- **Work：ローカル資料を使って作業を続ける。** 許可したディレクトリを選び、資料整理、データ分析、編集可能な Word・Excel・PPT の作成を行い、フィードバックに応じて修正し、許可された場所に保存できます。
- **権限に従って企業リソースを利用。** 企業アカウントで許可されたモデル、ナレッジスペース、API/MCP ツール、スキルを使い、アプリセンターから公開済みのアプリ、アシスタント、ワークフローを開けます。
- **企業による一元管理。** 管理者がリソースと権限を設定し、プラグインとワークベンチを配布して、月間クレジットと呼び出し利用量を管理します。Chat と Work の企業モデル呼び出しは、現在のユーザーの同じクレジット台帳を使用します。
- **Web とデスクトップの連携。** 同じ企業アカウントで Web とデスクトップの Chat から同じサーバー側タスクを開くと、タスクイベントと完了状態を同期して確認できます。ローカル Work のタスクと成果物は独立した記録として管理します。

![BISHENG の Web・デスクトップ・モバイル画面](docs/images/bisheng-platform-overview.png)

> モバイルアプリは近日公開予定です。機能と公開予定、企業連携機能、デプロイ要件、オープンソース版・企業版の提供範囲は、各バージョンの説明をご確認ください。

## BISHENG プラットフォームと関連プロジェクト

**BISHENG はオープンソースの企業向けオールインワン Agent プラットフォーム**です。オフィス業務の効率化と企業での AI 活用に注力し、モデル、ナレッジ、ツール、スキル、アプリ、一元管理機能をクライアントに提供します。

- [BISHENG 企業プラットフォーム](https://github.com/dataelement/bisheng)：企業 AI サービスをデプロイし、組織のリソース、権限、利用量を一元管理します。
- [DSH Desktop](https://github.com/dataelement/dsh-desktop)：DeepSeek Harness を基盤とするオープンソースのデスクトップ Agent 基盤です。BISHENG クライアントはこの基盤に企業 AI サービスを接続します。

## ダウンロードとインストール

[BISHENG クライアント公式サイト](https://dshdesktop.com/zh/enterprise/)からインストーラーを取得し、企業でデプロイした BISHENG プラットフォームと組み合わせて利用します。企業アカウントでログインし、管理者が設定・許可したリソースを使用してください。

個人版を単独で利用する場合は、[DSH Desktop 公式サイト](https://dshdesktop.com/zh/)をご覧ください。

## オフィス文書とデスクトップ機能

- **オフィス文書の作成**：内蔵の PPT モードでテンプレートを選び、内容を説明して、編集可能な PPTX を作成します。デスクトップ実行環境には Python と Office ライブラリが含まれ、DOCX・PPTX・XLSX の作成と検査に対応します。テンプレートと検査方法は [PPT ガイド](packages/ppt-runtime/README.md)をご覧ください。
- **ローカルワークスペースと設定**：OS 標準のディレクトリ選択画面からワークスペースを管理します。Profile、プラグイン、セッション、モデル設定はインストール先とは別に保存され、更新時も保持されます。カスタム設定の入出力は [Preset パッケージ形式](docs/preset-packages.md)をご覧ください。
- **更新と復旧**：現在のインストール版ではオンライン更新はまだ有効になっていません。[公式サイト](https://dshdesktop.com/zh/enterprise/)から新しいインストーラーを取得できます。オンライン更新の提供開始は各バージョンの説明に従います。プラグインに問題がある場合、`Harness` メニューの「セーフモードで再起動…」からサードパーティ製プラグインを一時的に無効化し、通常の Profile のデータを保持できます。診断は `harness.log` に記録されます。[プラグインの復旧](docs/architecture.md#profiles-and-plugin-recovery)と[更新の仕組み](docs/architecture.md#updates)をご覧ください。

## スマートフォン接続とデータの境界

デスクトップ実行環境では QR コードによるスマートフォン接続を利用できます。`Harness` メニューの「スマートフォンを接続…」を選び、WiFi でスキャンしてペアリングします。インターネットトンネルでは、パソコンに表示される接続パスワードも必要です。既定の有効期限は 5 分間で、明示的に同意した場合のみ長期パスワードを作成します。デスクトップ側で切断すると、スマートフォンのセッションも無効になります。接続できない場合は「QR リンクを開けませんか？ 別の経路を試す」から切り替えられます。

このブラウザでのペアリング機能は、近日公開予定のモバイルアプリとは別です。Harness はローカルのランダムなループバックポートで動作し、スマートフォンからは独立したペアリング Bridge を経由してアクセスします。ローカル Work と企業クラウドのタスクが自動同期されるわけではありません。[モバイルアクセスの境界](docs/architecture.md#mobile-access-boundary)をご覧ください。

Renderer に Node.js の権限はなく、Context Isolation と Sandbox が有効です。外部ページはシステムブラウザで開きます。Profile とセッションはユーザー単位のアプリデータディレクトリに保存されます。[ウィンドウと IPC のセキュリティ](docs/architecture.md#window-and-ipc-security)をご覧ください。

## 対応プラットフォーム

| プラットフォーム | 配布形式 | 状態 |
| --- | --- | --- |
| macOS Apple Silicon | 署名・公証済み DMG/ZIP | 対応 |
| macOS Intel | 署名・公証済み DMG/ZIP | 対応 |
| Windows x64 | コード署名済み NSIS インストーラー | 対応 |
| Windows ARM64 | — | 現在未対応 |
| Linux | — | 現在未対応 |

Harness は各プラットフォームのネイティブ依存を含むため、正式インストーラーは対応する OS とアーキテクチャ上でビルドします。

## 開発とアーキテクチャ

貢献を歓迎します。技術文書は次のように分かれています。

- [開発ガイド](docs/development.md) — ローカル環境、検証、パッチ保守、ネイティブビルド
- [実行アーキテクチャ](docs/architecture.md) — 起動、永続化、セキュリティ、復旧、スマートフォン接続、更新
- [リリース手順](docs/release-runbook.md) — 署名と正式リリースの管理
- [Preset パッケージ形式](docs/preset-packages.md) — 移植可能な Agent Preset の契約

変更提出前に `npm test`、`npm run typecheck`、`npm run build` を実行し、影響する操作を実際に確認してください。Issue、ログ、スクリーンショット、テストデータに本物の API キーを含めないでください。

## コミュニティ

共通のデスクトップ基盤については [DSH Desktop Discord コミュニティ](https://discord.gg/7Xgf3qe3Qp)に参加するか、以下の WeChat グループの QR コードをスキャンしてください。

<img src="docs/images/wechat-group-20260815.png" width="220" alt="DSH Desktop コミュニティの WeChat グループ QR コード" />

## ライセンス

DSH Desktop は [MIT License](LICENSE) で公開されています。

DeepSeek Harness とその依存には、それぞれの上流ライセンスと商標規則が適用されます。DSH Desktop は独立したコミュニティ製デスクトップアプリです。

## 導入実績

BISHENG はさまざまな業界の大手企業に導入されています。以下は導入先の一部です。

![HSBC、ボッシュ、ワトソンズ、中国移動、中糧集団、首鋼集団](docs/images/bisheng-customer-logos-row-1.png)

![中国宝武、中金公司、中国輸出信用保険公司、中国石油、中国工商銀行、重慶銀行](docs/images/bisheng-customer-logos-row-2.png)

![中国電建、華泰証券、華夏銀行、遼寧金控、中国民生銀行、龍華資本](docs/images/bisheng-customer-logos-row-3.png)

![蘇交科、中信銀行、中英人寿、北汽集団、中債資信、中国気象局](docs/images/bisheng-customer-logos-row-4.png)

## 企業向けお問い合わせ

BISHENG の企業向けデプロイ、クライアント連携、製品デモ、ビジネス連携について、お気軽にお問い合わせください。

[飛書（Feishu）フォームから BISHENG チームに問い合わせる](https://dataelem.feishu.cn/share/base/form/shrcnVow7GQwwKYEBCD41Bu5qoh)
