import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginPageProps, PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import { useHostLocation, useHostNavigation, usePluginAction, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { PAGE_ROUTE } from "../manifest.js";

/**
 * Local Sessions page.
 *
 * Read-only window onto the agent transcripts on this machine. The list is
 * intentionally cheap to scan: provider, title, working directory, age, turn
 * count, and — where the store records it — tokens and cost.
 *
 * Styling note: plugin UI runs inside the host document, but the host's
 * Tailwind build only compiles the classes it finds in the host's own sources.
 * Classes invented here would silently do nothing, so this plugin ships a
 * small scoped stylesheet (`pls-*`) and layers it on top of the host theme
 * variables.
 */

type SessionProviderId = "qoder" | "codex" | "claude" | "hermes";

type SessionSummary = {
  provider: SessionProviderId;
  id: string;
  title: string;
  cwd: string | null;
  model: string | null;
  origin: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  messageCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  filePath: string | null;
  archived: boolean;
};

type SessionMessage = {
  role: string;
  text: string;
  timestamp: number | null;
  toolName?: string | null;
};

type SessionDetail = {
  summary: SessionSummary;
  messages: SessionMessage[];
  truncated: boolean;
};

type ProviderDescriptor = {
  id: SessionProviderId;
  displayName: string;
  storePath: string;
  available: boolean;
  reason?: string;
  count: number;
};

type SnapshotResponse = {
  homeDir: string;
  scannedAt: number;
  providers: ProviderDescriptor[];
  total: number;
  sessions: SessionSummary[];
};

type DetailResponse = {
  detail: SessionDetail | null;
  error?: string;
};

const PROVIDER_LABELS: Record<SessionProviderId, string> = {
  qoder: "千问办公",
  codex: "Codex",
  claude: "Claude Code",
  hermes: "Hermes",
};

const STYLE_ELEMENT_ID = "paperclip-local-sessions-styles";

const STYLES = `
.pls-shell { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-height: 0; color: var(--foreground); }
.pls-row-between { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pls-title { font-size: 16px; font-weight: 600; margin: 0; }
.pls-muted { color: var(--muted-foreground); font-size: 11px; }
.pls-mono { font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, monospace; }
.pls-button { border: 1px solid var(--border); background: var(--background); color: var(--foreground); border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; }
.pls-button:hover { background: var(--accent); }
.pls-button:disabled { opacity: 0.6; cursor: default; }
.pls-chip { border: 1px solid var(--border); color: var(--muted-foreground); background: transparent; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.pls-chip:hover { background: var(--accent); }
.pls-chip[aria-pressed="true"] { border-color: var(--primary); color: var(--primary); background: color-mix(in oklab, var(--primary) 12%, transparent); font-weight: 500; }
.pls-chip-count { opacity: 0.7; font-size: 10px; }
.pls-search { margin-left: auto; width: 220px; border: 1px solid var(--border); background: var(--background); color: var(--foreground); border-radius: 6px; padding: 6px 10px; font-size: 12px; }
.pls-grid { display: grid; gap: 12px; min-height: 28rem; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1024px) { .pls-grid { grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); } }
.pls-panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
.pls-panel-head { border-bottom: 1px solid var(--border); padding: 8px 12px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted-foreground); }
.pls-list { flex: 1 1 auto; min-height: 0; overflow: auto; }
.pls-session { display: block; width: 100%; border: 0; border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent); background: transparent; color: inherit; text-align: left; padding: 8px 12px; cursor: pointer; font: inherit; }
.pls-session:hover { background: color-mix(in oklab, var(--accent) 40%, transparent); }
.pls-session[aria-current="true"] { background: var(--accent); }
.pls-session-title { margin-top: 4px; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pls-session-line { margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 11px; color: var(--muted-foreground); }
.pls-session-cwd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pls-badge { display: inline-flex; align-items: center; border-radius: 4px; border: 1px solid; padding: 1px 6px; font-size: 10px; font-weight: 500; flex-shrink: 0; }
.pls-badge-qoder { color: #7c3aed; border-color: color-mix(in oklab, #7c3aed 35%, transparent); background: color-mix(in oklab, #7c3aed 12%, transparent); }
.pls-badge-codex { color: #047857; border-color: color-mix(in oklab, #047857 35%, transparent); background: color-mix(in oklab, #047857 12%, transparent); }
.pls-badge-claude { color: #b45309; border-color: color-mix(in oklab, #b45309 35%, transparent); background: color-mix(in oklab, #b45309 12%, transparent); }
.pls-badge-hermes { color: #0369a1; border-color: color-mix(in oklab, #0369a1 35%, transparent); background: color-mix(in oklab, #0369a1 12%, transparent); }
.pls-badge-paperclip { color: var(--primary); border-color: color-mix(in oklab, var(--primary) 35%, transparent); background: color-mix(in oklab, var(--primary) 12%, transparent); }
.pls-detail-head { border-bottom: 1px solid var(--border); padding: 12px 16px; }
.pls-detail-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pls-meta { margin: 8px 0 0; display: grid; gap: 4px 24px; font-size: 11px; color: var(--muted-foreground); }
@media (min-width: 640px) { .pls-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pls-meta-row { display: flex; gap: 8px; }
.pls-meta-wide { grid-column: 1 / -1; }
.pls-meta dt { flex-shrink: 0; }
.pls-meta dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pls-transcript { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.pls-message { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--card); }
.pls-message-user { border-color: var(--border); background: color-mix(in oklab, var(--accent) 45%, var(--card)); }
.pls-message-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted-foreground); margin-bottom: 4px; }
.pls-role { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.pls-message-head time { margin-left: auto; }
.pls-message-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: 13px; line-height: 1.6; color: var(--foreground); }
.pls-empty { padding: 16px; font-size: 13px; color: var(--muted-foreground); }
.pls-error { font-size: 13px; color: var(--destructive); }
.pls-nav { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 13px; font-weight: 500; color: color-mix(in oklab, var(--foreground) 80%, transparent); transition: background-color 120ms ease; }
.pls-nav:hover { background: color-mix(in oklab, var(--accent) 50%, transparent); color: var(--foreground); }
.pls-nav[aria-current="page"] { background: var(--accent); color: var(--foreground); }
.pls-nav-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pls-nav svg { width: 16px; height: 16px; flex-shrink: 0; }
`;

/**
 * Inject the scoped stylesheet once per document. Both slots call this, so the
 * sidebar link keeps its look even when the page itself is not mounted.
 */
function useScopedStyles(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const element = document.createElement("style");
    element.id = STYLE_ELEMENT_ID;
    element.textContent = STYLES;
    document.head.appendChild(element);
  }, []);
}

