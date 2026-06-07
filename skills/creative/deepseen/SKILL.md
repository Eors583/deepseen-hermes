---
name: "deepseen"
description: "Handles video and image generation using Deepseen tools."
version: "1.0.0"
author: "User"
license: "MIT"
platforms: ["macos", "linux", "windows"]
metadata.hermes.category: "creative"
metadata.hermes.tags: ["video", "image", "generation", "recreation"]
---

# Deepseen Content Creation Skill

This skill utilizes the Deepseen toolset to perform smart creation and recreation of marketing videos and images.

## When to Use

Invoke this skill whenever the user asks to:

- Generate a marketing short video from a product title or image.
- Generate product images/listing images from keywords.
- Recreate or clone an image based on a competitor's product URL and a local product image.
- Recreate or clone a video based on a competitor's video (URL or local file) and local product images.
- Perform "video recreation" (视频二创), "image recreation" (图片二创), "smart video creation" (视频智创), or "smart image creation" (图片智创).

## Available Tools

The following tools are available under the `deepseen` toolset:

1. **`deepseen_smart_video_recreations_create_and_wait`** (视频智创)
   - **Purpose**: Generates marketing short videos (for TikTok, e-commerce) from a product title and optional product images.
   - **Required Inputs**: `product_title`
   - **Optional Inputs**: `local_paths` (array of local image paths)
   - **Important**: Pass the local paths directly. Do NOT pre-analyze the images with `vision_analyze`.

2. **`deepseen_smart_image_recreations_create_and_wait`** (图片智创)
   - **Purpose**: Generates Listing main images or product images from English keywords.
   - **Required Inputs**: `keywords`
   - **Optional Inputs**: `local_paths` (array of local image paths)
   - **Important**: Pass the local paths directly. Do NOT pre-analyze the images with `vision_analyze`.

3. **`deepseen_image_recreations_create_and_wait`** (图片二创)
   - **Purpose**: Recreates an image by benchmarking against a competitor's product URL using your own product images.
   - **Required Inputs**: `competitor_product_url`
   - **Optional Inputs**: `local_paths` (array of local image paths)
   - **Important**: Pass the local paths directly. Do NOT pre-analyze the images with `vision_analyze`.

4. **`deepseen_video_recreations_create_and_wait`** (视频二创)
   - **Purpose**: Recreates a marketing short video by referencing a viral video and using product base images.
   - **Required Inputs**: Either `competitor_video_url` OR `reference_video_local_path`, AND `product_local_paths` (at least 1 image).
   - **Important**: Pass the local paths directly. Do NOT pre-analyze the images or videos with `vision_analyze` or `video_analyze`.

## Hard Naming Rules

- You MUST ONLY call these exact four Deepseen tool names:
  - `deepseen_smart_video_recreations_create_and_wait`
  - `deepseen_smart_image_recreations_create_and_wait`
  - `deepseen_image_recreations_create_and_wait`
  - `deepseen_video_recreations_create_and_wait`
- You MUST NOT invent, shorten, translate, paraphrase, or "clean up" any Deepseen tool name.
- You MUST NOT output text such as `正在执行调用 (deepseen_xxx)` unless the exact same registered tool is actually being called.
- If you are unsure which Deepseen tool fits, ask a short clarification question instead of inventing a fifth tool name.

## Internal Runner Script

- Canonical script path: `scripts/deepseen_tool_runner.py`
- Canonical launch format:
  - `python scripts/deepseen_tool_runner.py deepseen_smart_video_recreations_create_and_wait`
  - `python scripts/deepseen_tool_runner.py deepseen_smart_image_recreations_create_and_wait`
  - `python scripts/deepseen_tool_runner.py deepseen_image_recreations_create_and_wait`
  - `python scripts/deepseen_tool_runner.py deepseen_video_recreations_create_and_wait`
- The script reads exactly one JSON object from stdin.
- In normal Hermes chat, do NOT use the terminal tool to start this script manually. Call the registered Deepseen tool directly. Hermes uses the same parameter contract internally.

## Conversation To Params

- 视频智创 `deepseen_smart_video_recreations_create_and_wait`
  - Pass `product_title`
  - Optional: `local_paths`, `product_images`, `product_file_ids`, `region`, `count`, `model`
- 图片智创 `deepseen_smart_image_recreations_create_and_wait`
  - Pass `keywords`
  - Optional: `local_paths`, `product_images`, `product_file_ids`, `product_details`, `region`
- 图片二创 `deepseen_image_recreations_create_and_wait`
  - Pass `competitor_product_url`
  - Optional: `local_paths`, `product_images`, `product_file_ids`, `model`, `aspect_ratio`, `auto_generate`, `auto_confirm`
- 视频二创 `deepseen_video_recreations_create_and_wait`
  - Pass either `competitor_video_url` or `reference_video_local_path`
  - Also pass at least one product image in `product_local_paths` or compatible `local_paths`
  - Optional: `product_images`, `product_file_ids`, `group_count`, `model`, `auto_confirm`

## Procedure

1. Identify the user's intent (video vs. image, smart creation vs. recreation).
2. Gather the necessary inputs (titles, keywords, URLs, local file paths).
   - If the user is interacting with Hermes via Web UI (remote/server), they must attach/upload the media file in chat. The server will store it and provide a server-side `path` that the tools can read.
3. Call the appropriate Deepseen tool with the gathered inputs.
4. The tool will automatically handle the uploading of local files, job creation, polling, and downloading the result to a local cache.
5. Once the tool returns the result, extract the `local_paths` from the `agent_summary`.
   - If you need the online-accessible resource links (for passing into other tools), use `agent_summary.input_files[*].url` / `agent_summary.input_files[*].file_id`.
6. Display the generated media to the user using the correct syntax:
   - For images: `![image](local_path)`
   - For videos: `[Generated Video](local_path)` (Standard markdown link syntax) OR `MEDIA: local_path` (Hermes specific syntax)

## Pitfalls

- **Do NOT pre-analyze media**: Never use `vision_analyze` or `video_analyze` on the user's input images or videos before calling the Deepseen tools. This will cause unnecessary API calls and potential 404 errors. Pass the raw local paths directly to the Deepseen tools.
- **Don't paste your local disk path**: When Hermes runs on a remote machine, paths like `C:\...` from your own computer do not exist on the server. Always upload as an attachment first, then use the returned server-side `path`.
- **Markdown Display**: Always use the correct Markdown syntax to display the final output so the UI can render it properly. Do NOT use `![video](local_path)` for videos as the frontend Markdown parser will treat it as an image and it will fail to load. Use `[text](local_path)` instead.
- **No fake execution narration**: Do NOT say "已触发工具调用", "正在调用", "正在轮询", "正在通过 terminal 排查", or similar unless you are emitting a real valid tool call in the same response.
- **No terminal fallback**: Do NOT call `terminal`, `process`, `execute_code`, bash, PowerShell, Python, OpenCV, or PIL as a fallback for any Deepseen generation request. Deepseen generation must stay on the online SDK/OpenAPI path.
- **No fake skill-directory diagnosis**: Do NOT inspect or mention `~/.hermes/profiles/default/skills`, `skill.json`, or `config.json` as a Deepseen fallback diagnosis path unless the user explicitly asks to debug the local Hermes skill filesystem itself.
- **Failure policy**: If a Deepseen tool is unavailable or fails, report the limitation plainly and briefly. Do NOT invent a diagnosis, do NOT claim the tool is mounted/unmounted without evidence, and do NOT pretend that a terminal check has already started.
