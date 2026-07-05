import type {
  MissionCheckpoint,
  MissionOutput,
  MissionPipeline,
  MissionSnapshot,
  MissionSpecContract,
  MissionSpecSummary,
  MissionStageSummary,
  MissionWorkspaceSection,
  SessionMessageRecord,
  SessionRecord,
  WorkspaceArtifactSurface,
} from "./types.js";
import { isPlainObject } from "./utils.js";

export const MISSION_WORKSPACE_CONTRACT_VERSION = 1;

type PlanOptionValue = "primary" | "alternative";

type MissionPlanContext = {
  latestPlanningMessage: SessionMessageRecord | null;
  confirmedPlanningMessage: SessionMessageRecord | null;
  activePlanningMessage: SessionMessageRecord | null;
  activePlanOption: PlanOptionValue | null;
  activePlanContent: Record<string, unknown> | null;
  latestPlanRevision: number | null;
  sourceRevision: number | null;
  sourceOption: PlanOptionValue | null;
};

export type MissionWorkspaceProjection = {
  missionSpec: MissionSpecSummary;
  missionSpecContract: MissionSpecContract;
  missionSnapshot: MissionSnapshot;
};

function alternativePlanExists(message: SessionMessageRecord): boolean {
  return message.kind === "plan_options_card" && isPlainObject(message.content.alternative);
}

function isExecutionAnchoredSessionStatus(status: SessionRecord["status"]): boolean {
  return ["running", "waiting_human", "completed", "failed", "cancelled"].includes(status);
}

function resolvePlanningMessageOption(
  message: SessionMessageRecord | null,
  fallbackOption?: PlanOptionValue | null,
): PlanOptionValue | null {
  if (!message) {
    return null;
  }
  if (message.kind === "plan_options_card") {
    if (message.content.selected_option === "alternative") {
      return "alternative";
    }
    if (fallbackOption === "alternative" && isPlainObject(message.content.alternative)) {
      return "alternative";
    }
    return "primary";
  }
  if (message.kind === "plan_card") {
    return "primary";
  }
  return null;
}

function isPlanOptionValue(value: unknown): value is PlanOptionValue {
  return value === "primary" || value === "alternative";
}

function extractPlanningOptionContent(
  message: SessionMessageRecord | null,
  option: PlanOptionValue | null,
): Record<string, unknown> | null {
  if (!message || !option) {
    return null;
  }
  if (message.kind === "plan_options_card") {
    const content = option === "alternative" ? message.content.alternative : message.content.primary;
    return isPlainObject(content) ? content : null;
  }
  if (message.kind === "plan_card" && option === "primary") {
    return message.content;
  }
  return null;
}

function isMetaDraftChoiceQuestion(question: string): boolean {
  return /draft a DAG first|go straight to full plan options/i.test(question);
}

function getConversationMessageText(message: SessionMessageRecord | null): string | null {
  if (!message) {
    return null;
  }

  if (message.kind === "orchestrator_turn") {
    if (typeof message.content.narrative_reply === "string" && message.content.narrative_reply.trim()) {
      return message.content.narrative_reply.trim();
    }
    if (typeof message.content.summary === "string" && message.content.summary.trim()) {
      return message.content.summary.trim();
    }
  }

  if (message.kind === "text" && typeof message.content.text === "string" && message.content.text.trim()) {
    return message.content.text.trim();
  }

  return null;
}

function isConversationTextMessage(message: SessionMessageRecord): boolean {
  return (
    message.kind === "text" ||
    message.kind === "system" ||
    message.kind === "orchestrator_turn"
  );
}

function getThreadTaskBriefFromMessages(
  session: SessionRecord,
  messages: SessionMessageRecord[],
): string | null {
  const firstUserText =
    messages.find((message) => message.role === "user" && message.kind === "text") || null;
  const firstUserValue =
    firstUserText && typeof firstUserText.content.text === "string" && firstUserText.content.text.trim()
      ? firstUserText.content.text.trim()
      : null;
  const metadata = isPlainObject(session.metadata) ? session.metadata : {};
  const workingGoal =
    typeof metadata.working_goal === "string" && metadata.working_goal.trim()
      ? metadata.working_goal.trim()
      : null;
  return workingGoal || firstUserValue || session.current_goal || null;
}

function getRunTone(status: string | null | undefined): "neutral" | "warn" | "success" | "danger" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  if (status === "waiting_human" || status === "paused" || status === "blocked") {
    return "warn";
  }
  if (status === "queued" || status === "running") {
    return "success";
  }
  return "neutral";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function slugKey(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPlanOption(value: unknown): PlanOptionValue | null {
  return isPlanOptionValue(value) ? value : null;
}

function getSessionMetadataObject(session: SessionRecord): Record<string, unknown> {
  return isPlainObject(session.metadata) ? session.metadata : {};
}

function getMetadataObject(
  session: SessionRecord,
  key: string,
): Record<string, unknown> | null {
  const metadata = getSessionMetadataObject(session);
  return isPlainObject(metadata[key]) ? metadata[key] : null;
}

function getPersistedRequestedOutputs(session: SessionRecord): string[] {
  const metadata = getSessionMetadataObject(session);
  return Array.isArray(metadata.mission_requested_outputs)
    ? uniqueStrings(
        metadata.mission_requested_outputs.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        ),
      )
    : [];
}

function getPersistedRouteState(session: SessionRecord): Record<string, unknown> | null {
  return getMetadataObject(session, "mission_route_state");
}

function getPersistedRevisionLineage(session: SessionRecord): Record<string, unknown> | null {
  return getMetadataObject(session, "mission_revision_lineage");
}

