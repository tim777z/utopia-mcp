// Proves the conformance checker actually catches defects (a checker that always
// passes is worse than none), then runs it against the live reference endpoint.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, "mcp-conformance.mjs");

// A server with four deliberate defects.
const BROKEN_TOOLS = [
  {
    name: "good_tool",
    description: "A perfectly fine tool with a valid schema.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    // defect: no inputSchema at all
    name: "no_schema",
    description: "This tool forgot its schema entirely.",
  },
  {
    // defect: required field not declared in properties
    name: "bad_required",
    description: "Declares a required field that does not exist.",
    inputSchema: { type: "object", properties: {}, required: ["missing_field"] },
  },
  {
    // defect: contradictory annotations
    name: "contradictory",
    description: "Claims to be both read-only and destructive.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: true },
  },
  {
    // defect: duplicate name
    name: "good_tool",
    description: "A duplicate of an earlier tool name.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    let msg = {};
    try { msg = JSON.parse(body || "{}"); } catch { /* ignore */ }
    const send = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (msg.method === "initialize") {
      return send({
        jsonrpc: "2.0", id: msg.id,
        result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "broken-mock", version: "0.0.1" } },
      });
    }
    if (msg.method === "tools/list") {
      return send({ jsonrpc: "2.0", id: msg.id, result: { tools: BROKEN_TOOLS } });
    }
    if (msg.method === "tools/call") {
      // defect: unknown tool silently returns success instead of an error
      return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
    }
    return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  });
});

await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const out = { negative: null, positive: null, assertions: [] };

// ---- negative: the broken mock must be rejected ----
try {
  const { stdout } = await exec("node", [CHECKER, "--url", `http://127.0.0.1:${port}/mcp`, "--json"], { timeout: 60000 });
  out.negative = { exitCode: 0, report: JSON.parse(stdout) };
} catch (e) {
  let report = null;
  try { report = JSON.parse(e.stdout || "{}"); } catch { /* ignore */ }
  out.negative = { exitCode: e.code ?? 1, report };
}
const negReport = out.negative.report || {};
const failedNames = (negReport.results || []).filter(r => !r.ok).map(r => r.name);
out.assertions.push({
  name: "broken mock is rejected (exit 1)",
  ok: out.negative.exitCode !== 0,
  detail: `exit=${out.negative.exitCode}`,
});
out.assertions.push({
  name: "checker caught the missing-schema defect",
  ok: failedNames.some(n => n.includes("inputSchema")),
  detail: failedNames.join(" | ") || "no failures reported",
});
out.assertions.push({
  name: "checker caught the undeclared-required defect",
  ok: failedNames.some(n => n.includes("required")),
  detail: "",
});
out.assertions.push({
  name: "checker caught the contradictory-annotation defect",
  ok: failedNames.some(n => n.includes("readOnly")),
  detail: "",
});
out.assertions.push({
  name: "checker caught the silent-unknown-tool defect",
  ok: failedNames.some(n => n.includes("unknown tool")),
  detail: "",
});

server.close();

// ---- positive: the live reference endpoint must pass ----
try {
  const { stdout } = await exec(
    "node",
    [CHECKER, "--url", "https://utopia-orders.precogsecurity.workers.dev/mcp", "--json"],
    { timeout: 60000 }
  );
  out.positive = { exitCode: 0, report: JSON.parse(stdout) };
} catch (e) {
  let report = null;
  try { report = JSON.parse(e.stdout || "{}"); } catch { /* ignore */ }
  out.positive = { exitCode: e.code ?? 1, report };
}
out.assertions.push({
  name: "live endpoint passes every check (exit 0)",
  ok: out.positive.exitCode === 0,
  detail: `exit=${out.positive.exitCode} passed=${out.positive.report?.passed} failed=${out.positive.report?.failed}`,
});

const allOk = out.assertions.every(a => a.ok);
console.log(JSON.stringify({
  allOk,
  assertions: out.assertions,
  negativeFailedChecks: failedNames,
  livePassed: out.positive.report?.passed,
  liveTools: out.positive.report?.tools,
}, null, 2));
process.exit(allOk ? 0 : 1);
