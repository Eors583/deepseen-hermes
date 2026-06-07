import { readFile } from "fs/promises";
import { join } from "path";
import { getProfileDir } from "./hermes-profile";

export interface DeepseenUploadedResource {
  id: string;
  url: string;
}

interface DeepseenUploadConfig {
  uploadUrl: string;
  apiKey: string;
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

async function readProfileEnv(
  profile: string,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(getProfileDir(profile), ".env"), "utf-8");
    return parseEnv(raw);
  } catch {
    return {};
  }
}

function ensureUploadUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/\/v1\/files$/i.test(value)) return value;
  if (/\/v1$/i.test(value)) return `${value}/files`;
  return `${value}/v1/files`;
}

export async function resolveDeepseenUploadConfig(
  profile: string,
): Promise<DeepseenUploadConfig> {
  const profileEnv = await readProfileEnv(profile);
  const uploadUrl = ensureUploadUrl(
    profileEnv.DEEPSEEN_BASE_URL ||
      process.env.DEEPSEEN_BASE_URL ||
      profileEnv.DEEPSEEN_UPLOAD_URL ||
      process.env.DEEPSEEN_UPLOAD_URL ||
      "https://deepseen.ai/v1",
  );
  const apiKey = (
    profileEnv.DEEPSEEN_API_KEY ||
    process.env.DEEPSEEN_API_KEY ||
    ""
  ).trim();

  return { uploadUrl, apiKey };
}

export function isDeepseenUploadMediaType(mediaType: string): boolean {
  const normalized = String(mediaType || "")
    .trim()
    .toLowerCase();
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ].includes(normalized);
}

export async function uploadToDeepseenResource(params: {
  profile: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  purpose?: string;
  authorization?: string;
}): Promise<DeepseenUploadedResource | null> {
  const config = await resolveDeepseenUploadConfig(params.profile);
  if (!isDeepseenUploadMediaType(params.contentType)) return null;
  if (!config.apiKey) {
    throw new Error("Deepseen 资源上传失败: profile 缺少 DEEPSEEN_API_KEY");
  }

  const form = new FormData();
  const bytes = Uint8Array.from(params.buffer);
  form.append("purpose", params.purpose || "product_image");
  form.append(
    "file",
    new Blob([bytes], { type: params.contentType }),
    params.filename,
  );

  const res = await fetch(config.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.error?.message || payload?.message || `HTTP ${res.status}`;
    throw new Error(`Deepseen 资源上传失败: ${message}`);
  }

  const id = payload?.id;
  const url = payload?.url;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Deepseen 资源上传失败: 响应缺少 id");
  }
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Deepseen 资源上传失败: 响应缺少 url");
  }

  return { id: id.trim(), url: url.trim() };
}
