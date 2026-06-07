# Debug Session: webui-ebadf

Status: OPEN

## Symptom

- Hermes Web UI startup is unstable on Windows.
- Expected behavior: Hermes backend stays up, can connect to the local agent bridge, and the user can chat and invoke Deepseen tools normally.
- Actual behavior:
  - earlier requests hit `connect ECONNREFUSED 127.0.0.1:18765`
  - latest startup now crashes with `EBADF: bad file descriptor, write`

## Scope

- Project: `d:\Users\Administrator\Desktop\deepseen\hermes-agent-main`
- Runtime: Hermes Web UI dev server on Windows
- Backend port: `8647`
- Bridge endpoint: `tcp://127.0.0.1:18765`

## Falsifiable Hypotheses

1. The bridge is now healthy, but a later startup stage crashes and masks the original bridge symptom.
2. A logger destination or stream becomes invalid during bootstrap, causing `EBADF` and hiding the real failure source.
3. Hermes CLI / Python resolution still falls back to the wrong environment for one of the startup tasks.
4. An old process or occupied port causes bootstrap to partially succeed and then fail.

## Evidence Log

- `web/nodemon.json` still pointed `HERMES_AGENT_ROOT` at an old path:
  - `D:\Users\Administrator\Desktop\hermes-agent-main`
- Fresh startup instrumentation in `hermes-process.ts` showed the broken resolution path:
  - `[hermes-process] invoking Hermes bin directly`
  - subsequent CLI calls failed through `C:\Users\Administrator\AppData\Roaming\Python\Python312\Scripts\hermes.exe`
  - repeated `ModuleNotFoundError: No module named 'hermes_cli'`
- After fixing local Hermes launcher discovery and removing the stale `HERMES_AGENT_ROOT` from `web/nodemon.json`, logs changed to:
  - `[hermes-process] using bundled Hermes launcher`
  - `[hermes-process] using script-based Hermes launcher with selected Python`
- Post-fix runtime verification:
  - backend health OK on `http://127.0.0.1:8647/health`
  - frontend reachable on `http://127.0.0.1:8649`
  - `netstat` shows `8647` listening by `node.exe`
  - `netstat` shows `18765` listening by `D:\anaconda3\python.exe`

## Next Step

- User verifies an actual chat + tool invocation in Hermes UI.
