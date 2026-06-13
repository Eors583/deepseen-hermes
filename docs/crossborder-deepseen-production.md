# Cross-Border DeepSeen Production Setup

This repository is configured as a company-specific cross-border ecommerce
agent. It should run with the project-local Hermes home:

```bash
export HERMES_HOME=/path/to/hermes-agent-main/.hermes
export PYTHONPATH=/path/to/hermes-agent-main
npm install --workspaces=false
cp .hermes/.env.example .hermes/.env
```

Set `.hermes/.env`:

```bash
DEEPSEEN_API_KEY=your_key
DEEPSEEN_BASE_URL=https://deepseen.ai/v1
```

Start CLI/TUI:

```bash
./scripts/run-crossborder.sh
```

Start dashboard:

```bash
./scripts/run-crossborder.sh web --no-open --host 127.0.0.1 --port 9119
```

On Windows PowerShell:

```powershell
.\scripts\run-crossborder.ps1
.\scripts\run-crossborder.ps1 web --no-open --host 127.0.0.1 --port 9119
```

## Tool Policy

The default project config exposes only:

- `crossborder_deepseen`
- `skills`
- `clarify`

The agent should use DeepSeen SDK tools first for ecommerce creative generation,
product reports, competitor research, creator analysis/scoring, and video
analysis.

## OSS Asset Flow

Production web uploads should not pass browser-local file paths to the agent.
Use this flow:

1. Web client uploads the file to your server/OSS.
2. Backend stores metadata and returns a short-lived URL or stable `asset_id`.
3. The agent tool call receives one of:
   - `asset_urls` for product images
   - `product_images` for product image URLs
   - `video_url` for uploaded video analysis
   - `uploaded_file_url` for creator spreadsheet scoring
   - `competitor_video_url` for a reference video URL
4. The DeepSeen tool forwards those URLs to the SDK.

If you use stable `asset_id` values instead of URLs, add a small BFF endpoint
that exchanges `asset_id` for a short-lived signed URL before invoking the
Hermes tool.

## Result Policy

Tool handlers return JSON:

```json
{
  "ok": true,
  "job_id": "...",
  "status": "completed",
  "output_urls": ["..."],
  "result_id": "...",
  "result": {},
  "raw": {}
}
```

The final assistant response should faithfully translate/format this JSON only.
It must not add second-layer business interpretation unless the user explicitly
asks for interpretation after the SDK result.
