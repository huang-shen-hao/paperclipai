import fs from "node:fs";
import path from "node:path";

/**
 * Minimal JSONL helpers shared by the file-backed providers.
 *
 * Session stores are append-only transcripts; a half-written trailing line is
 * expected while an agent is mid-turn, so unparseable lines are skipped rather
 * than failing the whole read.
 */

export type JsonObject = Record<string, unknown>;

export function parseJsonLine(line: string): JsonObject | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

export function readJsonLines(filePath: string): JsonObject[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: JsonObject[] = [];
  for (const line of text.split("\n")) {
    const parsed = parseJsonLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Recursively collect files matching `test`, newest first, bounded by `limit`. */
export function collectFiles(
  root: string,
  test: (absolutePath: string) => boolean,
  limit: number,
  maxDepth = 6,
): string[] {
  const found: Array<{ filePath: string; mtimeMs: number }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !test(full)) continue;
      const stat = fs.statSync(full, { throwIfNoEntry: false });
      if (!stat) continue;
      found.push({ filePath: full, mtimeMs: stat.mtimeMs });
    }
  };
  walk(root, 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, limit).map(entry => entry.filePath);
}

export function statSafe(filePath: string): fs.Stats | null {
  return fs.statSync(filePath, { throwIfNoEntry: false }) ?? null;
}

/**
 * Provider directories name themselves after the working directory with path
 * separators replaced by `-` (e.g. `-Users-me-code-app`). That is lossy, so it
 * is only used when the transcript itself does not record the cwd.
 */
export function cwdFromSlug(slug: string): string | null {
  if (!slug.startsWith("-")) return null;
  return slug.replace(/-/g, "/");
}

export function firstLine(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}
