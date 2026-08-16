import { test } from "node:test"
import assert from "node:assert/strict"
import plugin, { BOOTSTRAP_TOOL, PRO_RESIDENT_TOOLS, PRO_PROMPT, FLASH_PROMPT, THINKING_HINT, THIRD_REQUEST_REMINDER, TURN_GUIDANCE, promptForModel } from "../src/index.ts"

// Installs the plugin into a fake ctx and returns a `fire` that drives one event
// through the registered "context" hook, exercising the real setup + handler.
function rigPlugin() {
  let cb = null
  const syntheticCalls = []
  const ctx = {
    session: {
      hook(name, c) {
        assert.equal(name, "context", "registers the 'context' hook")
        cb = c
      },
      async synthetic(input) {
        syntheticCalls.push(input)
      },
    },
  }
  plugin.setup(ctx)
  return {
    ctx,
    async fire(event) {
      if (!cb) throw new Error("context hook was not registered")
      await cb(event)
    },
    syntheticCalls,
  }
}

// --- exact prompt text ------------------------------------------------------

test("PRO_PROMPT keeps the anchored-standard persona plus the verified thinking hint", () => {
  assert.equal(PRO_PROMPT, "You are a helpful software engineer assistant.\n" + THINKING_HINT)
})

test("FLASH_PROMPT keeps router-core WEAK_FLASH plus the verified thinking hint", () => {
  assert.equal(
    FLASH_PROMPT,
    "You are a helpful assistant.\n" +
      "Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.\n" +
      "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n" +
      THINKING_HINT,
  )
})

test("third-request reminder preserves tool and skill discovery", () => {
  assert.equal(
    THIRD_REQUEST_REMINDER,
    "<system_reminder>Tools: execute.search. Skills: cwd/.opencode/skills, ~/.config/opencode/skills.</system_reminder>",
  )
})

// --- promptForModel matching ------------------------------------------------

test("matches deepseek-v4-pro / deepseek-v4-flash by id", () => {
  assert.equal(promptForModel({ id: "deepseek-v4-pro", providerID: "litellm" }), PRO_PROMPT)
  assert.equal(promptForModel({ id: "deepseek-v4-flash", providerID: "litellm" }), FLASH_PROMPT)
})

test("matches hyphen-suffixed variants (same model family)", () => {
  assert.equal(promptForModel({ id: "deepseek-v4-pro-260425", providerID: "litellm" }), PRO_PROMPT)
  assert.equal(promptForModel({ id: "deepseek-v4-flash-260425", providerID: "litellm" }), FLASH_PROMPT)
})

test("does NOT match a longer base name that only shares the prefix (no false hit)", () => {
  assert.equal(promptForModel({ id: "deepseek-v4-prototype", providerID: "litellm" }), null)
  assert.equal(promptForModel({ id: "deepseek-v4-flasher", providerID: "litellm" }), null)
})

test("does not match unrelated models", () => {
  assert.equal(promptForModel({ id: "gpt-4o", providerID: "openai" }), null)
  assert.equal(promptForModel({ id: "claude-sonnet-4", providerID: "anthropic" }), null)
  assert.equal(promptForModel({ id: "deepseek-v3", providerID: "deepseek" }), null)
})

test("matches via providerID when the id lacks the token", () => {
  assert.equal(promptForModel({ id: "anything", providerID: "deepseek-v4-pro" }), PRO_PROMPT)
  assert.equal(promptForModel({ id: "anything", providerID: "deepseek-v4-flash" }), FLASH_PROMPT)
})

test("returns null for empty or missing fields", () => {
  assert.equal(promptForModel({}), null)
  assert.equal(promptForModel({ id: "", providerID: "" }), null)
})

// --- hook integration --------------------------------------------------------

