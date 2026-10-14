import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { PROVIDERS, providerById, type ProviderDescriptor, type SessionSummary } from "./providers/index.js";

const PLUGIN_NAME = "local-sessions";

/** Listing every transcript is a directory walk; keep a short-lived cache. */
const SNAPSHOT_TTL_MS = 15_000;
const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_MAX_MESSAGES = 400;

type ResolvedConfig = {
  homeDir: string;
  maxSessions: number;
  maxMessages: number;
  hideEmptySessions: boolean;
};

type Snapshot = {
  cacheKey: string;
  homeDir: string;
  scannedAt: number;
  providers: ProviderDescriptor[];
  sessions: SessionSummary[];
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function resolveConfig(raw: Record<string, unknown>): ResolvedConfig {
  const configuredHome = typeof raw.homeDir === "string" ? raw.homeDir.trim() : "";
  const homeDir = configuredHome && path.isAbsolute(configuredHome) ? configuredHome : os.homedir();
  return {
    homeDir,
    maxSessions: clamp(raw.maxSessionsPerProvider, DEFAULT_MAX_SESSIONS, 1, 2000),
    maxMessages: clamp(raw.maxMessagesPerSession, DEFAULT_MAX_MESSAGES, 1, 5000),
    hideEmptySessions: raw.hideEmptySessions !== false,
  };
}

function matchesQuery(session: SessionSummary, query: string): boolean {
  const haystack = `${session.title}\n${session.id}\n${session.cwd ?? ""}\n${session.origin ?? ""}\n${session.model ?? ""}`;
  return haystack.toLowerCase().includes(query);
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup`);

    let cached: Snapshot | null = null;

    const loadSnapshot = async (companyId: string | null, force = false): Promise<Snapshot> => {
      const config = resolveConfig(await ctx.config.get(companyId ?? undefined));
      const cacheKey = `${config.homeDir}|${config.maxSessions}|${config.hideEmptySessions}`;
      if (!force && cached && cached.cacheKey === cacheKey && Date.now() - cached.scannedAt < SNAPSHOT_TTL_MS) {
        return cached;
      }
      const sessions: SessionSummary[] = [];
      const providers: ProviderDescriptor[] = [];
      for (const provider of PROVIDERS) {
        const store = provider.storePath(config.homeDir);
        if (!fs.existsSync(store)) {
          providers.push({
            id: provider.id,
            displayName: provider.displayName,
            storePath: store,
            available: false,
            reason: "store not found",
            count: 0,
          });
          continue;
        }
        let listed: SessionSummary[] = [];
        try {
          listed = await provider.list({
            homeDir: config.homeDir,
            maxSessions: config.maxSessions,
            hideEmptySessions: config.hideEmptySessions,
          });
        } catch (error) {
          providers.push({
            id: provider.id,
            displayName: provider.displayName,
            storePath: store,
            available: false,
            reason: error instanceof Error ? error.message : String(error),
            count: 0,
          });
          continue;
        }
        sessions.push(...listed);
        providers.push({
          id: provider.id,
          displayName: provider.displayName,
          storePath: store,
          available: true,
          count: listed.length,
        });
      }
      // A store can hold the same logical session more than once — Codex keeps a
      // copy under `sessions/` and another under `archived_sessions/`, and a
      // resumed run may open a second rollout file. Keep the freshest copy so
      // the list has one row per session.
      const byKey = new Map<string, SessionSummary>();
      for (const session of sessions) {
        const key = `${session.provider}:${session.id}`;
        const existing = byKey.get(key);
        if (!existing || (session.updatedAt ?? 0) > (existing.updatedAt ?? 0)) byKey.set(key, session);
      }
      const deduped = [...byKey.values()];
      deduped.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      for (const descriptor of providers) {
        if (descriptor.available) {
          descriptor.count = deduped.filter(session => session.provider === descriptor.id).length;
        }
      }
      cached = { cacheKey, homeDir: config.homeDir, scannedAt: Date.now(), providers, sessions: deduped };
      return cached;
    };

    ctx.data.register("snapshot", async params => {
      const companyId = typeof params.companyId === "string" ? params.companyId : null;
      const providerFilter = typeof params.provider === "string" && params.provider !== "all" ? params.provider : null;
      const query = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
      const limit = clamp(params.limit, 200, 1, 1000);
      const snapshot = await loadSnapshot(companyId);
      const sessions = snapshot.sessions
        .filter(session => !providerFilter || session.provider === providerFilter)
        .filter(session => !query || matchesQuery(session, query))
        .slice(0, limit);
      return {
        homeDir: snapshot.homeDir,
        scannedAt: snapshot.scannedAt,
        providers: snapshot.providers,
        total: snapshot.sessions.length,
        sessions,
      };
    });

    ctx.data.register("session", async params => {
      const providerId = typeof params.provider === "string" ? params.provider : "";
      const sessionId = typeof params.id === "string" ? params.id : "";
      const companyId = typeof params.companyId === "string" ? params.companyId : null;
      const provider = providerById(providerId);
      if (!provider || !sessionId) return { detail: null, error: "Unknown provider or session id" };
      const config = resolveConfig(await ctx.config.get(companyId ?? undefined));
      const detail = await provider.read(sessionId, { homeDir: config.homeDir, maxMessages: config.maxMessages });
      return detail ? { detail } : { detail: null, error: "Session not found" };
    });

    ctx.actions.register("refresh", async () => {
      cached = null;
      return { ok: true };
    });
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_NAME} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
