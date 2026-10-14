import { createClaudeStyleProvider } from "./claude-style.js";
import type { SessionProvider } from "./types.js";

/**
 * QwenWork / Qoder CLI sessions.
 *
 * Layout: `~/.qoder-cn/projects/<cwd-slug>/<sessionId>.jsonl`. The store is
 * shared by interactive sessions and by the headless `qoderclicn` runs the
 * QwenWork adapter starts, so a Paperclip task shows up here too — those carry
 * a `custom-title` of the form `Paperclip · <task>`.
 */
export const qoderProvider: SessionProvider = createClaudeStyleProvider({
  id: "qoder",
  displayName: "千问办公 / Qoder CLI",
  storeDir: ".qoder-cn",
  titlePreference: ["customTitle", "firstUserText", "lastPrompt"],
});
