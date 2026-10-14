import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/**
 * Stable plugin id used by host registration and namespacing.
 */
export const PLUGIN_ID = "paperclip.local-sessions";

/** Route the full-page slot is mounted at (`/:companyPrefix/local-sessions`). */
export const PAGE_ROUTE = "local-sessions";

export const SLOT_IDS = {
  page: "local-sessions-page",
  sidebar: "local-sessions-sidebar-link",
} as const;

export const EXPORT_NAMES = {
  page: "LocalSessionsPage",
  sidebar: "LocalSessionsSidebarLink",
} as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Local Sessions",
  description:
    "Read-only browser for the agent sessions that live on this machine: QwenWork/Qoder CLI, Codex, Claude Code, and Hermes. Sessions started from Paperclip are labelled so a platform task can be traced back to the local transcript that produced it.",
  author: "huang-shen-hao",
  categories: ["ui", "workspace"],
  capabilities: ["ui.page.register", "ui.sidebar.register"],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      homeDir: {
        type: "string",
        title: "Home directory to scan",
        description:
          "Absolute path whose dot-directories hold the session stores. Leave empty to use the server process HOME.",
      },
      maxSessionsPerProvider: {
        type: "number",
        title: "Max sessions per provider",
        default: 200,
        minimum: 1,
        maximum: 2000,
      },
      maxMessagesPerSession: {
        type: "number",
        title: "Max messages per transcript",
        default: 400,
        minimum: 1,
        maximum: 5000,
      },
      hideEmptySessions: {
        type: "boolean",
        title: "Hide sessions with no messages",
        default: true,
      },
    },
  },
  ui: {
    slots: [
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Local Sessions",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: "Local Sessions",
        exportName: EXPORT_NAMES.sidebar,
      },
    ],
  },
};

export default manifest;