function getMissionPlanContext(
  session: SessionRecord,
  messages: SessionMessageRecord[],
): MissionPlanContext {
  const latestPlanningMessage =
    [...messages]
      .reverse()
      .find((message) => message.kind === "plan_options_card" || message.kind === "plan_card") || null;
  const confirmedPlanningMessage =
    typeof session.confirmed_plan_revision === "number"
      ? [...messages]
          .reverse()
          .find(
            (message) =>
              (message.kind === "plan_options_card" || message.kind === "plan_card") &&
              typeof message.content.revision === "number" &&
              message.content.revision === session.confirmed_plan_revision,
          ) || null
      : null;
  const activePlanningMessage = isExecutionAnchoredSessionStatus(session.status)
    ? confirmedPlanningMessage || latestPlanningMessage
    : latestPlanningMessage || confirmedPlanningMessage;
  const activePlanOption =
    activePlanningMessage === confirmedPlanningMessage && session.confirmed_plan_option
      ? session.confirmed_plan_option
      : resolvePlanningMessageOption(activePlanningMessage, session.confirmed_plan_option);
  const activePlanContent = extractPlanningOptionContent(activePlanningMessage, activePlanOption);
  const latestPlanRevision =
    latestPlanningMessage && typeof latestPlanningMessage.content.revision === "number"
      ? latestPlanningMessage.content.revision
      : null;
  const sourceRevision =
    latestPlanningMessage && typeof latestPlanningMessage.content.source_revision === "number"
      ? latestPlanningMessage.content.source_revision
      : null;
  const sourceOption = isPlanOptionValue(latestPlanningMessage?.content.source_option)
    ? latestPlanningMessage.content.source_option
    : null;

  return {
    latestPlanningMessage,
    confirmedPlanningMessage,
    activePlanningMessage,
    activePlanOption,
    activePlanContent,
    latestPlanRevision,
    sourceRevision,
    sourceOption,
  };
}

function buildMissionPipelineSummary(pipelines: MissionPipeline[]) {
  return {
    total: pipelines.length,
    ready: pipelines.filter((pipeline) => pipeline.readyCount > 0).length,
    active: pipelines.filter((pipeline) => pipeline.status === "active").length,
    blocked: pipelines.filter((pipeline) => pipeline.status === "blocked").length,
    completed: pipelines.filter((pipeline) => pipeline.status === "done").length,
    primaryAgentLabels: uniqueStrings(pipelines.map((pipeline) => pipeline.primaryAgentLabel)),
  };
}

function buildMissionCheckpointSummary(checkpoints: MissionCheckpoint[]) {
  return {
    total: checkpoints.length,
    completed: checkpoints.filter((checkpoint) => checkpoint.status === "done").length,
    active: checkpoints.filter((checkpoint) => checkpoint.status === "active").length,
    pending: checkpoints.filter((checkpoint) => checkpoint.status === "pending").length,
    labels: checkpoints.map((checkpoint) => checkpoint.label),
  };
}

function buildMissionPipelinesFromSession(
  session: SessionRecord,
  messages: SessionMessageRecord[],
): MissionPipeline[] {
  const planContext = getMissionPlanContext(session, messages);
  if (!planContext.activePlanContent) {
    return [];
  }

  const candidatePlan = isPlainObject(planContext.activePlanContent.candidate_plan)
    ? planContext.activePlanContent.candidate_plan
    : null;
  const compiledNodes = Array.isArray(candidatePlan?.compiled_nodes)
    ? candidatePlan.compiled_nodes.filter((node): node is Record<string, unknown> => isPlainObject(node))
    : [];

  return compiledNodes.map((node, index) => {
    const nodeStatus =
      typeof node.status === "string" && node.status.trim()
        ? node.status.trim()
        : null;
    const title =
      typeof node.name === "string" && node.name.trim()
        ? node.name.trim()
        : typeof node.node_id === "string" && node.node_id.trim()
          ? node.node_id.trim()
          : `Pipeline ${index + 1}`;
    const allowedSkills = Array.isArray(node.allowed_skills)
      ? node.allowed_skills.filter((item): item is string => typeof item === "string" && !!item.trim())
      : [];
    const expectedArtifacts =
      isPlainObject(node.output_contract) && Array.isArray(node.output_contract.expected_artifacts)
        ? node.output_contract.expected_artifacts.filter(
            (item): item is string => typeof item === "string" && !!item.trim(),
          )
        : [];
    const status: MissionPipeline["status"] =
      nodeStatus === "completed" || nodeStatus === "skipped"
        ? "done"
        : nodeStatus === "running" || nodeStatus === "ready"
          ? "active"
          : nodeStatus === "waiting_human" ||
              nodeStatus === "failed" ||
              nodeStatus === "cancelled" ||
              nodeStatus === "blocked"
            ? "blocked"
            : index === 0
              ? "active"
              : "pending";
    const tone: MissionPipeline["tone"] =
      nodeStatus === "failed" || nodeStatus === "cancelled"
        ? "danger"
        : status === "blocked"
          ? "warn"
          : status === "done" || status === "active"
            ? "success"
            : "neutral";
    return {
      key:
        typeof node.node_id === "string" && node.node_id.trim()
          ? node.node_id.trim()
          : `pipeline_${index + 1}`,
      title,
      summary:
        allowedSkills.length > 0
          ? `This work package is bound to ${allowedSkills.join(", ")}.`
          : "This work package is compiled and ready for orchestration.",
      status,
      tone,
      nodeCount: 1,
      readyCount: nodeStatus === "ready" ? 1 : 0,
      primaryAgentLabel:
        typeof node.agent_profile === "string" && node.agent_profile.trim()
          ? node.agent_profile.trim()
          : null,
      artifactExpectation: expectedArtifacts.length > 0 ? expectedArtifacts.slice(0, 2).join(", ") : null,
      blocker:
        nodeStatus === "waiting_human"
          ? "This pipeline is waiting on human input or approval."
          : nodeStatus === "failed" || nodeStatus === "cancelled" || nodeStatus === "blocked"
            ? "This pipeline needs intervention before it can continue."
            : null,
      activeNodeName: status === "active" || status === "blocked" ? title : null,
    };
  });
}

