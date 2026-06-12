import { DeepseenClient } from "deepseen-sdk";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function pushTrace(trace, stage, detail = {}) {
  trace.push({
    stage,
    timestamp: nowIso(),
    ...detail,
  });
}

const PROGRESS_PREFIX = "__DEEPSEEN_PROGRESS__";

function estimateProgress(stage, detail = {}) {
  const status = String(detail?.status || "").toLowerCase();
  if (stage === "sdk.file.upload.started") return 8;
  if (stage === "sdk.file.upload.completed") return 18;
  if (stage === "sdk.job.create.started") return 22;
  if (stage === "sdk.job.create.completed") return 32;
  if (stage === "sdk.job.confirming") return 72;
  if (stage === "sdk.job.confirmed") return 76;
  if (stage === "sdk.job.terminal") return 100;
  if (stage === "sdk.job.failed" || stage === "sdk.job.timeout") return 100;
  if (stage === "sdk.job.refresh.wait") {
    if (status === "queued" || status === "pending") return 42;
    if (status === "processing" || status === "running") return 68;
    if (status === "awaiting_confirmation") return 70;
    return 50;
  }
  if (stage === "sdk.job.status") {
    if (status === "queued" || status === "pending") return 40;
    if (status === "processing" || status === "running") return 66;
    if (status === "awaiting_confirmation") return 70;
    if (status === "completed" || status === "cancelled") return 100;
    if (status === "failed") return 100;
    return 36;
  }
  return 0;
}

function stageText(stage, detail = {}) {
  const status = detail?.status ? ` (${detail.status})` : "";
  switch (stage) {
    case "sdk.file.upload.started":
      return "正在上传附件到 Deepseen";
    case "sdk.file.upload.completed":
      return "附件已上传到 Deepseen";
    case "sdk.job.create.started":
      return "正在创建 Deepseen 任务";
    case "sdk.job.create.completed":
      return "Deepseen 任务已创建";
    case "sdk.job.status":
      return `Deepseen 任务状态更新${status}`;
    case "sdk.job.refresh.wait":
      return `正在轮询 Deepseen 任务${status}`;
    case "sdk.job.confirming":
      return "正在确认 Deepseen 任务";
    case "sdk.job.confirmed":
      return "Deepseen 任务已确认";
    case "sdk.job.terminal":
      return `Deepseen 任务已结束${status}`;
    case "sdk.job.failed":
      return "Deepseen 任务失败";
    case "sdk.job.timeout":
      return "Deepseen 任务等待超时";
    default:
      return stage;
  }
}

function emitProgress(stage, detail = {}) {
  const payload = {
    stage,
    progress: estimateProgress(stage, detail),
    text: stageText(stage, detail),
    timestamp: nowIso(),
    ...detail,
  };
  process.stderr.write(`${PROGRESS_PREFIX}${JSON.stringify(payload)}\n`);
}

async function readJsonStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createClient(payload) {
  return new DeepseenClient({
    apiKey: payload.apiKey?.trim() || requireEnv("DEEPSEEN_API_KEY"),
    baseURL: payload.baseURL?.trim() || process.env.DEEPSEEN_BASE_URL?.trim() || undefined,
  });
}

async function waitForTerminalJob(handle, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 8000;
  const timeoutMs = options.timeoutMs ?? 3600000;
  const autoConfirm = options.autoConfirm ?? false;
  const trace = Array.isArray(options.trace) ? options.trace : [];
  const start = Date.now();
  let lastStatus = null;

  while (true) {
    const job = handle.data;
    const status = job?.status;

    if (status && status !== lastStatus) {
      pushTrace(trace, "sdk.job.status", {
        jobId: handle.id,
        status,
      });
      emitProgress("sdk.job.status", {
        jobId: handle.id,
        status,
      });
      lastStatus = status;
    }

    if (status === "awaiting_confirmation") {
      if (!autoConfirm || typeof handle.confirm !== "function") {
        throw new Error(`Job ${handle.id} is awaiting confirmation`);
      }
      pushTrace(trace, "sdk.job.confirming", { jobId: handle.id });
      emitProgress("sdk.job.confirming", { jobId: handle.id, status });
      await handle.confirm();
      pushTrace(trace, "sdk.job.confirmed", { jobId: handle.id });
      emitProgress("sdk.job.confirmed", { jobId: handle.id, status: "confirmed" });
      continue;
    }

    if (status === "completed" || status === "cancelled") {
      pushTrace(trace, "sdk.job.terminal", {
        jobId: handle.id,
        status,
        elapsedMs: Date.now() - start,
      });
      emitProgress("sdk.job.terminal", {
        jobId: handle.id,
        status,
        elapsedMs: Date.now() - start,
      });
      if (job && typeof job === "object") {
        return {
          ...job,
          _trace: trace,
        };
      }
      return job;
    }

    if (status === "failed") {
      pushTrace(trace, "sdk.job.failed", {
        jobId: handle.id,
        elapsedMs: Date.now() - start,
        error: job?.error?.message ?? "Unknown error",
      });
      emitProgress("sdk.job.failed", {
        jobId: handle.id,
        status,
        elapsedMs: Date.now() - start,
        error: job?.error?.message ?? "Unknown error",
      });
      throw new Error(
        `Job ${handle.id} failed: ${job?.error?.message ?? "Unknown error"}`
      );
    }

    if (Date.now() - start > timeoutMs) {
      pushTrace(trace, "sdk.job.timeout", {
        jobId: handle.id,
        elapsedMs: Date.now() - start,
      });
      emitProgress("sdk.job.timeout", {
        jobId: handle.id,
        status: status ?? "unknown",
        elapsedMs: Date.now() - start,
      });
      throw new Error(`Job ${handle.id} timed out after ${timeoutMs}ms`);
    }

    pushTrace(trace, "sdk.job.refresh.wait", {
      jobId: handle.id,
      status: status ?? "unknown",
      nextPollInMs: pollIntervalMs,
    });
    emitProgress("sdk.job.refresh.wait", {
      jobId: handle.id,
      status: status ?? "unknown",
      nextPollInMs: pollIntervalMs,
    });
    await sleep(pollIntervalMs);
    await handle.refresh();
  }
}

