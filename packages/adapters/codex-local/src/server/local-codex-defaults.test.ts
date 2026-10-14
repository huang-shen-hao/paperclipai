import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalCodexDefaults } from "./local-codex-defaults.js";

const tmpDirs: string[] = [];

function makeConfig(content: string, extraFiles: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-codex-defaults-"));
  tmpDirs.push(dir);
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(configPath, content);
  for (const [name, body] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return configPath;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readLocalCodexDefaults", () => {
  it("reads model, provider endpoint and bearer token from the host config", () => {
    const configPath = makeConfig(`
model = "deepseek-v4-pro"
model_provider = "deepseek"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://relay.example.com/v1"
wire_api = "responses"
experimental_bearer_token = "sk-test-token"
`);
    const defaults = readLocalCodexDefaults({ PAPERCLIP_CODEX_LOCAL_CONFIG: configPath } as NodeJS.ProcessEnv);
    expect(defaults).toMatchObject({
      model: "deepseek-v4-pro",
      providerId: "deepseek",
      baseUrl: "https://relay.example.com/v1",
      bearerToken: "sk-test-token",
      wireApi: "responses",
    });
  });

  it("resolves an env_key provider from a sibling .env file", () => {
    const configPath = makeConfig(
      `
model = "deepseek-v4-flash"
model_provider = "relay"

[model_providers.relay]
base_url = "https://relay.example.com/v1"
env_key = "RELAY_API_KEY"
`,
      { ".env": "RELAY_API_KEY=sk-from-dotenv\n" },
    );
    const defaults = readLocalCodexDefaults({ PAPERCLIP_CODEX_LOCAL_CONFIG: configPath } as NodeJS.ProcessEnv);
    expect(defaults?.bearerToken).toBe("sk-from-dotenv");
    expect(defaults?.model).toBe("deepseek-v4-flash");
  });

  it("prefers a token passed in the process env over the .env file", () => {
    const configPath = makeConfig(
      `
model = "m"
model_provider = "relay"

[model_providers.relay]
base_url = "https://relay.example.com/v1"
env_key = "RELAY_API_KEY"
`,
      { ".env": "RELAY_API_KEY=sk-from-dotenv\n" },
    );
    const defaults = readLocalCodexDefaults({
      PAPERCLIP_CODEX_LOCAL_CONFIG: configPath,
      RELAY_API_KEY: "sk-from-env",
    } as NodeJS.ProcessEnv);
    expect(defaults?.bearerToken).toBe("sk-from-env");
  });

  it("returns null when disabled, missing, or holding neither model nor endpoint", () => {
    const configPath = makeConfig(`model = "only-a-model"\n`);
    expect(
      readLocalCodexDefaults({
        PAPERCLIP_CODEX_LOCAL_CONFIG: configPath,
        PAPERCLIP_CODEX_LOCAL_DEFAULTS: "0",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readLocalCodexDefaults({ PAPERCLIP_CODEX_LOCAL_CONFIG: path.join(os.tmpdir(), "nope.toml") } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(readLocalCodexDefaults({ PAPERCLIP_CODEX_LOCAL_CONFIG: configPath } as NodeJS.ProcessEnv)?.baseUrl).toBeNull();
  });
});
