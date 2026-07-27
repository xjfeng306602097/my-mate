import { CapabilityToolError } from "./capability-registry.js";
import type { CapabilityPluginModule } from "./plugin-host.js";
import { getSkillHost } from "./skill-host.js";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Skill Host operation failed.";
  const code = /^SKILL_[A-Z0-9_]+$/u.test(message) ? message.toLowerCase() : "skill_host_failed";
  throw new CapabilityToolError(code, message);
}

export const skillsCorePlugin: CapabilityPluginModule = {
  register(context) {
    context.registerTool("skill_search", ({ session, arguments: args }) => {
      try {
        const workspaceId = session.workspace_id || "default";
        const items = getSkillHost().search(workspaceId, String(args.query || ""), Number(args.limit || 5));
        return {
          ok: true,
          count: items.length,
          skills: items.map((item) => ({
            skill_id: item.skill_id,
            name: item.name,
            version: item.version,
            description: item.description,
            category: item.category,
            risk_level: item.risk_level,
            allowed_tools: item.allowed_tools,
            required_capabilities: item.required_capabilities,
          })),
          next: items.length ? "Call skill_load with one skill_id before following its workflow." : "Continue without a Skill.",
        };
      } catch (error) {
        return fail(error);
      }
    });
    context.registerTool("skill_load", ({ session, arguments: args, action_id: actionId }) => {
      try {
        const loaded = getSkillHost().load({
          workspaceId: session.workspace_id || "default",
          session,
          skillId: String(args.skill_id || ""),
          actionId,
        });
        return {
          ok: true,
          activated: true,
          invocation_id: loaded.invocation.invocation_id,
          skill_id: loaded.status.skill_id,
          version: loaded.status.version,
          instructions_digest: loaded.status.instructions_digest,
          instructions: loaded.instructions,
          allowed_tools: loaded.status.allowed_tools,
          resources: loaded.status.resources,
          input_schema: loaded.status.input_schema,
          output_contract: loaded.status.output_contract,
          execution_boundary: "Skill package code is not executed. Use only the declared tools; their normal risk and approval policies still apply.",
        };
      } catch (error) {
        return fail(error);
      }
    });
    context.registerTool("skill_resource_read", ({ session, arguments: args }) => {
      try {
        const resource = getSkillHost().readResource(
          session.workspace_id || "default",
          String(args.skill_id || ""),
          String(args.resource || ""),
          session.session_id,
        );
        return { ok: true, skill_id: args.skill_id, resource: args.resource, ...resource };
      } catch (error) {
        return fail(error);
      }
    });
  },
};
