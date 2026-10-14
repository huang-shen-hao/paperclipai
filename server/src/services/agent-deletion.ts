import { and, eq, or, sql } from "drizzle-orm";
import { agents, agentApiKeys, agentRuntimeState, agentTaskSessions, agentWakeupRequests, activityLog,
  budgetReservations, companyMemberships, costEvents, decisionRetention, environmentLeases,
  executionWorkspaceRepositoryAccess, heartbeatRunEvents, heartbeatRuns, issueExecutionDecisions,
  issueRecoveryActions, issues, issueComments, joinRequests, principalPermissionGrants,
  resourceLifecycleEvents, secretAccessEvents, workspaceOperations, type Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";

export async function deleteAgentDependencies(tx: Db, companyId: string, id: string) {
  const [decisionHold] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
    eq(budgetReservations.companyId, companyId), eq(budgetReservations.agentId, id),
    eq(budgetReservations.state, "held"), sql`${budgetReservations.decisionInvocationId} is not null`,
  )).limit(1);
  if (decisionHold) throw conflict("Wait for active decisions or resolve their unknown charges in Costs before deleting this agent", {
    code: "agent_decision_accounting_pending",
  });
  await issueThreadInteractionService(tx).cancelPendingForDeletedAddressee(companyId, id);
  await tx.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, id));
  await tx
    .update(issues)
    .set({ assigneeAgentId: null, createdByAgentId: null })
    .where(or(eq(issues.assigneeAgentId, id), eq(issues.createdByAgentId, id)));
  await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.agentId, id));
  await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.agentId, id));
  await tx.delete(activityLog).where(
    or(
      eq(activityLog.agentId, id),
      sql`${activityLog.runId} in (select ${heartbeatRuns.id} from ${heartbeatRuns} where ${heartbeatRuns.agentId} = ${id})`,
    ),
  );
  await tx.delete(issueExecutionDecisions).where(eq(issueExecutionDecisions.actorAgentId, id));
  await tx.delete(issueComments).where(eq(issueComments.authorAgentId, id));
  // Everything below references this agent, its runs, or both with a
  // `NO ACTION` foreign key, so it has to go (or be detached) before the runs
  // and the agent row can be removed. Leaving any of them out made purging an
  // agent that had ever run fail with a 500 foreign-key violation.
  const ownRuns = sql`(select ${heartbeatRuns.id} from ${heartbeatRuns} where ${heartbeatRuns.agentId} = ${id})`;
  await tx.delete(secretAccessEvents).where(
    or(eq(secretAccessEvents.actorId, id), sql`${secretAccessEvents.heartbeatRunId} in ${ownRuns}`),
  );
  await tx.delete(workspaceOperations).where(sql`${workspaceOperations.heartbeatRunId} in ${ownRuns}`);
  await tx.delete(environmentLeases).where(sql`${environmentLeases.heartbeatRunId} in ${ownRuns}`);
  await tx.delete(budgetReservations).where(eq(budgetReservations.agentId, id));
  await tx.delete(executionWorkspaceRepositoryAccess).where(eq(executionWorkspaceRepositoryAccess.agentId, id));
  await tx.delete(issueRecoveryActions).where(or(
    eq(issueRecoveryActions.ownerAgentId, id),
    eq(issueRecoveryActions.previousOwnerAgentId, id),
    eq(issueRecoveryActions.returnOwnerAgentId, id),
  ));
  await tx.update(decisionRetention)
    .set({ archivedByAgentId: null, archivedByRunId: null })
    .where(or(eq(decisionRetention.archivedByAgentId, id), sql`${decisionRetention.archivedByRunId} in ${ownRuns}`));
  await tx.delete(resourceLifecycleEvents).where(
    and(eq(resourceLifecycleEvents.companyId, companyId), eq(resourceLifecycleEvents.resourceId, id)),
  );
  await tx.delete(joinRequests).where(eq(joinRequests.createdAgentId, id));
  // `agent`-kind cost rows must keep their agent id — the usage-kind check
  // constraint requires it — so purging the agent removes them. Other kinds
  // (decisions, fast responses) survive with the run link detached.
  await tx.delete(costEvents).where(eq(costEvents.agentId, id));
  await tx.update(costEvents).set({ heartbeatRunId: null })
    .where(sql`${costEvents.heartbeatRunId} in ${ownRuns}`);
  await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.agentId, id));
  await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, id));
  await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
  await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.agentId, id));
  await tx.delete(companyMemberships).where(and(
    eq(companyMemberships.companyId, companyId),
    eq(companyMemberships.principalType, "agent"),
    eq(companyMemberships.principalId, id),
  ));
  await tx.delete(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.companyId, companyId),
    eq(principalPermissionGrants.principalType, "agent"),
    eq(principalPermissionGrants.principalId, id),
  ));
}