function buildMissionCheckpointsFromSession(
  session: SessionRecord,
  messages: SessionMessageRecord[],
  workspaceState: Record<string, unknown>,
): MissionCheckpoint[] {
  const latestDraftMessage =
    [...messages].reverse().find((message) => message.kind === "draft_card") || null;
  const latestPlanMessage =
    [...messages]
      .reverse()
      .find((message) => message.kind === "plan_options_card" || message.kind === "plan_card") || null;
  const latestRunMessage =
    [...messages].reverse().find((message) => message.kind === "run_card") || null;
  const latestSummaryMessage =
    [...messages].reverse().find((message) => message.kind === "summary_card") || null;
  const approvalCount = messages.filter((message) => message.kind === "approval_card").length;
  const humanInputCount = messages.filter((message) => message.kind === "human_input_card").length;
  const interventionCount = messages.filter((message) => message.kind === "intervention_card").length;
  const dagPatchCount = messages.filter((message) => message.kind === "dag_patch_card").length;
  const artifactCount = messages.filter((message) => message.kind === "artifact_card").length;

  const checkpoints: MissionCheckpoint[] = [
    {
      key: "brief-captured",
      label: "Mission brief",
      detail:
        typeof workspaceState.working_goal === "string" && workspaceState.working_goal.trim()
          ? String(workspaceState.working_goal).trim()
          : "Mission brief has not been stabilized yet.",
      tone:
        typeof workspaceState.working_goal === "string" && workspaceState.working_goal.trim()
          ? "success"
          : "neutral",
      status:
        typeof workspaceState.working_goal === "string" && workspaceState.working_goal.trim()
          ? "done"
          : "active",
    },
    {
      key: "draft-shaped",
      label: "Workflow draft",
      detail: latestDraftMessage
        ? "A draft workflow shape exists and can be promoted into full route options."
        : "No DAG draft has been shaped yet.",
      tone: latestDraftMessage ? "warn" : "neutral",
      status: latestDraftMessage ? "done" : "pending",
    },
    {
      key: "route-compiled",
      label: "Route comparison",
      detail:
        latestPlanMessage && typeof latestPlanMessage.content.revision === "number"
          ? `Revision v${latestPlanMessage.content.revision} is available in the workspace.`
          : "Comparable routes are not compiled yet.",
      tone: latestPlanMessage ? "warn" : "neutral",
      status: latestPlanMessage ? "done" : "pending",
    },
    {
      key: "launch-gate",
      label: "Launch gate",
      detail:
        typeof session.confirmed_plan_revision === "number"
          ? `Execution is anchored to route v${session.confirmed_plan_revision} / ${session.confirmed_plan_option || "primary"}.`
          : "No route has been confirmed for execution yet.",
      tone: typeof session.confirmed_plan_revision === "number" ? "success" : "warn",
      status:
        typeof session.confirmed_plan_revision === "number"
          ? "done"
          : latestPlanMessage
            ? "active"
            : "pending",
    },
    {
      key: "runtime-state",
      label: "Runtime",
      detail:
        latestRunMessage
          ? latestSummaryMessage &&
            typeof latestSummaryMessage.content.current_summary === "string" &&
            latestSummaryMessage.content.current_summary.trim()
            ? latestSummaryMessage.content.current_summary.trim()
            : typeof workspaceState.latest_run_summary === "string" &&
                workspaceState.latest_run_summary.trim()
              ? String(workspaceState.latest_run_summary).trim()
              : "A real run is in flight and projecting state back."
          : "No real run has been opened yet.",
      tone:
        latestRunMessage && typeof latestRunMessage.content.status === "string"
          ? getRunTone(latestRunMessage.content.status)
          : "neutral",
      status: latestRunMessage ? "active" : "pending",
    },
  ];

  if (approvalCount > 0 || humanInputCount > 0) {
    checkpoints.push({
      key: "human-gates",
      label: "Human gates",
      detail:
        approvalCount > 0
          ? `${approvalCount} approval gate(s) are waiting on review.`
          : `${humanInputCount} structured input request(s) are blocking the next step.`,
      tone: "warn",
      status: "active",
    });
  }

  if (artifactCount > 0) {
    checkpoints.push({
      key: "outputs-returned",
      label: "Outputs returned",
      detail: `${artifactCount} artifact(s) have been projected back into the mission record.`,
      tone: "success",
      status: session.status === "completed" ? "done" : "active",
    });
  }

  if (interventionCount > 0 || dagPatchCount > 0) {
    checkpoints.push({
      key: "runtime-steering",
      label: "Runtime steering",
      detail:
        dagPatchCount > 0
          ? `${dagPatchCount} runtime patch proposal(s) are attached to the mission for review or replay.`
          : `${interventionCount} runtime intervention record(s) are attached to the mission.`,
      tone: dagPatchCount > 0 ? "warn" : "neutral",
      status: "active",
    });
  }

  return checkpoints;
}

function buildWorkspaceArtifactSurfacesFromSession(
  messages: SessionMessageRecord[],
): WorkspaceArtifactSurface[] {
  const draftCount = messages.filter((message) => message.kind === "draft_card").length;
  const planCount = messages.filter(
    (message) => message.kind === "plan_card" || message.kind === "plan_options_card",
  ).length;
  const runCount = messages.filter((message) => message.kind === "run_card").length;
  const artifactCount = messages.filter((message) => message.kind === "artifact_card").length;
  const approvalCount = messages.filter((message) => message.kind === "approval_card").length;
  const inputCount = messages.filter((message) => message.kind === "human_input_card").length;
  const interventionCount = messages.filter((message) => message.kind === "intervention_card").length;
  const dagPatchCount = messages.filter((message) => message.kind === "dag_patch_card").length;

  const surfaces: WorkspaceArtifactSurface[] = [];
  if (draftCount > 0) {
    surfaces.push({
      key: "drafts",
      title: "Draft workflow shapes",
      summary: `${draftCount} draft artifact(s) are available for promotion into routes.`,
      tone: "warn",
      chips: ["draft"],
      detailLines: ["Draft outputs stay visible as workspace evidence until a route is confirmed."],
    });
  }
  if (planCount > 0) {
    surfaces.push({
      key: "routes",
      title: "Route options",
      summary: `${planCount} route artifact(s) are preserved as planning evidence.`,
      tone: "warn",
      chips: ["route", "compare"],
      detailLines: ["Compiled route options remain auditable even after the mission moves into runtime."],
    });
  }
  if (runCount > 0 || artifactCount > 0) {
    surfaces.push({
      key: "runtime",
      title: "Runtime outputs",
      summary:
        artifactCount > 0
          ? `${artifactCount} returned artifact(s) are attached to the mission.`
          : `${runCount} run artifact(s) are attached to the mission.`,
      tone: "success",
      chips: ["run", "output"],
      detailLines: ["Runtime summaries and returned artifacts stay attached to the mission record."],
    });
  }
  if (approvalCount > 0 || inputCount > 0) {
    surfaces.push({
      key: "human-gates",
      title: "Human checkpoints",
      summary:
        approvalCount > 0
          ? `${approvalCount} approval gate(s) need review.`
          : `${inputCount} structured input request(s) need response.`,
      tone: "warn",
      chips: ["approval", "input"],
      detailLines: ["Human checkpoints remain first-class artifacts in the mission workspace."],
    });
  }
  if (interventionCount > 0 || dagPatchCount > 0) {
    surfaces.push({
      key: "runtime-steering",
      title: "Runtime steering record",
      summary:
        dagPatchCount > 0
          ? `${dagPatchCount} patch proposal(s) and ${interventionCount} intervention record(s) are preserved in the mission workspace.`
          : `${interventionCount} runtime intervention record(s) are preserved in the mission workspace.`,
      tone: dagPatchCount > 0 ? "warn" : "neutral",
      chips: ["intervention", dagPatchCount > 0 ? "patch" : null].filter(
        (item): item is string => !!item,
      ),
      detailLines: [
        "Runtime steering stays attached to the mission as first-class audit evidence.",
      ],
    });
  }

  return surfaces;
}

