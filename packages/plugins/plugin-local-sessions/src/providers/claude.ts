import { createClaudeStyleProvider } from "./claude-style.js";
import type { SessionProvider } from "./types.js";

/**
 * Claude Code sessions, stored as `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`.
 */
export const claudeProvider: SessionProvider = createClaudeStyleProvider({
  id: "claude",
  displayName: "Claude Code",
  storeDir: ".claude",
  titlePreference: ["customTitle", "summary", "lastPrompt", "firstUserText"],
});
