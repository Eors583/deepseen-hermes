# hermes-web-ui Adaptation Audit

Date: 2026-06-12

## Conclusion

`EKKOLearnAI/hermes-web-ui` has not replaced the existing Hermes `web/` frontend.
It has only been cloned into `.tmp-hermes-web-ui/` for inspection.

The low-risk path is to keep the current Hermes FastAPI dashboard backend and
`tui_gateway` runtime, then adapt the Vue client from `hermes-web-ui` to those
existing contracts. Do not copy its Koa server, Socket.IO runtime, auth system,
session database, or Node PTY backend into production without a separate
migration plan.

## Build Check

Local inspection used Node `v25.6.0`, which satisfies the target project's
`node >=23.0.0` engine requirement.

Commands run inside `.tmp-hermes-web-ui/`:

- `npm ci --ignore-scripts --no-audit --no-fund`: passed.
- `npm run build`: passed.

The build produces both `dist/client` and `dist/server`. Several chunks are
large, including Monaco, Mermaid, vendor, and TypeScript worker chunks. This is
acceptable for an adaptation proof, but production should keep only the static
client bundle in the Hermes FastAPI dashboard path unless there is an explicit
backend migration.

## Current Hermes Backend Surface

The existing dashboard is served by `hermes_cli/web_server.py` and already
provides:

- REST management APIs under `/api/*`.
- Chat runtime WebSocket at `/api/ws`, speaking JSON-RPC to `tui_gateway`.
- Embedded TUI terminal WebSocket at `/api/pty`.
- Event/pubsub WebSockets at `/api/events` and `/api/pub`.
- Sessions, profiles, skills, toolsets, model config, env config, cron, MCP,
  files, logs, gateway control, and dashboard plugin APIs.

The existing `web/` frontend is React + Vite and is built around those APIs.
The `/chat` page embeds the real `hermes --tui` through `/api/pty`.

## Target hermes-web-ui Surface

The target project is Vue 3 + Vite + Naive UI, but it is not a pure frontend.
It ships a Node/Koa BFF and runtime services:

- REST APIs mostly under `/api/hermes/*`.
- Chat Socket.IO namespace `/chat-run`.
- Run API compatibility around `/api/hermes/v1/runs` and `/v1/runs`.
- Its own session controllers and usage store.
- Its own file provider routes under `/api/hermes/files/*`.
- Its own auth routes under `/api/auth/*` using bearer tokens.
- Its own terminal WebSocket at `/api/hermes/terminal` using `node-pty`.

It also declares `license: BSL-1.1`. Production/commercial use must be cleared
before shipping it as part of a company product.

## Compatibility Matrix

| Area | Existing Hermes | hermes-web-ui expectation | Fit | Required adaptation |
| --- | --- | --- | --- | --- |
| Chat transport | `/api/ws` JSON-RPC and `/api/pty` raw PTY | Socket.IO `/chat-run`, run events | No direct fit | Replace `packages/client/src/api/hermes/chat.ts` with a `GatewayClient` adapter, or add a FastAPI Socket.IO compatibility bridge. Prefer client adapter. |
| Chat page model | Embedded real TUI in xterm | Native Vue chat transcript/composer | Partial | Decide whether to keep PTY-backed TUI for correctness or port desktop-style JSON-RPC chat into Vue. Do not run two independent chat systems. |
| Sessions | `/api/sessions`, `/api/sessions/{id}/messages` | `/api/hermes/sessions/*`, `/api/hermes/sessions/conversations/*` | Partial | Add a frontend API adapter mapping target session DTOs to existing endpoints. |
| Profiles | `/api/profiles`, `/api/profiles/active` | `/api/hermes/profiles*` plus `X-Hermes-Profile` | Partial | Repoint profile store to existing profile endpoints and reuse current profile scoping semantics. |
| Model config | `/api/model/info`, `/api/model/options`, `/api/model/set` | Similar data through `/api/hermes/*` and local BFF config | Partial | Map target UI model store to existing endpoints; keep project-local `.hermes/config.yaml` as source of truth. |
| Toolsets/skills | `/api/tools/toolsets`, `/api/skills` | Similar UI concepts but different paths | Partial | Reuse current endpoints so `crossborder_deepseen` remains the default toolset. |
| Files/upload | `/api/files`, `/api/files/upload`, `/api/fs/*` | `/api/hermes/files/*` | Partial | Add path/body adapter. For agent assets, prefer OSS URL handoff to SDK tools instead of relying on local file paths. |
| Auth | Injected dashboard session token / cookie gate | Bearer JWT in localStorage | No direct fit | Replace auth client with current `X-Hermes-Session-Token`/cookie flow. Do not introduce a second auth source. |
| Terminal | `/api/pty` to `hermes --tui` | `/api/hermes/terminal` with Node `node-pty` | No direct fit | Keep `/api/pty`. Remove or disable target terminal backend assumptions. |
| Build/runtime | React web build served by FastAPI | Vue build plus Node/Koa server | Partial | Build only Vue static assets for FastAPI serving; do not run Koa in production path. |