function getMissionOutputTone(status: MissionOutput["status"]): MissionOutput["tone"] {
  if (status === "returned") {
    return "success";
  }
  if (status === "prepared" || status === "in_progress") {
    return "warn";
  }
  return "neutral";
}

function buildMissionOutputsFromSession(input: {
  requestedOutputs: string[];
  pipelines: MissionPipeline[];
  messages: SessionMessageRecord[];
  workspaceState: Record<string, unknown>;
  session: SessionRecord;
}): MissionOutput[] {
  const outputs = new Map<string, MissionOutput>();
  const statusRank: Record<MissionOutput["status"], number> = {
    requested: 1,
    prepared: 2,
    in_progress: 3,
    returned: 4,
  };

  function upsert(inputOutput: MissionOutput) {
    const existing = outputs.get(inputOutput.key);
    if (!existing) {
      outputs.set(inputOutput.key, inputOutput);
      return;
    }
    const status =
      statusRank[inputOutput.status] > statusRank[existing.status]
        ? inputOutput.status
        : existing.status;
    outputs.set(inputOutput.key, {
      ...existing,
      title: inputOutput.title || existing.title,
      summary: statusRank[inputOutput.status] >= statusRank[existing.status]
        ? inputOutput.summary
        : existing.summary,
      status,
      tone: getMissionOutputTone(status),
      source: statusRank[inputOutput.status] >= statusRank[existing.status]
        ? inputOutput.source
        : existing.source,
      pipelineKeys: uniqueStrings([...existing.pipelineKeys, ...inputOutput.pipelineKeys]),
      artifactMessageIds: uniqueStrings([
        ...existing.artifactMessageIds,
        ...inputOutput.artifactMessageIds,
      ]),
      detailLines: uniqueStrings([...existing.detailLines, ...inputOutput.detailLines]),
    });
  }

  for (const output of input.requestedOutputs) {
    const key = slugKey(output, "requested-output");
    upsert({
      key,
      title: output,
      summary: "Requested by the mission contract.",
      status: "requested",
      tone: "neutral",
      source: "mission_spec",
      pipelineKeys: [],
      artifactMessageIds: [],
      detailLines: ["Tracked from MissionSpec requested outputs."],
    });
  }

  for (const pipeline of input.pipelines) {
    const expectedOutputs = pipeline.artifactExpectation
      ? pipeline.artifactExpectation
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    for (const output of expectedOutputs) {
      const key = slugKey(output, pipeline.key);
      upsert({
        key,
        title: output,
        summary: `${pipeline.title} is prepared to produce this output.`,
        status: pipeline.status === "done" ? "in_progress" : "prepared",
        tone: pipeline.status === "done" ? "warn" : "warn",
        source: "pipeline",
        pipelineKeys: [pipeline.key],
        artifactMessageIds: [],
        detailLines: [
          `Prepared by ${pipeline.title}.`,
          pipeline.primaryAgentLabel ? `Lead agent: ${pipeline.primaryAgentLabel}` : null,
        ].filter((item): item is string => !!item),
      });
    }
  }

  const artifactMessages = input.messages.filter((message) => message.kind === "artifact_card");
  for (const message of artifactMessages) {
    const artifactName =
      (typeof message.content.name === "string" && message.content.name.trim()
        ? message.content.name.trim()
        : null) ||
      (typeof message.content.artifact_id === "string" && message.content.artifact_id.trim()
        ? message.content.artifact_id.trim()
        : null) ||
      "Returned artifact";
    const storageUri =
      typeof message.content.storage_uri === "string" && message.content.storage_uri.trim()
        ? message.content.storage_uri.trim()
        : null;
    const mimeType =
      typeof message.content.mime_type === "string" && message.content.mime_type.trim()
        ? message.content.mime_type.trim()
        : null;
    upsert({
      key: slugKey(artifactName, message.message_id),
      title: artifactName,
      summary: "Returned by runtime and attached to the mission record.",
      status: "returned",
      tone: "success",
      source: "artifact",
      pipelineKeys: [],
      artifactMessageIds: [message.message_id],
      detailLines: [
        storageUri ? `Storage: ${storageUri}` : null,
        mimeType ? `Type: ${mimeType}` : null,
      ].filter((item): item is string => !!item),
    });
  }

  const latestSummaryMessage =
    [...input.messages].reverse().find((message) => message.kind === "summary_card") || null;
  const latestRunMessage =
    [...input.messages].reverse().find((message) => message.kind === "run_card") || null;
  const hasRuntimeSignal =
    !!latestRunMessage ||
    !!latestSummaryMessage ||
    !!input.session.latest_run_id ||
    ["running", "waiting_human", "completed", "failed", "cancelled"].includes(input.session.status);
  const runStatus =
    (typeof input.workspaceState.run_status === "string" && input.workspaceState.run_status.trim()
      ? input.workspaceState.run_status.trim()
      : null) ||
    (typeof latestSummaryMessage?.content.status === "string" && latestSummaryMessage.content.status.trim()
      ? latestSummaryMessage.content.status.trim()
      : null) ||
    (typeof latestRunMessage?.content.status === "string" && latestRunMessage.content.status.trim()
      ? latestRunMessage.content.status.trim()
      : null) ||
    input.session.status;
  const runSummary =
    (typeof input.workspaceState.latest_run_summary === "string" &&
    input.workspaceState.latest_run_summary.trim()
      ? input.workspaceState.latest_run_summary.trim()
      : null) ||
    (typeof latestSummaryMessage?.content.current_summary === "string" &&
    latestSummaryMessage.content.current_summary.trim()
      ? latestSummaryMessage.content.current_summary.trim()
      : null);
  if (hasRuntimeSignal && outputs.size === 0) {
    const status: MissionOutput["status"] = runStatus === "completed" ? "returned" : "in_progress";
    upsert({
      key: "runtime-handoff",
      title: "Runtime handoff",
      summary: runSummary || "Runtime state is being projected back into the mission.",
      status,
      tone: getMissionOutputTone(status),
      source: "runtime",
      pipelineKeys: [],
      artifactMessageIds: [],
      detailLines: [
        input.session.latest_run_id ? `Run: ${input.session.latest_run_id}` : null,
        runStatus ? `Status: ${runStatus}` : null,
      ].filter((item): item is string => !!item),
    });
  }

  if (hasRuntimeSignal && runStatus && runStatus !== "completed") {
    for (const output of outputs.values()) {
      if (output.status !== "requested" && output.status !== "returned") {
        output.status = "in_progress";
        output.tone = getMissionOutputTone(output.status);
        output.source = output.source === "artifact" ? output.source : "runtime";
        output.summary = runSummary || output.summary;
      }
    }
  }

  return [...outputs.values()];
}

