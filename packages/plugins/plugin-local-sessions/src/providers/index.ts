import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { hermesProvider } from "./hermes.js";
import { qoderProvider } from "./qoder.js";
import { SESSION_PROVIDER_IDS, type SessionProvider, type SessionProviderId } from "./types.js";

export const PROVIDERS: readonly SessionProvider[] = [
  qoderProvider,
  codexProvider,
  claudeProvider,
  hermesProvider,
];

const BY_ID = new Map<SessionProviderId, SessionProvider>(PROVIDERS.map(provider => [provider.id, provider]));

export function providerById(id: string): SessionProvider | null {
  return SESSION_PROVIDER_IDS.includes(id as SessionProviderId)
    ? BY_ID.get(id as SessionProviderId) ?? null
    : null;
}

export * from "./types.js";