async function createAnalysisJob(client, action, createParams) {
  switch (action) {
    case "product-report-create-and-wait":
      return client.productReports.create(createParams);
    case "competitor-analyze-and-wait":
      return client.competitors.analyze(createParams);
    case "competitor-analyze-multi-and-wait":
      return client.competitors.analyzeMulti(createParams);
    case "creator-analyze-and-wait":
      return client.creators.analyze(createParams);
    case "creator-score-create-and-wait":
      return client.creatorScores.create(createParams);
    case "video-analysis-create-and-wait":
      return client.videos.analyses.create(createParams);
    default:
      throw new Error(`Unsupported analysis action: ${action}`);
  }
}

async function main() {
  const action = process.argv[2];
  if (!action) {
    throw new Error("Missing action");
  }

  const payload = await readJsonStdin();
  const client = createClient(payload);
  const trace = [];

  let result;
  if (action === "upload") {
    pushTrace(trace, "sdk.file.upload.started", {
      filePath: payload.filePath,
      purpose: payload.purpose,
    });
    emitProgress("sdk.file.upload.started", {
      filePath: payload.filePath,
      purpose: payload.purpose,
      status: "uploading",
    });
    result = await client.files.upload(payload.filePath, payload.purpose);
    pushTrace(trace, "sdk.file.upload.completed", {
      fileId: result?.id,
      url: result?.url,
    });
    emitProgress("sdk.file.upload.completed", {
      fileId: result?.id,
      url: result?.url,
      status: "uploaded",
    });
    result = {
      ...result,
      _trace: trace,
    };
  } else if (action === "smart-video-create-and-wait") {
    pushTrace(trace, "sdk.job.create.started", {
      action,
      createParams: payload.createParams ?? {},
    });
    emitProgress("sdk.job.create.started", {
      action,
      status: "creating",
    });
    const handle = await client.smartVideo.recreations.create(payload.createParams ?? {});
    pushTrace(trace, "sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    emitProgress("sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    result = await waitForTerminalJob(handle, {
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
      autoConfirm: false,
      trace,
    });
  } else if (action === "smart-image-create-and-wait") {
    pushTrace(trace, "sdk.job.create.started", {
      action,
      createParams: payload.createParams ?? {},
    });
    emitProgress("sdk.job.create.started", {
      action,
      status: "creating",
    });
    const handle = await client.smartImage.recreations.create(payload.createParams ?? {});
    pushTrace(trace, "sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    emitProgress("sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    result = await waitForTerminalJob(handle, {
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
      autoConfirm: false,
      trace,
    });
  } else if (action === "image-create-and-wait") {
    pushTrace(trace, "sdk.job.create.started", {
      action,
      createParams: payload.createParams ?? {},
    });
    emitProgress("sdk.job.create.started", {
      action,
      status: "creating",
    });
    const handle = await client.image.recreations.create(payload.createParams ?? {});
    pushTrace(trace, "sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    emitProgress("sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    result = await waitForTerminalJob(handle, {
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
      autoConfirm: payload.autoConfirm ?? true,
      trace,
    });
  } else if (action === "video-create-and-wait") {
    pushTrace(trace, "sdk.job.create.started", {
      action,
      createParams: payload.createParams ?? {},
    });
    emitProgress("sdk.job.create.started", {
      action,
      status: "creating",
    });
    const handle = await client.video.recreations.create(payload.createParams ?? {});
    pushTrace(trace, "sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    emitProgress("sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    result = await waitForTerminalJob(handle, {
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
      autoConfirm: payload.autoConfirm ?? true,
      trace,
    });
  } else if (
    action === "product-report-create-and-wait" ||
    action === "competitor-analyze-and-wait" ||
    action === "competitor-analyze-multi-and-wait" ||
    action === "creator-analyze-and-wait" ||
    action === "creator-score-create-and-wait" ||
    action === "video-analysis-create-and-wait"
  ) {
    pushTrace(trace, "sdk.job.create.started", {
      action,
      createParams: payload.createParams ?? {},
    });
    emitProgress("sdk.job.create.started", {
      action,
      status: "creating",
    });
    const handle = await createAnalysisJob(client, action, payload.createParams ?? {});
    pushTrace(trace, "sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    emitProgress("sdk.job.create.completed", {
      action,
      jobId: handle.id,
      status: handle.data?.status ?? "unknown",
    });
    result = await waitForTerminalJob(handle, {
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
      autoConfirm: false,
      trace,
    });
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
