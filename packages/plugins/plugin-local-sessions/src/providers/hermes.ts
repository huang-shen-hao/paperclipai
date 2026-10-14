import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asString, firstLine } from "./jsonl.js";
import type {
  DetailOptions,
  ListOptions,
  SessionDetail,
  SessionMessage,
  SessionProvider,
  SessionSummary,
} from "./types.js";

/**
 * Hermes Agent sessions live in a SQLite database at `~/.hermes/state.db`
 * (`sessions` + `messages`). Unlike the JSONL stores this one carries real
 * accounting — token counts and estimated cost per session — so those fields
 * are surfaced in the UI when available.
 *
 * The database is opened read-only and closed immediately after each query;
 * the plugin must never contend with a running Hermes process.
 */

const HERMES_DIR = ".hermes";
const STATE_DB = "state.db";

type Row = Record<string, unknown>;

function withDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T | null {
  if (!fs.existsSync(dbPath)) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return fn(db);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // A read-only handle that refuses to close must not mask the query result.
    }
  }
}

function secondsToMillis(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) : null;
}

function toSummary(row: Row): SessionSummary {
  const id = String(row.id);
  const displayName = asString(row.title) ?? asString(row.display_name);
  return {
    provider: "hermes",
    id,
    title: displayName ?? firstLine(asString(row.last_activity_description) ?? id),
    cwd: asString(row.cwd),
    model: asString(row.model),
    origin: asString(row.source) ?? asString(row.profile_name),
    createdAt: secondsToMillis(row.started_at),
    updatedAt: secondsToMillis(row.last_activity_at) ?? secondsToMillis(row.started_at),
    messageCount: typeof row.message_count === "number" ? row.message_count : null,
    inputTokens: typeof row.input_tokens === "number" ? row.input_tokens : null,
    outputTokens: typeof row.output_tokens === "number" ? row.output_tokens : null,
    costUsd: typeof row.actual_cost_usd === "number"
      ? row.actual_cost_usd
      : (typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : null),
    filePath: null,
    archived: row.archived === 1,
  };
}

const SESSION_COLUMNS = [
  "id", "source", "display_name", "title", "model", "cwd", "profile_name",
  "started_at", "last_activity_at", "last_activity_description",
  "message_count", "input_tokens", "output_tokens",
  "estimated_cost_usd", "actual_cost_usd", "archived", "hidden",
].join(", ");

export const hermesProvider: SessionProvider = {
  id: "hermes",
  displayName: "Hermes Agent",
  storePath(homeDir) {
    return path.join(homeDir, HERMES_DIR, STATE_DB);
  },
  async list(options: ListOptions) {
    const dbPath = this.storePath(options.homeDir);
    const rows = withDb(dbPath, db => db.prepare(
      `select ${SESSION_COLUMNS} from sessions where coalesce(hidden, 0) = 0 `
      + `order by coalesce(last_activity_at, started_at) desc limit ?`,
    ).all(options.maxSessions) as unknown as Row[]);
    if (!rows) return [];
    const summaries = rows.map(toSummary);
    return options.hideEmptySessions
      ? summaries.filter(summary => (summary.messageCount ?? 0) > 0)
      : summaries;
  },
  async read(id: string, options: DetailOptions) {
    const dbPath = this.storePath(options.homeDir);
    return withDb(dbPath, db => {
      const row = db.prepare(`select ${SESSION_COLUMNS} from sessions where id = ?`).get(id) as unknown as Row | undefined;
      if (!row) return null;
      const rows = db.prepare(
        "select role, content, tool_name, timestamp from messages where session_id = ? order by id asc",
      ).all(id) as unknown as Row[];
      const messages: SessionMessage[] = [];
      for (const message of rows) {
        const content = asString(message.content);
        if (!content || !content.trim()) continue;
        messages.push({
          role: asString(message.role) ?? "unknown",
          text: content,
          timestamp: secondsToMillis(message.timestamp),
          toolName: asString(message.tool_name),
        });
      }
      const truncated = messages.length > options.maxMessages;
      return {
        summary: toSummary(row),
        messages: truncated ? messages.slice(messages.length - options.maxMessages) : messages,
        truncated,
      } satisfies SessionDetail;
    });
  },
};