## Recommended Low-Risk Implementation

1. Keep the current Hermes FastAPI app, `tui_gateway`, project-local `.hermes`
   config, and `crossborder_deepseen` toolset as the production runtime.
2. Import only the Vue client source from `hermes-web-ui` into a separate
   frontend directory, for example `web-vue/`, during adaptation.
3. Create a frontend API compatibility layer:
   - `auth`: current dashboard token/cookie auth.
   - `sessions`: map target session calls to `/api/sessions`.
   - `profiles`: map to `/api/profiles`.
   - `models`: map to `/api/model/*`.
   - `skills/toolsets`: map to `/api/skills` and `/api/tools/toolsets`.
   - `files`: map to `/api/files` and `/api/fs/*`.
4. For chat, prefer a client-side adapter over a server-side Socket.IO bridge:
   - Use existing `/api/ws` JSON-RPC for structured chat events.
   - Use existing `/api/pty` only if the Vue chat surface intentionally embeds
     the same TUI behavior.
   - Map `message.delta`, `tool.start/tool.complete`, `clarify.request`, and
     `approval.request` into the event names expected by the Vue chat store.
5. Keep `hermes-web-ui` Koa server code out of the production process unless
   there is a later explicit decision to replace Hermes dashboard backend.
6. Add a feature flag/build switch before changing the default dashboard
   bundle. The old React `web/` should remain runnable until the Vue adapter
   passes all checks.

## OSS Asset Handoff For DeepSeen SDK

For user-uploaded local resources, production should use a server-side upload
pipeline:

1. Browser uploads to Hermes FastAPI or a dedicated upload service.
2. Server validates MIME, size, extension, and scans as needed.
3. Server stores the asset in OSS and returns a signed or public CDN URL plus
   normalized metadata.
4. The agent receives only the OSS/CDN URL in the tool arguments, such as
   `asset_urls`, `product_images`, `video_url`, or `uploaded_file_url`.
5. DeepSeen SDK tools call the SDK with those URLs. The model should not depend
   on local filesystem paths in production.

This matches the current DeepSeen plugin design and avoids exposing
server-local paths to model/tool execution.

## Production Acceptance Checks

- Static Vue build is produced without running the target Koa server.
- FastAPI serves the Vue bundle with the same dashboard auth protections.
- Login/auth/session refresh works in loopback and gated deployment modes.
- `/api/ws` chat can create, resume, stream, clarify, approve, and abort.
- DeepSeen SDK tools are visible in the `crossborder_deepseen` toolset and are
  preferred by the cross-border skill.
- Uploaded image/video assets are converted to OSS/CDN URLs before tool calls.
- Sessions list, session details, profiles, model selector, skills, and toolset
  management all load from existing FastAPI endpoints.
- No production code depends on `.tmp-hermes-web-ui/`.
- Commercial license review for BSL-1.1 is complete.