function buildMissionWorkspaceSectionsFromSession(input: {
  missionSpec: MissionSpecSummary;
  pipelines: MissionPipeline[];
  checkpoints: MissionCheckpoint[];
  outputs: MissionOutput[];
  workspaceState: Record<string, unknown>;
  session: SessionRecord;
  messages: SessionMessageRecord[];
}): MissionWorkspaceSection[] {
  const returnedOutputCount = input.outputs.filter((output) => output.status === "returned").length;
  const preparedOutputCount = input.outputs.filter(
    (output) => output.status === "prepared" || output.status === "in_progress",
  ).length;
  const blockedPipelineCount = input.pipelines.filter((pipeline) => pipeline.status === "blocked").length;
  const activeCheckpointCount = input.checkpoints.filter((checkpoint) => checkpoint.status === "active").length;
  const activeRunId =
    (typeof input.workspaceState.latest_run_id === "string" && input.workspaceState.latest_run_id.trim()
      ? input.workspaceState.latest_run_id.trim()
      : null) ||
    input.session.latest_run_id;
  const runStatus =
    (typeof input.workspaceState.run_status === "string" && input.workspaceState.run_status.trim()
      ? input.workspaceState.run_status.trim()
      : null) ||
    input.session.status;

  return [
    {
      key: "brief",
      label: "Brief",
      title: input.missionSpec.objective || "Mission brief",
      summary:
        input.missionSpec.sourceBrief ||
        input.missionSpec.decisionFocus ||
        "Mission context is still being shaped.",
      tone: input.missionSpec.objective ? "success" : "neutral",
      status: input.missionSpec.objective ? "done" : "active",
      itemCount: input.missionSpec.constraints.length + input.missionSpec.openQuestions.length,
      detailLines: [
        input.missionSpec.constraints.length > 0
          ? `Constraints: ${input.missionSpec.constraints.join(" / ")}`
          : "No explicit constraints yet.",
        input.missionSpec.openQuestions.length > 0
          ? `${input.missionSpec.openQuestions.length} open question(s).`
          : "No open questions are blocking the brief.",
      ],
    },
    {
      key: "work",
      label: "Work",
      title:
        input.pipelines.length > 0
          ? `${input.pipelines.length} work package${input.pipelines.length === 1 ? "" : "s"} materialized`
          : "Work packages not materialized",
      summary:
        blockedPipelineCount > 0
          ? `${blockedPipelineCount} work package(s) need attention before execution can continue.`
          : input.pipelines[0]?.summary ||
            "Compiled work packages will appear here once a route exists.",
      tone: blockedPipelineCount > 0 ? "warn" : input.pipelines.length > 0 ? "success" : "neutral",
      status:
        blockedPipelineCount > 0
          ? "blocked"
          : input.pipelines.some((pipeline) => pipeline.status === "active")
            ? "active"
            : input.pipelines.length > 0
              ? "done"
              : "pending",
      itemCount: input.pipelines.length,
      detailLines: [
        `${input.pipelines.filter((pipeline) => pipeline.status === "active").length} active.`,
        `${input.pipelines.filter((pipeline) => pipeline.status === "done").length} complete.`,
        `${preparedOutputCount} output target(s) prepared by work packages.`,
      ],
    },
    {
      key: "checkpoints",
      label: "Checkpoints",
      title: `${input.missionSpec.checkpointSummary.completed}/${input.missionSpec.checkpointSummary.total} checkpoints complete`,
      summary:
        activeCheckpointCount > 0
          ? `${activeCheckpointCount} checkpoint(s) are currently active.`
          : "Mission checkpoints are waiting for the next orchestration step.",
      tone: activeCheckpointCount > 0 ? "warn" : input.checkpoints.length > 0 ? "success" : "neutral",
      status:
        activeCheckpointCount > 0
          ? "active"
          : input.checkpoints.length > 0 &&
              input.missionSpec.checkpointSummary.completed === input.missionSpec.checkpointSummary.total
            ? "done"
            : "pending",
      itemCount: input.checkpoints.length,
      detailLines: input.checkpoints.slice(0, 4).map((checkpoint) => checkpoint.label),
    },
    {
      key: "outputs",
      label: "Outputs",
      title:
        input.outputs.length > 0
          ? `${input.outputs.length} mission output${input.outputs.length === 1 ? "" : "s"} tracked`
          : "Outputs not defined",
      summary:
        returnedOutputCount > 0
          ? `${returnedOutputCount} output(s) have returned to the mission.`
          : preparedOutputCount > 0
            ? `${preparedOutputCount} output target(s) are prepared or in progress.`
            : "Requested outputs will appear here after the mission is routed.",
      tone: returnedOutputCount > 0 ? "success" : preparedOutputCount > 0 ? "warn" : "neutral",
      status: returnedOutputCount > 0 ? "done" : preparedOutputCount > 0 ? "active" : "pending",
      itemCount: input.outputs.length,
      detailLines: input.outputs.slice(0, 4).map((output) => `${output.title}: ${output.status}`),
    },
    {
      key: "runtime",
      label: "Runtime",
      title: activeRunId ? `Run ${activeRunId}` : "Runtime not launched",
      summary:
        (typeof input.workspaceState.latest_run_summary === "string" &&
        input.workspaceState.latest_run_summary.trim()
          ? input.workspaceState.latest_run_summary.trim()
          : null) ||
        "Runtime state will become active after launch.",
      tone: getRunTone(runStatus),
      status:
        input.session.status === "failed" || input.session.status === "cancelled"
          ? "blocked"
          : activeRunId
            ? input.session.status === "completed"
              ? "done"
              : "active"
            : "pending",
      itemCount: activeRunId ? 1 : 0,
      detailLines: [
        runStatus ? `Status: ${runStatus}` : "No runtime status yet.",
        activeRunId ? `Run id: ${activeRunId}` : "No active run id.",
      ],
    },
  ];
}

