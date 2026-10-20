# Desktop employee settings

Presentation-only host plugin for Harness 0.2.0-rc.2. It uses the existing settings shell and feature-owned components; no account, model or preference data is copied into this package.

- Five common sections, with model and Agent pages available under Advanced.
- General rows and technical plugin inventory remain owned by their original features and render once.
- Enterprise account details, usage and messages occupy a bounded native document surface. The Chat/Work presenter remains its single geometry owner.
- The native enterprise service owns logout. Web settings receive only readiness, close and focus presentation channels.
- Styles and subscriptions follow the Cordis lifetime. Missing host layout contributions preserve Harness defaults; Safe Mode does not compose this plugin.

The canonical slot types live in the reproducible `dsh-client-ui-settings` patch. Runtime declarations live with the respective shell and Plugins section owners. Remove the compatibility patches when upstream ships equivalent layouts.

See `docs/settings-integration.zh.md` in the Desktop repository for contracts and validation boundaries.
