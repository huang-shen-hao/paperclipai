/**
 * Local Codex defaults.
 *
 * Many teams point their *host* Codex CLI at a relay/gateway by configuring
 * `~/.codex/config.toml` (custom `model_provider` with `base_url` and a bearer
 * token). Paperclip runs Codex inside a managed CODEX_HOME, so without this
 * helper an agent that does not pick a model in the UI silently falls back to
 * Codex's built-in default model — which a relay usually does not serve
 * ("503 No available channel for model ...").
 *
 * This module reads the host config so the adapter can reuse the machine's
 * existing model / endpoint / credential instead of forcing operators to
 * recreate the same values as a Paperclip AI connection.
 *
 * Opt out with PAPERCLIP_CODEX_LOCAL_DEFAULTS=0.
 * Point at a different file with PAPERCLIP_CODEX_LOCAL_CONFIG=/path/to/config.toml.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LocalCodexDefaults = {
  /** Path of the config that produced these values (for logging). */
  configPath: string;
  model: string | null;
  providerId: string | null;
  baseUrl: string | null;
  /** Literal bearer token from the provider table, when present. */
  bearerToken: string | null;
  /** Provider `env_key` (env var Codex reads the key from), when present. */
  envKey: string | null;
  wireApi: string | null;
};

function readEnvFile(file: string, env: NodeJS.ProcessEnv): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || env[key] !== undefined) continue;
    env[key] = value;
  }
}

/** Extract a `key = "value"` scalar from a TOML fragment (first match wins). */
function tomlString(fragment: string, key: string): string | null {
  const match = fragment.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "m"));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/** Body of `[model_providers.<id>]`, stopping at the next table header. */
function providerTable(content: string, providerId: string): string {
  const header = new RegExp(`^\\s*\\[model_providers\\.(?:"${providerId}"|${providerId})\\]\\s*$`, "m");
  const start = content.match(header);
  if (!start || start.index === undefined) return "";
  const rest = content.slice(start.index + start[0].length);
  const nextTable = rest.search(/^\s*\[/m);
  return nextTable === -1 ? rest : rest.slice(0, nextTable);
}

/**
 * Read the host machine's Codex defaults. Returns null when disabled, missing,
 * or unusable (no model and no provider endpoint).
 */
export function readLocalCodexDefaults(env: NodeJS.ProcessEnv = process.env): LocalCodexDefaults | null {
  if ((env.PAPERCLIP_CODEX_LOCAL_DEFAULTS ?? "").trim() === "0") return null;

  const configPath =
    (env.PAPERCLIP_CODEX_LOCAL_CONFIG ?? "").trim() ||
    path.join(env.HOME || os.homedir(), ".codex", "config.toml");

  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }

  const model = tomlString(content, "model");
  const providerId = tomlString(content, "model_provider");
  const table = providerId ? providerTable(content, providerId) : "";

  let bearerToken = table ? tomlString(table, "experimental_bearer_token") : null;
  const envKey = table ? tomlString(table, "env_key") : null;
  const baseUrl = table ? tomlString(table, "base_url") : null;

  // Resolve the key from the machine's .env files when the provider points at
  // an env var instead of carrying a literal token.
  if (!bearerToken && envKey) {
    const codexHome = path.dirname(configPath);
    const fileEnv: NodeJS.ProcessEnv = {};
    readEnvFile(path.join(codexHome, ".env"), fileEnv);
    readEnvFile(path.join(os.homedir(), ".hermes", ".env"), fileEnv);
    bearerToken = (env[envKey] ?? fileEnv[envKey] ?? "").trim() || null;
  }

  if (!model && !baseUrl) return null;

  return {
    configPath,
    model: model || null,
    providerId: providerId || null,
    baseUrl: baseUrl || null,
    bearerToken: bearerToken || null,
    envKey: envKey || null,
    wireApi: table ? tomlString(table, "wire_api") : null,
  };
}