function buildMissionSpecSummaryFromSession(
  session: SessionRecord,
  messages: SessionMessageRecord[],
  workspaceState: Record<string, unknown>,
  pipelines: MissionPipeline[],
  checkpoints: MissionCheckpoint[],
): MissionSpecSummary {
  const latestGoalUpdate =
    [...messages].reverse().find((message) => message.kind === "goal_update_card") || null;
  const latestDecision =
    [...messages].reverse().find((message) => message.kind === "decision_card") || null;
  const planContext = getMissionPlanContext(session, messages);
  const activePlanContent = planContext.activePlanContent;
  const candidatePlan = isPlainObject(activePlanContent?.candidate_plan)
    ? activePlanContent.candidate_plan
    : null;
  const compiledNodes = Array.isArray(candidatePlan?.compiled_nodes)
    ? candidatePlan.compiled_nodes.filter((node): node is Record<string, unknown> => isPlainObject(node))
    : [];

  const requestedOutputs = uniqueStrings(
    compiledNodes.flatMap((node) => {
      const outputContract = isPlainObject(node.output_contract) ? node.output_contract : null;
      const expectedArtifacts = Array.isArray(outputContract?.expected_artifacts)
        ? outputContract.expected_artifacts
        : [];
      return expectedArtifacts.filter(
        (item): item is string => typeof item === "string" && !!item.trim(),
      );
    }),
  );
  const persistedRouteState = getPersistedRouteState(session);
  const persistedRevisionLineage = getPersistedRevisionLineage(session);
  const persistedRequestedOutputs = getPersistedRequestedOutputs(session);
  const stableRequestedOutputs = activePlanContent
    ? requestedOutputs
    : persistedRequestedOutputs.length > 0
      ? persistedRequestedOutputs
      : requestedOutputs;

  const openQuestions = uniqueStrings([
    ...(Array.isArray(latestGoalUpdate?.content.open_questions)
      ? latestGoalUpdate.content.open_questions.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
      : []),
    ...(Array.isArray(workspaceState.open_questions)
      ? workspaceState.open_questions.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
      : []),
  ]).filter((item) => !isMetaDraftChoiceQuestion(item));

  const activeRevision =
    typeof workspaceState.active_plan_revision === "number"
      ? workspaceState.active_plan_revision
      : planContext.activePlanningMessage && typeof planContext.activePlanningMessage.content.revision === "number"
        ? planContext.activePlanningMessage.content.revision
        : asNumber(persistedRouteState?.active_revision);
  const activeOption = isPlanOptionValue(workspaceState.active_plan_option)
    ? workspaceState.active_plan_option
    : planContext.activePlanOption || asPlanOption(persistedRouteState?.active_option);
  const latestRevision =
    typeof workspaceState.latest_plan_revision === "number"
      ? workspaceState.latest_plan_revision
      : planContext.latestPlanRevision ??
        asNumber(persistedRevisionLineage?.latest_revision) ??
        asNumber(persistedRouteState?.latest_revision);
  const confirmedRevision =
    typeof workspaceState.confirmed_plan_revision === "number"
      ? workspaceState.confirmed_plan_revision
      : session.confirmed_plan_revision ??
        asNumber(persistedRevisionLineage?.confirmed_revision) ??
        asNumber(persistedRouteState?.confirmed_revision);
  const confirmedOption = isPlanOptionValue(workspaceState.confirmed_plan_option)
    ? workspaceState.confirmed_plan_option
    : session.confirmed_plan_option ||
      asPlanOption(persistedRevisionLineage?.confirmed_option) ||
      asPlanOption(persistedRouteState?.confirmed_option);
  const selectedTemplateId =
    (typeof workspaceState.active_plan_template_id === "string" &&
    workspaceState.active_plan_template_id.trim()
      ? workspaceState.active_plan_template_id.trim()
      : null) ||
    (typeof activePlanContent?.template_id === "string" && activePlanContent.template_id.trim()
      ? activePlanContent.template_id.trim()
      : null) ||
    (typeof activePlanContent?.execution_template_id === "string" &&
    activePlanContent.execution_template_id.trim()
      ? activePlanContent.execution_template_id.trim()
      : null) ||
    (typeof persistedRouteState?.selected_template_id === "string" &&
    persistedRouteState.selected_template_id.trim()
      ? persistedRouteState.selected_template_id.trim()
      : null);
  const selectedTemplateName =
    (typeof workspaceState.active_plan_template_name === "string" &&
    workspaceState.active_plan_template_name.trim()
      ? workspaceState.active_plan_template_name.trim()
      : null) ||
    (typeof activePlanContent?.template_name === "string" && activePlanContent.template_name.trim()
      ? activePlanContent.template_name.trim()
      : null) ||
    (typeof persistedRouteState?.selected_template_name === "string" &&
    persistedRouteState.selected_template_name.trim()
      ? persistedRouteState.selected_template_name.trim()
      : null) ||
    selectedTemplateId;
  const sourceRevision =
    planContext.sourceRevision ??
    asNumber(persistedRevisionLineage?.source_revision);
  const sourceOption =
    planContext.sourceOption ||
    asPlanOption(persistedRevisionLineage?.source_option);
  const alternativeAvailable = !!planContext.latestPlanningMessage
    ? alternativePlanExists(planContext.latestPlanningMessage)
    : persistedRouteState?.alternative_available === true;
  const routeStale =
    typeof workspaceState.plan_stale === "boolean"
      ? workspaceState.plan_stale
      : persistedRouteState?.stale === true;
  const routeStaleReason =
    typeof workspaceState.stale_reason === "string" && workspaceState.stale_reason.trim()
      ? workspaceState.stale_reason.trim()
      : typeof persistedRouteState?.stale_reason === "string" && persistedRouteState.stale_reason.trim()
        ? persistedRouteState.stale_reason.trim()
        : null;

  return {
    objective:
      (latestGoalUpdate &&
      typeof latestGoalUpdate.content.working_goal === "string" &&
      latestGoalUpdate.content.working_goal.trim()
        ? latestGoalUpdate.content.working_goal.trim()
        : null) ||
      (typeof workspaceState.working_goal === "string" && workspaceState.working_goal.trim()
        ? String(workspaceState.working_goal).trim()
        : null) ||
      getThreadTaskBriefFromMessages(session, messages),
    sourceBrief: getThreadTaskBriefFromMessages(session, messages),
    constraints: uniqueStrings([
      latestGoalUpdate &&
      typeof latestGoalUpdate.content.constraints_summary === "string" &&
      latestGoalUpdate.content.constraints_summary.trim()
        ? latestGoalUpdate.content.constraints_summary.trim()
        : null,
      typeof workspaceState.constraints_summary === "string" && workspaceState.constraints_summary.trim()
        ? String(workspaceState.constraints_summary).trim()
        : null,
    ]),
    requestedOutputs: stableRequestedOutputs,
    openQuestions,
    decisionFocus:
      (latestDecision &&
      typeof latestDecision.content.pending_decision === "string" &&
      latestDecision.content.pending_decision.trim()
        ? latestDecision.content.pending_decision.trim()
        : null) ||
      (typeof workspaceState.pending_decision === "string" && workspaceState.pending_decision.trim()
        ? String(workspaceState.pending_decision).trim()
        : null) ||
      (typeof workspaceState.next_recommended_detail === "string" &&
      workspaceState.next_recommended_detail.trim()
        ? String(workspaceState.next_recommended_detail).trim()
        : null),
    route: {
      activeRevision,
      activeOption,
      latestRevision,
      confirmedRevision,
      confirmedOption,
      selectedTemplateId,
      selectedTemplateName,
      alternativeAvailable,
      stale: routeStale,
      staleReason: routeStaleReason,
    },
    pipelineSummary: buildMissionPipelineSummary(pipelines),
    checkpointSummary: buildMissionCheckpointSummary(checkpoints),
    revisionLineage: {
      sourceRevision,
      sourceOption,
      latestRevision,
      confirmedRevision,
      confirmedOption,
    },
  };
}

