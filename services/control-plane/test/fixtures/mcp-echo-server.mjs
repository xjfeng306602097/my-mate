import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({ name: "my-mate-test-mcp", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Returns a bounded echo payload for MCP Host integration tests.",
    inputSchema: {
      text: z.string().min(1).max(200),
      note: z.string().nullable().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ text, note }) => ({
    content: [{ type: "text", text: note ? `${text}:${note}` : text }],
    structuredContent: { echoed: text, note: note ?? null },
  }),
);

server.registerTool(
  "default_action",
  {
    title: "Default action",
    description: "An MCP tool without risk annotations.",
    inputSchema: { value: z.string().min(1).max(200) },
  },
  async ({ value }) => ({ content: [{ type: "text", text: `default:${value}` }] }),
);

server.registerTool(
  "write_record",
  {
    title: "Write record",
    description: "Simulates a destructive external write.",
    inputSchema: { value: z.string().min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ value }) => ({ content: [{ type: "text", text: `wrote:${value}` }] }),
);

server.registerTool(
  "secret_status",
  {
    title: "Secret status",
    description: "Reports whether the encrypted test secret reached the MCP process.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => ({
    content: [{ type: "text", text: process.env.MCP_FIXTURE_SECRET ? "configured" : "missing" }],
  }),
);

if (process.env.MCP_FIXTURE_PID_FILE) {
  fs.writeFileSync(process.env.MCP_FIXTURE_PID_FILE, String(process.pid), "utf8");
}

await server.connect(new StdioServerTransport());
