# UI-only hermes-web-ui Adapter

Date: 2026-06-12

## Status

`web-hermes-ui/` is the active Vue UI shell adapted from
`EKKOLearnAI/hermes-web-ui`. The original Hermes React frontend has been moved
to `web-original-abandoned/`.

The current adapter keeps Hermes native backend behavior:

- Chat WebSocket: `/api/ws`
- Runtime: `tui_gateway`
- Agent/profile/toolsets: project-local Hermes config, including the
  `crossborder_deepseen` toolset
- Auth: Hermes FastAPI dashboard injected token / gated cookie flow

The upstream Koa server, Socket.IO `/chat-run`, JWT auth, session DB, terminal
backend, group chat, devices, Kanban, and file manager are not used.

## What Is Implemented

- `web-hermes-ui/packages/client/src/api/native/hermesGateway.ts`
  - Native JSON-RPC WebSocket client for Hermes `/api/ws`
  - Supports loopback token and gated `ws-ticket` auth
- `web-hermes-ui/packages/client/src/views/hermes/ChatView.vue`
  - Creates a native Hermes session with `session.create`
  - Sends prompts with `prompt.submit`
  - Streams `message.delta`
  - Displays `tool.start` and `tool.complete`
- `web-hermes-ui/packages/client/src/router/index.ts`
  - Routes are narrowed to the chat surface only
- `web-hermes-ui/packages/client/src/components/layout/AppSidebar.vue`
  - Sidebar is cross-border specific
  - Unsupported upstream features are hidden from navigation
- `web-hermes-ui/package.json`
  - Builds only the Vue client
  - Does not build or run the upstream Koa server

## Build

```bash
cd web-hermes-ui
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

The build currently passes and produces static assets under
`hermes_cli/web_dist`, which is the directory served by Hermes FastAPI.

The UI-only dependency tree has been trimmed to the client runtime:

- Runtime: `vue`, `vue-router`, `naive-ui`, `katex`
- Build: `vite`, `vue-tsc`, `typescript`, `sass`, `esbuild`

Final bundle checks:

- No bundled `/chat-run`, Socket.IO, `/api/hermes/v1`, or
  `/api/hermes/terminal` references.
- Bundled native runtime references are `/api/ws`, `session.create`,
  `prompt.submit`, `message.delta`, and `tool.complete`.

## Current Switch

Hermes dashboard build calls now target `PROJECT_ROOT / "web-hermes-ui"`.
The static dashboard directory remains `hermes_cli/web_dist`, so FastAPI keeps
serving the same path while the UI implementation changes.