function getLatestMessage(
  messages: SessionMessageRecord[],
  predicate?: (message: SessionMessageRecord) => boolean,
): SessionMessageRecord | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!predicate || predicate(message)) {
      return message;
    }
  }
  return null;
}

function getLatestTimestamp(
  session: SessionRecord,
  messages: SessionMessageRecord[],
): string {
  return uniqueStrings([
    session.updated_at,
    ...messages.map((message) => message.created_at),
  ]).sort((left, right) => right.localeCompare(left))[0] || session.updated_at;
}

function buildMissionSpecContract(input: {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  missionSpec: MissionSpecSummary;
  workspaceState: Record<string, unknown>;
}): MissionSpecContract {
  const { session, messages, missionSpec, workspaceState } = input;
  const latestMessage = getLatestMessage(messages);
  const latestUserMessage = getLatestMessage(
    messages,
    (message) => message.role === "user" && message.kind === "text",
  );
  const latestPlanMessage = getLatestMessage(
    messages,
    (message) => message.kind === "plan_options_card" || message.kind === "plan_card",
  );
  const activeRunId =
    (typeof workspaceState.latest_run_id === "string" && workspaceState.latest_run_id.trim()
      ? workspaceState.latest_run_id.trim()
      : null) ||
    session.latest_run_id;

  return {
    specId: `mission_spec:${session.session_id}`,
    missionId: session.session_id,
    sessionId: session.session_id,
    schemaVersion: 1,
    title: session.title || missionSpec.objective || "Mission",
    status: session.status,
    objective: missionSpec.objective,
    sourceBrief: missionSpec.sourceBrief,
    constraints: [...missionSpec.constraints],
    requestedOutputs: [...missionSpec.requestedOutputs],
    openQuestions: [...missionSpec.openQuestions],
    decisionFocus: missionSpec.decisionFocus,
    route: { ...missionSpec.route },
    pipelineSummary: {
      ...missionSpec.pipelineSummary,
      primaryAgentLabels: [...missionSpec.pipelineSummary.primaryAgentLabels],
    },
    checkpointSummary: {
      ...missionSpec.checkpointSummary,
      labels: [...missionSpec.checkpointSummary.labels],
    },
    revisionLineage: { ...missionSpec.revisionLineage },
    activeRunId,
    latestMessageId: latestMessage?.message_id || null,
    latestUserMessageId: latestUserMessage?.message_id || null,
    latestPlanMessageId: latestPlanMessage?.message_id || null,
    createdAt: session.created_at,
    updatedAt: getLatestTimestamp(session, messages),
  };
}

