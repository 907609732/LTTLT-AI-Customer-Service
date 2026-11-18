<div align="center">

<img src="src/assets/lingtu-ai-icon.png" width="88" alt="Lingtu AI E-commerce Customer Service" />

# Lingtu AI E-commerce Customer Service

**The customer-service and after-sales workspace of the Lingtu AI E-commerce Traceability Suite.**

Manage stores, product knowledge, AI reply drafts and conversation records. Help staff answer product questions, logistics enquiries and after-sales requests. Use it alongside [purchase-order organization](https://github.com/907609732/lingtu-order-export/blob/master/docs/README.en.md) and [parcel video evidence](https://github.com/907609732/lingtu-recorder/blob/main/README.en.md) to review purchases, parcel handling and customer issues.

[简体中文](README.md) · **English**

**[Windows installer v1.0.48](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-Setup-1.0.48-win-x64.exe)** · [Portable ZIP](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-1.0.48-win-x64.zip) · [Release notes](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.48)

</div>

> **Mixed licensing:** Apache-2.0 applies only to the owner-controlled original code and documents listed in the [license scope matrix](docs/legal/LICENSE_SCOPE.md). The New API-derived server uses AGPL-3.0-or-later; the vendored runtime uses AGPL-3.0-only. Third-party assets retain their own rights. See [licensing details](docs/legal/LICENSING.md) before redistribution.

## Lingtu AI E-commerce Traceability Suite

Three complementary apps cover purchase records, parcel evidence and AI-assisted customer service.

| Logo | Project and purpose |
| :---: | :--- |
| <a href="https://github.com/907609732/lingtu-recorder/blob/main/README.en.md"><img src="https://raw.githubusercontent.com/907609732/lingtu-recorder/main/docs/assets/logo.png" width="96" height="96" alt="Lingtu Unpack Recorder logo"></a> | **[Lingtu Unpack Recorder](https://github.com/907609732/lingtu-recorder/blob/main/README.en.md)**<br>Parcel evidence: find unpacking/packing videos, photos and exception notes by tracking number. |
| <a href="https://github.com/907609732/lingtu-order-export/blob/master/docs/README.en.md"><img src="https://raw.githubusercontent.com/907609732/lingtu-order-export/master/build/icon.png" width="96" height="96" alt="Purchase Order Export logo"></a> | **[E-commerce Purchase Order Export](https://github.com/907609732/lingtu-order-export/blob/master/docs/README.en.md)**<br>Purchase traceability: organize buyer orders, product details and logistics; export Excel/CSV. |
| <a href="https://github.com/907609732/LTTLT-AI-Customer-Service/blob/main/README.en.md"><img src="https://raw.githubusercontent.com/907609732/LTTLT-AI-Customer-Service/main/src/assets/lingtu-ai-icon.png" width="96" height="96" alt="Lingtu AI Customer Service logo"></a> | **[This project: Lingtu AI E-commerce Customer Service](https://github.com/907609732/LTTLT-AI-Customer-Service/blob/main/README.en.md)**<br>After-sales support: store/product knowledge and AI-assisted customer replies. |

The apps are installed separately and keep their own data; orders, recordings and customer-service data are not automatically shared.

## Core features

| Feature | What it does |
| --- | --- |
| Store management | Add and group stores; configure platform login, models and reply rules. |
| Product knowledge | Collect Pinduoduo product/SKU details and maintain product questions and answers. |
| Learning and review | Track learning, review knowledge and enable it explicitly; these are separate steps. |
| AI-assisted replies | Generate candidates from store knowledge. Review before sending by default; automatic sending requires an explicit per-store choice. |
| Reply monitoring | Review pending approvals and send status, and inspect runtime logs. |
| Practice and operations | Use local simulated stores/customers, templates, dashboards, tickets and quality checks. |
| MCP and CLI | Let external AI query stores, knowledge and tasks. Current source also supports CLI and selected configuration changes. |

## AI integration and versions

The public **v1.0.48** Windows release includes the basic MCP connector. Current source additionally provides CLI and tools to read, preview and change reply intervals, welcome messages/delays and image-recognition settings. These configuration tools neither return model secrets nor enable AI or send messages to buyers.

Start the app and use the configuration in `%APPDATA%/yunduo-ui-restored/ai-interface/mcp-config.json` with your AI client. See the [AI interface guide](docs/AI_INTERFACE.md) for supported tools and setup. New source capabilities are not automatically present in the older installer.

## Platforms and getting started

- **Pinduoduo:** product, conversation and order workflows are wired; only selected live-store read-only cases have been checked. Live sending, transfers and payment-related actions still need business acceptance.
- **Xianyu web:** included in v1.0.48. It samples opened/pending conversations, does not collect products or send videos, and text/image sending still needs live-buyer acceptance.
- **Local simulations:** exercise model requests and approval flows without sending to real buyers.

1. Install v1.0.48 or follow the [Chinese source-running instructions](README.md#从源码运行) for current source.
2. Configure a model/provider or managed account and test the connection.
3. Add a store and complete the login and setup guide.
4. Import or collect product knowledge, then review and enable it explicitly.
5. Verify the platform identity before enabling store AI; review replies according to the selected store mode.

The desktop interface is currently Chinese. The installer is not code-signed; verify its [SHA256 checksums](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/SHA256SUMS.txt). Store AI choices can be restored only after platform identity is reverified; old approvals and pending replies are not restored.

## Data and privacy

Local mode and managed accounts on the same computer share one local business workspace. Switching managed accounts does not isolate stores, conversations or platform sessions. Older workspace folders are retained without automatic merging.

Model keys are encrypted by the Electron main process. Relevant conversation/image context is sent to the selected model provider; platform and managed modes connect to their respective services. Do not publish keys, tokens, cookies, buyer data or local business folders in bug reports.

## Documentation and licensing

- [Full Chinese guide](README.md) · [Current status](docs/HANDOFF.md) · [AI integration](docs/AI_INTERFACE.md)
- [Runtime logs](docs/RUNTIME_LOGS.md) · [Architecture](docs/ARCHITECTURE.md) · [Versioning](docs/VERSIONING.md)
- [License](LICENSE) · [Scope matrix](docs/legal/LICENSE_SCOPE.md) · [Third-party notices](docs/legal/THIRD_PARTY_NOTICES.md)

Owner-controlled original code retains the commercial-use, modification and distribution rights granted by Apache-2.0. Bundled AGPL components retain their own source-disclosure and other obligations. This repository does not claim that the entire combined application can be distributed as closed source or that platform endorsement has been obtained.
