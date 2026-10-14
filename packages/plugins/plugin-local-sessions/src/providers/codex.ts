import path from "node:path";
import { CODEX_REQUEST_MARKER, PAL_ORIGIN_LABEL, titleFromCodexUserText } from "./origin.js";
import {
  asRecord,
  asString,
  collectFiles,
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
  SessionSummary,
} from "./types.js";

/**
 * Codex sessions.
 *
 * Layout: `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` for live
 * sessions and `~/.codex/archived_sessions/rollout-*.jsonl` for archived ones.
 * `~/.codex/history.jsonl` keeps the human prompt per session, which is a far
 * better title than the transcript's first line (that is often boilerplate).
 */

const CODEX_DIR = ".codex";
const LIVE_DIR = "sessions";
const ARCHIVED_DIR = "archived_sessions";
const HISTORY_FILE = "history.jsonl";

function isRolloutFile(filePath: string): boolean {
  return path.basename(filePath).startsWith("rollout-") && filePath.endsWith(".jsonl");
}

type HistoryEntry = { sessionId: string; text: string; ts: number | null };

function readHistory(homeDir: string): Map<string, HistoryEntry> {
  const byId = new Map<string, HistoryEntry>();
  const entries = readJsonLines(path.join(homeDir, CODEX_DIR, HISTORY_FILE));
  for (const entry of entries) {
    const sessionId = asString(entry.session_id);
    const text = asString(entry.text);
    if (!sessionId || !text) continue;
    const existing = byId.get(sessionId);
    if (existing) continue;
    byId.set(sessionId, {
      sessionId,
      text,
      ts: typeof entry.ts === "number" ? entry.ts * 1000 : null,
    });
  }
  return byId;
}

function contentText(payload: JsonObject): string {
  const content = payload.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}

function messageFromEntry(entry: JsonObject): SessionMessage | null {
  if (entry.type !== "response_item") return null;
  const payload = asRecord(entry.payload);
  if (!payload || payload.type !== "message") return null;
  const role = asString(payload.role);
  if (role !== "user" && role !== "assistant") return null;
  const text = contentText(payload);
  if (!text.trim()) return null;
  const parsed = Date.parse(String(entry.timestamp ?? ""));
  return { role, text, timestamp: Number.isFinite(parsed) ? parsed : null };
}

function sessionMetaOf(entries: JsonObject[]): JsonObject | null {
  for (const entry of entries) {
    if (entry.type !== "session_meta") continue;
    const payload = asRecord(entry.payload);
    if (payload) return payload;
  }
  return null;
}

function summarize(
  filePath: string,
  entries: JsonObject[],
  archived: boolean,
  history: Map<string, HistoryEntry>,
): SessionSummary | null {
  const stat = statSafe(filePath);
  if (!stat) return null;
  const meta = sessionMetaOf(entries);
  const id = asString(meta?.session_id) ?? path.basename(filePath).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  const historyEntry = history.get(id);
  let messageCount = 0;
  let requestedTitle: string | null = null;
  let firstUserText: string | null = null;
  let createdAt: number | null = null;
  let updatedAt: number | null = null;

  for (const entry of entries) {
    const message = messageFromEntry(entry);
    if (!message) continue;
    messageCount += 1;
    if (message.timestamp) {
      createdAt = createdAt === null ? message.timestamp : Math.min(createdAt, message.timestamp);
      updatedAt = updatedAt === null ? message.timestamp : Math.max(updatedAt, message.timestamp);
    }
    if (message.role !== "user") continue;
    if (!firstUserText) firstUserText = message.text;
    const candidate = titleFromCodexUserText(message.text).trim();
    const isBoilerplate = message.text.includes(CODEX_REQUEST_MARKER)
      || message.text.trimStart().startsWith("# AGENTS.md")
      || message.text.trimStart().startsWith("<app-context>")
      || message.text.trimStart().startsWith("<INSTRUCTIONS>");
    if (candidate && !isBoilerplate && !requestedTitle) requestedTitle = firstLine(candidate);
  }

  const historyText = historyEntry?.text ? firstLine(titleFromCodexUserText(historyEntry.text)) : null;
  const title = requestedTitle ?? historyText ?? (firstUserText ? firstLine(firstUserText) : null) ?? id;
  const metaTimestamp = Date.parse(String(meta?.timestamp ?? ""));
  return {
    provider: "codex",
    id,
    title,
    cwd: asString(meta?.cwd),
    model: asString(meta?.model_provider),
    origin: asString(meta?.originator) ?? asString(meta?.source),
    createdAt: createdAt ?? (Number.isFinite(metaTimestamp) ? metaTimestamp : Math.round(stat.birthtimeMs)),
    updatedAt: updatedAt ?? Math.round(stat.mtimeMs),
    messageCount,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    filePath,
    archived,
  };
}

export const codexProvider: SessionProvider = {
  id: "codex",
  displayName: "Codex",
  storePath(homeDir) {
    return path.join(homeDir, CODEX_DIR, LIVE_DIR);
  },
  async list(options: ListOptions) {
    const history = readHistory(options.homeDir);
    const live = collectFiles(path.join(options.homeDir, CODEX_DIR, LIVE_DIR), isRolloutFile, options.maxSessions);
    const archived = collectFiles(
      path.join(options.homeDir, CODEX_DIR, ARCHIVED_DIR),
      isRolloutFile,
      options.maxSessions,
      1,
    ).map(filePath => ({ filePath, archived: true }));
    const candidates = [
      ...live.map(filePath => ({ filePath, archived: false })),
      ...archived,
    ];
    const summaries: SessionSummary[] = [];
    for (const candidate of candidates) {
      const summary = summarize(candidate.filePath, readJsonLines(candidate.filePath), candidate.archived, history);
      if (!summary) continue;
      if (options.hideEmptySessions && (summary.messageCount ?? 0) === 0) continue;
      summaries.push(summary);
    }
    summaries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return summaries.slice(0, options.maxSessions);
  },
  async read(id: string, options: DetailOptions) {
    const roots: Array<{ dir: string; archived: boolean }> = [
      { dir: path.join(options.homeDir, CODEX_DIR, LIVE_DIR), archived: false },
      { dir: path.join(options.homeDir, CODEX_DIR, ARCHIVED_DIR), archived: true },
    ];
    for (const root of roots) {
      const match = collectFiles(root.dir, isRolloutFile, 20000).find(filePath => filePath.includes(id));
      if (!match) continue;
      const entries = readJsonLines(match);
      const summary = summarize(match, entries, root.archived, readHistory(options.homeDir));
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
    }
    return null;
  },
};
