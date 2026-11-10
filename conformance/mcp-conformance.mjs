#!/usr/bin/env node
// MCP conformance check â€” zero dependencies, Node 18+.
//
// Purpose: prove an MCP server actually works before a client pays for it, and
// give the client a script they can re-run themselves at any time. It checks the
// things that silently break agent integrations:
//
//   * JSON-RPC 2.0 envelope and matching id
//   * `initialize` returns a protocolVersion and serverInfo
//   * `tools/list` returns an array of tools
//   * every tool has a name, a description, and an object inputSchema
//   * tool names are unique and match the MCP naming convention
//   * required fields in the schema are actually declared in properties
//   * read-only tools are not marked destructive
//   * `tools/call` on an unknown tool returns a JSON-RPC error, not a crash
//
// Usage:
//   node mcp-conformance.mjs --url https://host/mcp
//   node mcp-conformance.mjs --url https://host/mcp --header "Authorization: Bearer x"
//   node mcp-conformance.mjs --url http://localhost:8787/mcp --json
//
// Exit codes: 0 all checks passed, 1 at least one failed, 2 bad usage.

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const URL_ARG = arg("url");
const HEADER = arg("header");
const AS_JSON = args.includes("--json");
const TIMEOUT_MS = Number(arg("timeout", "20000"));

if (!URL_ARG) {
  console.error("usage: node mcp-conformance.mjs --url <mcp endpoint> [--header 'K: V'] [--json]");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  if (!AS_JSON) {
    const mark = ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${name}${detail ? " â€” " + detail : ""}`);
  }
  return ok;
}

const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
if (HEADER) {
  const idx = HEADER.indexOf(":");
  if (idx < 0) {
    console.error("--header must be 'Name: Value'");
    process.exit(2);
  }
  headers[HEADER.slice(0, idx).trim()] = HEADER.slice(idx + 1).trim();
}

let nextId = 1;
async function rpc(method, params = {}) {
  const id = nextId++;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_ARG, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Some servers answer with an SSE stream: pull the first data: line.
      const line = text.split(/\r?\n/).find(l => l.startsWith("data:"));
      if (line) {
        try { json = JSON.parse(line.slice(5).trim()); } catch { /* leave null */ }
      }
    }
    return { status: res.status, json, text, contentType: res.headers.get("content-type") || "" };
  } catch (e) {
    return { status: 0, json: null, text: String(e), contentType: "", error: true };
  } finally {
    clearTimeout(t);
  }
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

async function main() {
  if (!AS_JSON) console.log(`MCP conformance: ${URL_ARG}\n`);

  // ---- transport ----
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-conformance", version: "1.0.0" },
  });

  check("endpoint reachable", !init.error, init.error ? init.text : `HTTP ${init.status}`);
  check("initialize returns HTTP 200", init.status === 200, `got ${init.status}`);
  check("response is JSON (or SSE carrying JSON)", init.json !== null, init.contentType || "unparseable body");
  if (!init.json) return finish();

  check("jsonrpc field is \"2.0\"", init.json.jsonrpc === "2.0", String(init.json.jsonrpc));
  check("initialize has no error object", !init.json.error, init.json.error ? JSON.stringify(init.json.error).slice(0, 200) : "ok");
  const ir = init.json.result || {};
  check("initialize returns protocolVersion", typeof ir.protocolVersion === "string", ir.protocolVersion || "missing");
  check("initialize returns serverInfo.name", typeof ir.serverInfo?.name === "string", ir.serverInfo?.name || "missing");
  check("initialize advertises tools capability", Boolean(ir.capabilities?.tools), JSON.stringify(ir.capabilities || {}));

  // ---- tools/list ----
  const list = await rpc("tools/list", {});
  check("tools/list returns HTTP 200", list.status === 200, `got ${list.status}`);
  if (!list.json) return finish();
  check("tools/list has no error object", !list.json.error, list.json.error ? JSON.stringify(list.json.error).slice(0, 200) : "ok");

  const tools = list.json.result?.tools;
  check("tools/list returns an array", Array.isArray(tools), Array.isArray(tools) ? `${tools.length} tools` : typeof tools);
  if (!Array.isArray(tools) || tools.length === 0) return finish();

  const names = new Set();
  let schemaFailures = 0;
  let requiredFailures = 0;
  let annotationFailures = 0;

  for (const t of tools) {
    if (!t || typeof t.name !== "string") { schemaFailures++; continue; }
    if (!NAME_RE.test(t.name)) schemaFailures++;
    if (names.has(t.name)) schemaFailures++;
    names.add(t.name);
    if (typeof t.description !== "string" || t.description.trim().length < 10) schemaFailures++;
    const s = t.inputSchema;
    if (!s || s.type !== "object" || typeof s.properties !== "object") schemaFailures++;
    else {
      for (const req of s.required || []) {
        if (!(req in s.properties)) requiredFailures++;
      }
    }
    const a = t.annotations;
    if (a && a.readOnlyHint === true && a.destructiveHint === true) annotationFailures++;
  }

  check("every tool has name, description and object inputSchema", schemaFailures === 0, schemaFailures ? `${schemaFailures} defect(s)` : `${tools.length}/${tools.length} valid`);
  check("every required field is declared in properties", requiredFailures === 0, requiredFailures ? `${requiredFailures} undeclared` : "ok");
  check("no tool is both readOnly and destructive", annotationFailures === 0, annotationFailures ? `${annotationFailures} contradictory` : "ok");
  check("tool names unique and MCP-conventional", names.size === tools.length, `${names.size} unique`);

  // ---- error handling on an unknown tool ----
  const bad = await rpc("tools/call", { name: "__definitely_not_a_tool__", arguments: {} });
  const errored = Boolean(bad.json?.error) || Boolean(bad.json?.result?.isError);
  check("unknown tool returns a JSON-RPC error (no crash)", errored && bad.status !== 0, `HTTP ${bad.status}, ${errored ? "error surfaced" : "no error surfaced"}`);

  return finish(tools);
}

function finish(tools = []) {
  const failed = results.filter(r => !r.ok);
  if (AS_JSON) {
    console.log(JSON.stringify({ url: URL_ARG, passed: results.length - failed.length, failed: failed.length, tools: tools.map(t => t.name), results }, null, 2));
  } else {
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (tools.length) console.log(`tools: ${tools.map(t => t.name).join(", ")}`);
    if (failed.length) {
      console.log("\nFAILED:");
      for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.error("conformance run crashed:", e);
  process.exit(1);
});
