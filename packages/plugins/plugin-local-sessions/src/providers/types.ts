/**
 * Shared shapes for the local session providers.
 *
 * Everything here is read-only metadata derived from files that already exist
 * on the operator's machine. The plugin never writes to a provider store.
 */

export const SESSION_PROVIDER_IDS = ["qoder", "codex", "claude", "hermes"] as const;

export type SessionProviderId = (typeof SESSION_PROVIDER_IDS)[number];

export type SessionSummary = {
  provider: SessionProviderId;
  /** Provider-native session identifier. */
  id: string;
  title: string;
  cwd: string | null;
  model: string | null;
  /** Where the session came from (e.g. `paperclip`, `dingtalk`, `codex_work_desktop`). */
  origin: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  messageCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Absolute path of the backing store, for operators who want to inspect it directly. */
  filePath: string | null;
  archived: boolean;
};

export type SessionMessage = {
  role: string;
  text: string;
  timestamp: number | null;
  toolName?: string | null;
};

export type SessionDetail = {
  summary: SessionSummary;
  messages: SessionMessage[];
  /** True when the transcript was clipped by `maxMessagesPerSession`. */
  truncated: boolean;
};

export type ListOptions = {
  homeDir: string;
  maxSessions: number;
  hideEmptySessions: boolean;
};

export type DetailOptions = {
  homeDir: string;
  maxMessages: number;
};

export type ProviderDescriptor = {
  id: SessionProviderId;
  displayName: string;
  /** Human-readable location the provider reads from. */
  storePath: string;
  available: boolean;
  /** Why a provider is unavailable, when it is. */
  reason?: string;
  count: number;
};

export interface SessionProvider {
  readonly id: SessionProviderId;
  readonly displayName: string;
  /** Path of the backing store for the given home directory. */
  storePath(homeDir: string): string;
  list(options: ListOptions): Promise<SessionSummary[]>;
  read(id: string, options: DetailOptions): Promise<SessionDetail | null>;
}
