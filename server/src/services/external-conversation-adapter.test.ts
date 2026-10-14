import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, companies, createDb, heartbeatRuns, issueRecoveryActions, issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { getExecutionBlocker } from "./execution-blocker.js";
import { isConversationAdapter } from "./conversation-continuation.js";

/**
 * A run that a graceful restart interrupted is deliberately not replayed: the
 * platform records "preserve without replay" and waits for a later user turn.
 * That escape hatch only exists when the recovery predicate can recognise the
 * run as conversation-backed, which it decides from the adapter type persisted
 * on the run.
 *
 * `qwenwork` is an external adapter plugin, so nothing about it is known to the
 * core adapter list by default. When it is missing, an interrupted run under it
 * becomes a hold nothing can retire: no Continue, no Retry, and every later
 * message saved forever.
 */

const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("external conversation adapters", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("external-conversation-adapter-");
    db = createDb(database.connectionString);
  }, 90_000);

  afterAll(async () => { await database?.cleanup(); });

  /**
   * Seed a task whose only run was cut off by a graceful shutdown, exactly the
   * state the server leaves behind after a rolling restart.
   */
  async function seedInterruptedRun(adapterType: string) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: `Adapter ${adapterType}`, defaultResponsibleUserId: "board",
      issuePrefix: `A${companyId.slice(0, 6).toUpperCase()}`,
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Employee", role: "engineer", adapterType, status: "idle",
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values({
      id: issueId, companyId, title: "Interrupted task", status: "in_progress", assigneeAgentId: agentId,
    });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, runtimeMode: "legacy", status: "interrupted",
      errorCode: "server_shutdown_interrupted", error: "Interrupted by graceful server shutdown (SIGTERM)",
      nativeIssueId: issueId, contextSnapshot: { issueId }, finishedAt: new Date("2026-10-14T06:35:02Z"),
      runnerProfileJson: { adapterDispatch: { adapterType } },
      resultJson: { stopReason: "interrupted", cancellation: {
        source: "shutdown", expected: true, initiator: { type: "system" },
        reason: "Server shutdown interrupted execution", recordedAt: "2026-10-14T06:35:02.028Z",
      } },
    });
    await db.insert(issueRecoveryActions).values({
      companyId, sourceIssueId: issueId, kind: "active_run_watchdog",
      cause: "legacy_execution_requires_reconciliation", fingerprint: runId,
      status: "resolved", outcome: "blocked", resolvedAt: new Date("2026-10-14T06:35:12Z"),
      nextAction: "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated.",
      evidence: { runId, automaticRecovery: { policy: "preserve_without_replay_v1", runId, replay: "blocked", actionOutcome: "unknown" } },
    });
    return { companyId, issueId, agentId, runId };
  }

  it("treats the external QwenWork adapter as conversation-backed", () => {
    expect(isConversationAdapter("qwenwork")).toBe(true);
  });

  it("retires the no-replay hold for an interrupted QwenWork run", async () => {
    const f = await seedInterruptedRun("qwenwork");
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
  });

  it("keeps the hold for an adapter that cannot resume a conversation", async () => {
    const f = await seedInterruptedRun("process");
    await expect(getExecutionBlocker(db, f.companyId, f.issueId)).resolves.toMatchObject({
      runId: f.runId,
      agentId: f.agentId,
      cause: "legacy_execution_requires_reconciliation",
    });
    // The negative control also proves the hold is decision-driven, not dropped
    // just because the run's recovery action was already marked resolved.
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, f.issueId));
    expect(action?.status).toBe("resolved");
  });
});