test("Pro first request uses only the shell bootstrap and durably admits guidance", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const tools = {
    shell: { description: "shell", input: { command: "" } },
    read: { description: "read", input: { path: "" } },
    edit: { description: "edit", input: { file: "" } },
  }
  const messages = [{ id: "msg-user-1", role: "user", content: [{ type: "text", text: "hi" }] }]
  const event = {
    sessionID: "s1",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [
      { type: "text", text: "first segment" },
      { type: "text", text: "second segment" },
      { type: "text", text: "third segment" },
    ],
    messages,
    tools,
  }
  const systemRef = event.system
  const toolsRef = event.tools
  const messagesRef = event.messages

  await fire(event)

  // system: same array reference (in-place splice), collapsed to one exact part.
  assert.equal(event.system, systemRef, "system array mutated in place (same reference)")
  assert.equal(event.system.length, 1, "multi-segment system collapsed to a single part")
  assert.deepEqual(event.system[0], { type: "text", text: PRO_PROMPT })

  // tools: same object reference, narrowed to the one bootstrap tool.
  assert.equal(event.tools, toolsRef, "tools object reference preserved")
  assert.deepEqual(Object.keys(event.tools), [BOOTSTRAP_TOOL])

  // One fixed routing-suite guide follows the real user turn.
  assert.equal(event.messages, messagesRef, "messages reference preserved")
  assert.equal(event.messages.length, 2)
  assert.deepEqual(event.messages[1], {
    role: "user",
    content: [{ type: "text", text: TURN_GUIDANCE }],
    metadata: { dshGodmodeGuide: true },
  })
  assert.equal(syntheticCalls.length, 1)
  assert.equal(syntheticCalls[0].text, TURN_GUIDANCE)
  assert.equal(syntheticCalls[0].resume, false)
})

test("Flash first request uses the same shell-only bootstrap", async () => {
  const { fire } = rigPlugin()
  const tools = {
    shell: { description: "shell", input: { command: "" } },
    read: { description: "read", input: { path: "" } },
  }
  const event = {
    sessionID: "s2",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
    messages: [{ id: "msg-flash-user", role: "user", content: [{ type: "text", text: "hi" }] }],
    tools,
  }
  const toolsRef = event.tools

  await fire(event)

  assert.equal(event.system.length, 1, "system collapsed to a single part")
  assert.deepEqual(event.system[0], { type: "text", text: FLASH_PROMPT })
  assert.equal(event.tools, toolsRef, "tools object reference preserved")
  assert.deepEqual(Object.keys(event.tools), [BOOTSTRAP_TOOL])
})

test("Pro exposes shell/edit/read/glob/execute and persists one guide per new user turn", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const tools = {
    shell: { description: "shell" },
    read: { description: "read" },
    glob: { description: "glob" },
    edit: { description: "edit" },
    execute: { description: "Code Mode" },
    skill: { description: "control-plane tool" },
    subagent: { description: "control-plane tool" },
  }
  const event = {
    sessionID: "s-promoted",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [
      { type: "text", text: "OpenCode static persona" },
      { type: "text", text: "Code Mode catalog with MCP tools" },
      { type: "text", text: "other dynamic instructions" },
    ],
    messages: [
      { id: "msg-user-old", role: "user", content: [{ type: "text", text: "old task" }] },
      { id: "msg-guide-old", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant", role: "assistant", content: [{ type: "tool-call" }] },
      { id: "msg-user-new", role: "user", content: [{ type: "text", text: "new task" }] },
    ],
    tools,
  }
  const toolsRef = event.tools

  await fire(event)

  assert.deepEqual(event.system, [{ type: "text", text: PRO_PROMPT }])
  assert.equal(event.tools, toolsRef)
  assert.deepEqual(Object.keys(event.tools), ["shell", "read", "glob", "edit", "execute"])
  assert.ok(Object.keys(event.tools).every((name) => PRO_RESIDENT_TOOLS.has(name)))
  assert.equal(event.messages.at(-1).role, "user")
  assert.equal(event.messages.at(-1).content[0].text, TURN_GUIDANCE)
  assert.equal(syntheticCalls.length, 1)
  assert.equal(syntheticCalls[0].metadata.userMessageID, "msg-user-new")
})

test("persisted guidance is reused without reinjection", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const event = {
    sessionID: "s-persisted",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "task" }] },
      { id: "msg-guide", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant", role: "assistant", content: [] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  const length = event.messages.length
  await fire(event)
  assert.equal(event.messages.length, length)
  assert.equal(syntheticCalls.length, 0)
})

