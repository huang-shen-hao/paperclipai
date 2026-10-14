import fs from "node:fs";
import path from "node:path";
import { PAL_ORIGIN_LABEL } from "./origin.js";
import {
  asRecord,
  asString,
  collectFiles,
  cwdFromSlug,
  firstLine,
  readJsonLines,
  statSafe,
  type JsonObject,
} from "./jsonl.js";
import type {
  DetailOptions,
  ListOptions,
  SessionDetail,
  SessionMessage,
  SessionProvider,
  SessionProviderId,
  SessionSummary,
} from "./types.js";

/**
 * QwenWork/Qoder CLI and Claude Code write the same transcript dialect: one
 * JSONL file per session under `<storeDir>/projects/<cwd-slug>/<session>.jsonl`,
 * with `user` / `assistant` turns, a `last-prompt` breadcrumb, and (for
 * Paperclip-started runs) a `custom-title`.
 *
 * The two stores differ only in where the working directory is recorded and
 * which breadcrumb makes the best title, so both use this factory.
 */

export type ClaudeStyleConfig = {
  id: SessionProviderId;
  displayName: string;
  /** Dot-directory under the home directory, e.g. `.qoder-cn`. */
  storeDir: string;
  /** Title preference order among the breadcrumbs the store records. */
  titlePreference: ReadonlyArray<"customTitle" | "summary" | "firstUserText" | "lastPrompt">;
};

function isSessionFile(filePath: string): boolean {
  return filePath.endsWith(".jsonl");
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}

function messageFromEntry(entry: JsonObject): SessionMessage | null {
  const type = entry.type;
  if (type !== "user" && type !== "assistant") return null;
  const message = asRecord(entry.message);
  if (!message) return null;
  const parsed = Date.parse(String(entry.timestamp ?? ""));
  const timestamp = Number.isFinite(parsed) ? parsed : null;
  if (type === "user") {
    const humanInput = asRecord(entry.humanInput);
    const text = asString(humanInput?.text) ?? textFromContent(message.content);
    if (!text.trim()) return null;
    return { role: "user", text, timestamp };
  }
  const text = textFromContent(message.content);
  if (!text.trim()) return null;
  const model = asString(message.model);
  return { role: "assistant", text, timestamp, toolName: model ? `model:${model}` : null };
}

type Breadcrumbs = {
  customTitle: string | null;
  summary: string | null;
  lastPrompt: string | null;
  firstUserText: string | null;
  cwd: string | null;
  model: string | null;
  sessionId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  messageCount: number;
};

function collectBreadcrumbs(entries: JsonObject[]): Breadcrumbs {
  const crumbs: Breadcrumbs = {
    customTitle: null,
    summary: null,
    lastPrompt: null,
    firstUserText: null,
    cwd: null,
    model: null,
    sessionId: null,
    createdAt: null,
    updatedAt: null,
    messageCount: 0,
  };
  for (const entry of entries) {
    switch (entry.type) {
      case "custom-title":
        crumbs.customTitle = asString(entry.customTitle) ?? crumbs.customTitle;
        break;
      case "summary":
        crumbs.summary = asString(entry.summary) ?? crumbs.summary;
        break;
      case "last-prompt":
        crumbs.lastPrompt = asString(entry.lastPrompt) ?? crumbs.lastPrompt;
        break;
      case "workspace-directories": {
        const directories = entry.directories;
        if (Array.isArray(directories) && typeof directories[0] === "string") crumbs.cwd = directories[0];
        break;
      }
      case "runtime-config":
        crumbs.model = asString(entry.model) ?? crumbs.model;
        break;
      default:
        break;
    }
    crumbs.cwd = asString(entry.cwd) ?? crumbs.cwd;
    crumbs.sessionId = asString(entry.sessionId) ?? crumbs.sessionId;
    const message = messageFromEntry(entry);
    if (!message) continue;
    crumbs.messageCount += 1;
    if (!message.timestamp) continue;
    crumbs.createdAt = crumbs.createdAt === null ? message.timestamp : Math.min(crumbs.createdAt, message.timestamp);
    crumbs.updatedAt = crumbs.updatedAt === null ? message.timestamp : Math.max(crumbs.updatedAt, message.timestamp);
    if (message.role === "user" && !crumbs.firstUserText) crumbs.firstUserText = firstLine(message.text);
  }
  return crumbs;
}

function pickTitle(crumbs: Breadcrumbs, preference: ClaudeStyleConfig["titlePreference"], fallback: string): string {
  for (const key of preference) {
    const value = crumbs[key];
    if (value) return key === "firstUserText" ? value : firstLine(value);
  }
  return fallback;
}

export function createClaudeStyleProvider(config: ClaudeStyleConfig): SessionProvider {
  const storePath = (homeDir: string): string => path.join(homeDir, config.storeDir, "projects");

  const summarize = (filePath: string, entries: JsonObject[]): SessionSummary | null => {
    const stat = statSafe(filePath);
    if (!stat) return null;
    const slug = path.basename(path.dirname(filePath));
    const crumbs = collectBreadcrumbs(entries);
    const sessionId = crumbs.sessionId ?? path.basename(filePath, ".jsonl");
    const title = pickTitle(crumbs, config.titlePreference, sessionId);
    return {
      provider: config.id,
      id: sessionId,
      title,
      cwd: crumbs.cwd ?? cwdFromSlug(slug),
      model: crumbs.model,
      origin: title.startsWith(PAL_ORIGIN_LABEL) ? "paperclip" : null,
      createdAt: crumbs.createdAt ?? (Number.isFinite(stat.birthtimeMs) ? Math.round(stat.birthtimeMs) : null),
      updatedAt: crumbs.updatedAt ?? Math.round(stat.mtimeMs),
      messageCount: crumbs.messageCount,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      filePath,
      archived: false,
    };
  };

  return {
    id: config.id,
    displayName: config.displayName,
    storePath,
    async list(options: ListOptions) {
      const files = collectFiles(storePath(options.homeDir), isSessionFile, options.maxSessions);
      const summaries: SessionSummary[] = [];
      for (const filePath of files) {
        const summary = summarize(filePath, readJsonLines(filePath));
        if (!summary) continue;
        if (options.hideEmptySessions && summary.messageCount === 0) continue;
        summaries.push(summary);
      }
      summaries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return summaries;
    },
    async read(id: string, options: DetailOptions) {
      const files = collectFiles(storePath(options.homeDir), isSessionFile, 20000);
      const filePath = files.find(candidate => path.basename(candidate, ".jsonl") === id);
      if (!filePath || !fs.existsSync(filePath)) return null;
      const entries = readJsonLines(filePath);
      const summary = summarize(filePath, entries);
      if (!summary) return null;
      const messages = entries
        .map(messageFromEntry)
        .filter((message): message is SessionMessage => message !== null);
      const truncated = messages.length > options.maxMessages;
      return {
        summary,
        messages: truncated ? messages.slice(messages.length - options.maxMessages) : messages,
        truncated,
      } satisfies SessionDetail;
    },
  };
}