function formatAge(timestamp: number | null): string {
  if (!timestamp) return "—";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "刚刚";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

function formatClock(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString();
}

function formatTokens(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function ProviderBadge({ provider }: { provider: SessionProviderId }) {
  return (
    <span
      className={`pls-badge pls-badge-${provider}`}
    >
      {PROVIDER_LABELS[provider]}
    </span>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: SessionSummary;
  selected: boolean;
  onSelect: (session: SessionSummary) => void;
}) {
  const usage = [
    formatTokens(session.inputTokens) ? `↑${formatTokens(session.inputTokens)}` : null,
    formatTokens(session.outputTokens) ? `↓${formatTokens(session.outputTokens)}` : null,
    session.costUsd !== null && session.costUsd !== undefined ? `$${session.costUsd.toFixed(3)}` : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      className="pls-session"
      aria-current={selected ? "true" : undefined}
    >
      <div className="pls-row-between">
        <ProviderBadge provider={session.provider} />
        {session.origin === "paperclip" ? (
          <span className="pls-badge pls-badge-paperclip">
            来自 Paperclip
          </span>
        ) : null}
        <span className="pls-muted" style={{ marginLeft: "auto", flexShrink: 0 }}>
          {formatAge(session.updatedAt)}
        </span>
      </div>
      <div className="pls-session-title" title={session.title}>
        {session.title}
      </div>
      <div className="pls-session-line">
        <span className="pls-session-cwd pls-mono" title={session.cwd ?? ""}>
          {session.cwd ?? "—"}
        </span>
      </div>
      <div className="pls-session-line">
        {session.messageCount !== null ? <span>{session.messageCount} 条</span> : null}
        {session.model ? <span>{session.model}</span> : null}
        {session.archived ? <span>已归档</span> : null}
        {usage.map(item => <span key={item}>{item}</span>)}
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`pls-message${isUser ? " pls-message-user" : ""}`}>
      <div className="pls-message-head">
        <span className="pls-role">{message.role}</span>
        {message.toolName ? <span className="pls-mono">{message.toolName}</span> : null}
        <time>{formatClock(message.timestamp)}</time>
      </div>
      <pre className="pls-message-body">{message.text}</pre>
    </div>
  );
}

function Transcript({ provider, sessionId, companyId }: {
  provider: SessionProviderId;
  sessionId: string;
  companyId: string | null;
}) {
  const params = useMemo(() => ({ provider, id: sessionId, companyId }), [companyId, provider, sessionId]);
  const { data, loading, error } = usePluginData<DetailResponse>("session", params);
  const detail = data?.detail ?? null;

  if (loading && !detail) {
    return <p className="pls-empty">正在读取会话记录…</p>;
  }
  if (!detail) {
    return <p className="pls-empty pls-error">{error?.message ?? data?.error ?? "找不到该会话"}</p>;
  }
  return (
    <>
      <div className="pls-detail-head">
        <div className="pls-row-between">
          <ProviderBadge provider={detail.summary.provider} />
          <div className="pls-detail-title" title={detail.summary.title}>
            {detail.summary.title}
          </div>
        </div>
        <dl className="pls-meta">
          <div className="pls-meta-row">
            <dt>会话 ID</dt>
            <dd className="pls-mono">{detail.summary.id}</dd>
          </div>
          <div className="pls-meta-row">
            <dt>目录</dt>
            <dd className="pls-mono">{detail.summary.cwd ?? "—"}</dd>
          </div>
          <div className="pls-meta-row">
            <dt>开始</dt>
            <dd>{formatClock(detail.summary.createdAt)}</dd>
          </div>
          <div className="pls-meta-row">
            <dt>最近</dt>
            <dd>{formatClock(detail.summary.updatedAt)}</dd>
          </div>
          {detail.summary.filePath ? (
            <div className="pls-meta-row pls-meta-wide">
              <dt>存储位置</dt>
              <dd className="pls-mono">{detail.summary.filePath}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="pls-transcript">
        {detail.truncated ? (
          <p className="pls-muted">
            仅显示最近的部分消息。可在插件设置中调高「Max messages per transcript」。
          </p>
        ) : null}
        {detail.messages.length === 0 ? (
          <p className="pls-empty">这个会话没有可展示的对话内容。</p>
        ) : detail.messages.map((message, index) => (
          <MessageBubble key={`${index}-${message.timestamp ?? 0}`} message={message} />
        ))}
      </div>
    </>
  );
}

export function LocalSessionsPage({ context }: PluginPageProps) {
  useScopedStyles();
  const companyId = context.companyId ?? null;
  const [provider, setProvider] = useState<"all" | SessionProviderId>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshCache = usePluginAction("refresh");

  const params = useMemo(
    () => ({ companyId, provider, query, limit: 500, _refresh: refreshToken }),
    [companyId, provider, query, refreshToken],
  );
  const { data, loading, error, refresh } = usePluginData<SnapshotResponse>("snapshot", params);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const providers = useMemo(() => data?.providers ?? [], [data]);
  const providerOptions = useMemo(
    () => [
      { id: "all" as const, label: "全部", count: data?.total ?? 0 },
      ...providers.map(descriptor => ({
        id: descriptor.id,
        label: PROVIDER_LABELS[descriptor.id],
        count: descriptor.count,
      })),
    ],
    [data?.total, providers],
  );

  const selectedKey = selected ? `${selected.provider}:${selected.id}` : null;
  const listedKeys = useMemo(
    () => new Set(sessions.map(session => `${session.provider}:${session.id}`)),
    [sessions],
  );
  useEffect(() => {
    if (selectedKey && !listedKeys.has(selectedKey)) setSelected(null);
  }, [listedKeys, selectedKey]);

  const handleRefresh = useCallback(() => {
    void Promise.resolve(refreshCache({ companyId })).then(() => {
      setRefreshToken(token => token + 1);
      refresh();
    });
  }, [companyId, refresh, refreshCache]);

  const unavailable = providers.filter(descriptor => !descriptor.available);

  return (
    <div className="pls-shell">
      <header className="pls-row-between">
        <h1 className="pls-title">本机会话</h1>
        {data ? (
          <span className="pls-muted">
            共 {data.total} 个会话 · 扫描于 {new Date(data.scannedAt).toLocaleTimeString()}
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleRefresh}
          className="pls-button"
          style={{ marginLeft: "auto" }}
          disabled={loading}
        >
          {loading ? "扫描中…" : "重新扫描"}
        </button>
      </header>

      <div className="pls-row-between">
        {providerOptions.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => setProvider(option.id)}
            className="pls-chip"
            aria-pressed={provider === option.id}
          >
            {option.label}
            <span className="pls-chip-count">{option.count}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索标题 / 目录 / 模型"
          className="pls-search"
        />
      </div>

      {data ? (
        <p className="pls-muted">
          扫描目录 <span className="pls-mono">{data.homeDir}</span>
        </p>
      ) : null}

      {unavailable.length > 0 ? (
        <p className="pls-muted">
          未检出：{unavailable.map(descriptor => `${PROVIDER_LABELS[descriptor.id]}（${descriptor.storePath}）`).join("、")}
        </p>
      ) : null}

      {error ? <p className="pls-error">{error.message}</p> : null}

      <div className="pls-grid">
        <div className="pls-panel">
          <div className="pls-panel-head">会话列表</div>
          <div className="pls-list">
            {loading && sessions.length === 0 ? (
              <p className="pls-empty">正在扫描本机会话…</p>
            ) : sessions.length === 0 ? (
              <p className="pls-empty">没有匹配的会话。</p>
            ) : sessions.map(session => (
              <SessionRow
                key={`${session.provider}:${session.id}`}
                session={session}
                selected={selected?.provider === session.provider && selected?.id === session.id}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>

        <div className="pls-panel">
          {selected ? (
            <Transcript
              key={`${selected.provider}:${selected.id}`}
              provider={selected.provider}
              sessionId={selected.id}
              companyId={companyId}
            />
          ) : (
            <p className="pls-empty">从左侧选择一个会话查看完整对话记录。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function LocalSessionsSidebarLink(_props: PluginSidebarProps) {
  useScopedStyles();
  const hostNavigation = useHostNavigation();
  const location = useHostLocation();
  const href = hostNavigation.resolveHref(`/${PAGE_ROUTE}`);
  const isActive = location.pathname.replace(/\/+$/, "") === href.replace(/\/+$/, "");
  return (
    <a
      {...hostNavigation.linkProps(`/${PAGE_ROUTE}`)}
      aria-current={isActive ? "page" : undefined}
      className="pls-nav"
      title="本机会话"
    >
      <span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 4h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3V6a2 2 0 0 1 2-2Z" />
          <path d="M8 9h7" />
          <path d="M8 12.5h4.5" />
        </svg>
      </span>
      <span className="pls-nav-label">本机会话</span>
    </a>
  );
}