test("third Pro request is derived from durable history and admits the reminder once", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const event = {
    sessionID: "s-third-request",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user-1", role: "user", content: [{ type: "text", text: "first" }] },
      { id: "msg-guide-1", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-user-2", role: "user", content: [{ type: "text", text: "second" }] },
      { id: "msg-guide-2", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  await fire(event)

  assert.equal(event.messages.at(-1).content[0].text, THIRD_REQUEST_REMINDER)
  assert.deepEqual(event.messages.at(-1).metadata, { dshGodmodeThirdRequestReminder: true })
  assert.equal(syntheticCalls.length, 1)
  assert.equal(syntheticCalls[0].text, THIRD_REQUEST_REMINDER)
  assert.equal(syntheticCalls[0].resume, false)
  assert.equal(syntheticCalls[0].metadata.requestNumber, 3)
})

test("Flash never receives the Pro reminder on its third request", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const event = {
    sessionID: "s-flash-third-request",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "task" }] },
      { id: "msg-guide", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
    ],
    tools: { shell: {}, execute: {}, skill: {} },
  }
  const length = event.messages.length

  await fire(event)

  assert.equal(event.messages.length, length)
  assert.equal(syntheticCalls.length, 0)
})

test("a persisted reminder is not admitted again when the third request is restored", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const event = {
    sessionID: "s-third-request-restored",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "task" }] },
      { id: "msg-guide", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
      { id: "msg-reminder", role: "user", content: [{ type: "text", text: THIRD_REQUEST_REMINDER }] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  const length = event.messages.length

  await fire(event)

  assert.equal(event.messages.length, length)
  assert.equal(syntheticCalls.length, 0)
})

test("later prompts and plugin restarts cannot retrigger the third-request reminder", async () => {
  const { fire, syntheticCalls } = rigPlugin()
  const event = {
    sessionID: "s-later-request",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user-1", role: "user", content: [{ type: "text", text: "first" }] },
      { id: "msg-guide-1", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-user-2", role: "user", content: [{ type: "text", text: "second" }] },
      { id: "msg-guide-2", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
      { id: "msg-user-3", role: "user", content: [{ type: "text", text: "third" }] },
      { id: "msg-guide-3", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
      { id: "msg-assistant-3", role: "assistant", content: [] },
      { id: "msg-user-4", role: "user", content: [{ type: "text", text: "fourth" }] },
      { id: "msg-guide-4", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  const length = event.messages.length

  await fire(event)

  assert.equal(event.messages.length, length)
  assert.equal(syntheticCalls.length, 0)
})

test("Flash restores the complete tool record after promotion", async () => {
  const { fire } = rigPlugin()
  const tools = { shell: {}, read: {}, execute: {}, skill: {}, subagent: {} }
  const snapshot = structuredClone(tools)
  const event = {
    sessionID: "s-flash-promoted",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "static" }, { type: "text", text: "dynamic" }],
    messages: [{ role: "assistant", content: [] }],
    tools,
  }
  await fire(event)
  assert.deepEqual(event.system, [{ type: "text", text: FLASH_PROMPT }])
  assert.deepEqual(event.tools, snapshot)
})

test("non-target model: system left completely unchanged", async () => {
  const { fire } = rigPlugin()
  const original = [
    { type: "text", text: "keep me" },
    { type: "text", text: "and me" },
  ]
  const event = {
    sessionID: "s3",
    agent: "build",
    model: { id: "gpt-4o", providerID: "openai" },
    system: [...original],
    messages: [],
    tools: {},
  }
  const systemRef = event.system

  await fire(event)

  assert.equal(event.system, systemRef, "system array reference preserved")
  assert.equal(event.system.length, original.length, "system length unchanged")
  assert.deepEqual(event.system, original, "system content unchanged")
})

test("deepseek-v4-prototype is NOT matched: system preserved", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s4",
    agent: "build",
    model: { id: "deepseek-v4-prototype", providerID: "litellm" },
    system: [{ type: "text", text: "original" }],
    messages: [],
    tools: {},
  }

  await fire(event)

  assert.equal(event.system.length, 1, "system not replaced")
  assert.equal(event.system[0].text, "original", "original system preserved")
})

test("plugin default export has the required id", () => {
  assert.equal(plugin.id, "opencode-dsh-godmode")
  assert.equal(typeof plugin.setup, "function")
})