export function buildMissionWorkspaceProjection(input: {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  workspaceState: Record<string, unknown>;
}): MissionWorkspaceProjection {
  const { session, messages, workspaceState } = input;
  const pipelines = buildMissionPipelinesFromSession(session, messages);
  const checkpoints = buildMissionCheckpointsFromSession(session, messages, workspaceState);
  const missionSpec = buildMissionSpecSummaryFromSession(
    session,
    messages,
    workspaceState,
    pipelines,
    checkpoints,
  );
  const missionSpecContract = buildMissionSpecContract({
    session,
    messages,
    missionSpec,
    workspaceState,
  });
  const artifactSurfaces = buildWorkspaceArtifactSurfacesFromSession(messages);
  const outputs = buildMissionOutputsFromSession({
    requestedOutputs: missionSpec.requestedOutputs,
    pipelines,
    messages,
    workspaceState,
    session,
  });
  const workspaceSections = buildMissionWorkspaceSectionsFromSession({
    missionSpec,
    pipelines,
    checkpoints,
    outputs,
    workspaceState,
    session,
    messages,
  });
  const latestReply =
    [...messages]
      .reverse()
      .find((message) => message.role === "orchestrator" && isConversationTextMessage(message)) || null;
  const latestUserText =
    [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.kind === "text") || null;
  const latestPlanningMessage =
    [...messages]
      .reverse()
      .find((message) => message.kind === "plan_options_card" || message.kind === "plan_card") || null;
  const latestDraftMessage =
    [...messages]
      .reverse()
      .find((message) => message.kind === "draft_card") || null;
  const activeRouteRevision = missionSpec.route.activeRevision;
  const activeRouteOption = missionSpec.route.activeOption;

  const activeStageKey: MissionStageSummary["key"] =
    session.status === "running" || session.status === "waiting_human" || session.latest_run_id
      ? "execution"
      : latestPlanningMessage || latestDraftMessage
        ? "plan"
        : pipelines.length > 0
          ? "work"
          : latestReply || latestUserText
            ? "thread"
            : "briefing";

  const stages: MissionStageSummary[] = [
    {
      key: "briefing",
      label: "Mission brief",
      title: missionSpec.objective || "Mission intake",
      detail:
        missionSpec.constraints.length > 0
          ? `Constraints: ${missionSpec.constraints.join(" / ")}`
          : missionSpec.decisionFocus || "Mission context is still being shaped.",
      metric:
        missionSpec.openQuestions.length > 0 ? `${missionSpec.openQuestions.length} open question(s)` : "brief ready",
      tone:
        typeof workspaceState.plan_stale === "boolean" && workspaceState.plan_stale
          ? "warn"
          : "neutral",
      status: activeStageKey === "briefing" ? "active" : missionSpec.objective ? "done" : "pending",
    },
    {
      key: "work",
      label: "Work",
      title:
        pipelines.length > 1
          ? `${pipelines.length} work packages are materialized`
          : pipelines[0]?.title || "Work packages not materialized",
      detail:
        pipelines[0]?.summary ||
        "The orchestrator will expose concrete pipelines here after a route is compiled.",
      metric: `${pipelines.reduce((total, item) => total + item.nodeCount, 0)} node(s)`,
      tone:
        pipelines.some((item) => item.status === "blocked")
          ? "warn"
          : pipelines.some((item) => item.status === "active" || item.status === "done")
            ? "success"
            : "neutral",
      status: activeStageKey === "work" ? "active" : pipelines.length > 0 ? "done" : "pending",
    },
    {
      key: "plan",
      label: "Route",
      title:
        typeof activeRouteRevision === "number"
          ? `Route revision v${activeRouteRevision}`
          : latestDraftMessage
            ? "Draft workflow shape is ready"
            : "No route yet",
      detail:
        typeof workspaceState.stale_reason === "string" && workspaceState.stale_reason.trim()
          ? workspaceState.stale_reason.trim()
          : missionSpec.decisionFocus || "Route comparison will appear after DAG drafting or plan compilation.",
      metric:
        latestPlanningMessage?.kind === "plan_options_card"
          ? `${isPlainObject(latestPlanningMessage.content.alternative) ? 2 : 1} option(s)`
          : latestDraftMessage
            ? `${typeof workspaceState.draft_node_count === "number" ? workspaceState.draft_node_count : 0} draft node(s)`
            : "route pending",
      tone:
        typeof workspaceState.plan_stale === "boolean" && workspaceState.plan_stale
          ? "warn"
          : latestPlanningMessage || latestDraftMessage
            ? "warn"
            : "neutral",
      status:
        activeStageKey === "plan"
          ? "active"
          : latestPlanningMessage || latestDraftMessage
            ? "done"
            : "pending",
    },
    {
      key: "execution",
      label: "Runtime",
      title:
        typeof workspaceState.latest_subtask === "object" &&
        workspaceState.latest_subtask &&
        typeof (workspaceState.latest_subtask as Record<string, unknown>).node_name === "string"
          ? String((workspaceState.latest_subtask as Record<string, unknown>).node_name)
          : "Runtime story",
      detail:
        typeof workspaceState.latest_run_summary === "string" && workspaceState.latest_run_summary.trim()
          ? workspaceState.latest_run_summary.trim()
          : "Runtime events will be condensed here after launch.",
      metric:
        typeof workspaceState.latest_run_id === "string" && workspaceState.latest_run_id.trim()
          ? typeof workspaceState.run_status === "string" && workspaceState.run_status.trim()
            ? workspaceState.run_status.trim()
            : "run active"
          : "not launched",
      tone:
        typeof workspaceState.run_status === "string"
          ? getRunTone(workspaceState.run_status)
          : "neutral",
      status:
        activeStageKey === "execution"
          ? "active"
          : typeof workspaceState.latest_run_id === "string" && workspaceState.latest_run_id.trim()
            ? "done"
            : "pending",
    },
    {
      key: "thread",
      label: "Conversation",
      title: latestReply ? "Live mission thread" : "Conversation has not started",
      detail:
        getConversationMessageText(latestReply) ||
        "The mission thread stays live while the workspace holds the evolving orchestration state.",
      metric: `${messages.filter((message) => isConversationTextMessage(message)).length} turn(s)`,
      tone: "neutral",
      status: activeStageKey === "thread" ? "active" : latestReply || latestUserText ? "done" : "pending",
    },
  ];

  return {
    missionSpec,
    missionSpecContract,
    missionSnapshot: {
      workspace_contract_version: MISSION_WORKSPACE_CONTRACT_VERSION,
      missionTitle: session.title || "Mission",
      missionSummary:
        getConversationMessageText(latestReply) ||
        (workspaceState.plan_stale === true &&
        typeof workspaceState.stale_reason === "string" &&
        workspaceState.stale_reason.trim()
          ? workspaceState.stale_reason.trim()
          : null) ||
        (typeof workspaceState.pending_decision === "string" && workspaceState.pending_decision.trim()
          ? workspaceState.pending_decision.trim()
          : typeof workspaceState.next_recommended_detail === "string" &&
              workspaceState.next_recommended_detail.trim()
            ? workspaceState.next_recommended_detail.trim()
          : "Mission workspace is ready for the next orchestration move."),
      missionStatusLabel:
        session.status === "running"
          ? "Running"
          : session.status === "waiting_human"
            ? "Waiting"
            : session.status === "completed"
              ? "Completed"
              : session.status === "failed"
                ? "Failed"
                : session.status === "cancelled"
                  ? "Cancelled"
                  : latestPlanningMessage
                    ? "Planning"
                    : "Briefing",
      missionStatusTone:
        session.status === "completed"
          ? "success"
          : session.status === "failed" || session.status === "cancelled"
            ? "danger"
            : session.status === "running"
              ? "success"
              : session.status === "waiting_human" || latestPlanningMessage
                ? "warn"
                : "neutral",
      objective: missionSpec.objective,
      spec: missionSpec,
      stages,
      pipelines,
      checkpoints,
      outputs,
      workspaceSections,
      artifactSurfaces,
      nextActionLabel:
        typeof workspaceState.next_recommended_label === "string" && workspaceState.next_recommended_label.trim()
          ? workspaceState.next_recommended_label.trim()
          : null,
      nextActionDetail:
        typeof workspaceState.next_recommended_detail === "string" && workspaceState.next_recommended_detail.trim()
          ? workspaceState.next_recommended_detail.trim()
          : null,
      latestUserInstruction: getConversationMessageText(latestUserText),
      orchestratorReadback:
        latestReply && typeof latestReply.content.user_read === "string" && latestReply.content.user_read.trim()
          ? latestReply.content.user_read.trim()
          : getConversationMessageText(latestReply),
      latestOrchestratorReply: getConversationMessageText(latestReply),
      activeRouteRevision,
      activeRouteOption,
      activeRunId:
        typeof workspaceState.latest_run_id === "string" && workspaceState.latest_run_id.trim()
          ? workspaceState.latest_run_id.trim()
          : session.latest_run_id,
      conversationTurns: messages.filter((message) => isConversationTextMessage(message)).length,
      evidenceCount: messages.filter((message) => !isConversationTextMessage(message)).length,
    },
  };
}
