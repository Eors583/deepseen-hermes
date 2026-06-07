# Debug Session: agent-bridge-refused

Status: OPEN

## Symptom

- Hermes Web UI can open, but actual chat/tool calls fail with `connect ECONNREFUSED 127.0.0.1:18765`.
- Expected behavior: the local Hermes agent bridge starts successfully, accepts loopback connections, and forwards chat/tool requests to the Hermes Python agent runtime.

## Scope

- Project: `d:/Users/Administrator/Desktop/deepseen/hermes-agent-main`
- Runtime: Hermes Web UI dev server on Windows
- Bridge endpoint: `tcp://127.0.0.1:18765`

## Initial Hypotheses

1. The Python agent bridge subprocess exits immediately due to a Python import/runtime error before binding `127.0.0.1:18765`.
2. The bridge starts with the wrong Python interpreter / environment, so required Hermes modules are unavailable at startup.
3. A recent Deepseen SDK integration changed runtime dependencies or startup import order and now crashes the bridge during tool discovery.
4. The Web UI bridge manager is resolving the wrong agent root / script path, so it launches a process that exits before readiness.
5. The bridge binds to a different endpoint/port than the Web UI expects, causing the Node client to hit an unopened `127.0.0.1:18765`.

## Evidence Log

- Pending runtime evidence collection.

## Next Step

- Capture bridge startup stderr / logs and confirm which hypothesis is supported.
