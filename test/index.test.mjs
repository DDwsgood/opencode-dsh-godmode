import { test } from "node:test"
import assert from "node:assert/strict"
import plugin, {
  BOOTSTRAP_TOOL,
  PRO_RESIDENT_TOOLS,
  PRO_PROMPT,
  FLASH_PROMPT,
  FLASH_SPEC_PROMPT,
  FLASH_REACT_PROMPT,
  THINKING_HINT,
  GUIDE_WEAK,
  GUIDE_DEEP,
  TURN_GUIDANCE,
  THIRD_REQUEST_REMINDER,
  classifyTask,
  isComplexTask,
  promptForModel,
} from "../src/index.ts"

// Installs the plugin into a fake ctx and returns a `fire` that drives one event
// through the registered "context" hook, exercising the real setup + handler.
function rigPlugin() {
  let cb = null
  const ctx = {
    session: {
      hook(name, c) {
        assert.equal(name, "context", "registers the 'context' hook")
        cb = c
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
  }
}

// --- exact prompt text ------------------------------------------------------

test("PRO_PROMPT keeps the anchored-standard persona plus the verified thinking hint", () => {
  assert.equal(PRO_PROMPT, "You are a helpful software engineer assistant.\n" + THINKING_HINT)
})

test("Flash personas match router-standard verbatim without the Pro-only thinking hint", () => {
  assert.equal(FLASH_SPEC_PROMPT, "You are a helpful software engineer assistant.")
  assert.equal(
    FLASH_REACT_PROMPT,
    "You are a hands-on software engineer who delivers working output fast.\n" +
      "Work directly: write or edit code, then verify it by reading and running. " +
      "Keep the loop tight — produce, verify, fix — and do not build test " +
      "harnesses, scaffolding, or ceremony the user did not ask for. " +
      "Finish with a usable deliverable and a short summary.",
  )
  assert.equal(
    FLASH_PROMPT,
    "You are a helpful assistant.\n" +
      "Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.\n" +
      "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.",
  )
  assert.ok(!FLASH_PROMPT.includes(THINKING_HINT))
})

test("router-standard classifier and depth heuristic require no LLM call", () => {
  assert.equal(classifyTask("从零开发一个网页游戏"), "react")
  assert.equal(classifyTask("修复这个仓库里的 bug"), "spec")
  assert.equal(classifyTask("今天天气怎么样"), "weak")
  assert.equal(classifyTask("开发并修复"), "weak")
  assert.equal(isComplexTask("详细分析这个设计"), true)
  assert.equal(isComplexTask("x".repeat(121)), true)
  assert.equal(isComplexTask("hello"), false)
})

test("guidance text matches router-standard", () => {
  assert.equal(
    GUIDE_WEAK,
    "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.",
  )
  assert.equal(
    GUIDE_DEEP,
    "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.",
  )
})

test("third-request reminder preserves tool and skill discovery", () => {
  assert.equal(
    THIRD_REQUEST_REMINDER,
    "<system_reminder>Tools: execute -> search({}) -> tools. Skills: cwd/.agents/skills, $HOME/.agents/skills.</system_reminder>",
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

test("routes Flash persona from the first user-role message", () => {
  assert.equal(
    promptForModel(
      { id: "deepseek-v4-flash", providerID: "litellm" },
      [{ role: "user", content: [{ type: "text", text: "写一个 Python 脚本" }] }],
    ),
    FLASH_REACT_PROMPT,
  )
  assert.equal(
    promptForModel(
      { id: "deepseek-v4-flash", providerID: "litellm" },
      [{ role: "user", content: [{ type: "text", text: "修复这个报错" }] }],
    ),
    FLASH_SPEC_PROMPT,
  )
  assert.equal(
    promptForModel(
      { id: "deepseek-v4-flash", providerID: "litellm" },
      [{ role: "user", content: [{ type: "text", text: "你好" }] }],
    ),
    FLASH_PROMPT,
  )
})

test("returns null for empty or missing fields", () => {
  assert.equal(promptForModel({}), null)
  assert.equal(promptForModel({ id: "", providerID: "" }), null)
})

// --- hook integration --------------------------------------------------------

test("Pro first request uses only the shell bootstrap without routing guidance", async () => {
  const { fire } = rigPlugin()
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

  // Routing-suite guidance belongs only to weak Flash sessions.
  assert.equal(event.messages, messagesRef, "messages reference preserved")
  assert.equal(event.messages.length, 1)
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
    messages: [{ id: "msg-flash-user", role: "user", content: [{ type: "text", text: "写一个脚本" }] }],
    tools,
  }
  const toolsRef = event.tools

  await fire(event)

  assert.equal(event.system.length, 1, "system collapsed to a single part")
  assert.deepEqual(event.system[0], { type: "text", text: FLASH_REACT_PROMPT })
  assert.equal(event.tools, toolsRef, "tools object reference preserved")
  assert.deepEqual(Object.keys(event.tools), [BOOTSTRAP_TOOL])
})

test("Pro exposes shell/edit/read/glob/execute without Flash routing guidance", async () => {
  const { fire } = rigPlugin()
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
  assert.equal(event.messages.at(-1).id, "msg-user-new")
})

test("weak Flash reconstructs guidance directly after every user-role message", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-reconstructed",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user-1", role: "user", content: [{ type: "text", text: "你好" }] },
      { id: "msg-assistant", role: "assistant", content: [{ type: "tool-call" }] },
      { id: "msg-tool", role: "tool", content: [{ type: "tool-result" }] },
      { id: "msg-user-2", role: "user", content: [{ type: "text", text: "继续" }] },
    ],
    tools: { shell: {}, read: {}, edit: {}, execute: {} },
  }
  await fire(event)
  assert.deepEqual(
    event.messages.map((message) => message.id ?? message.metadata?.userMessageID),
    ["msg-user-1", "msg-user-1", "msg-assistant", "msg-tool", "msg-user-2", "msg-user-2"],
  )
  assert.equal(event.messages[1].content[0].text, GUIDE_WEAK)
  assert.equal(event.messages[5].content[0].text, GUIDE_WEAK)
})

test("complex weak Flash messages receive the deep guide", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-deep-guide",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [{ id: "msg-user", role: "user", content: [{ type: "text", text: "详细分析一下当前行为" }] }],
    tools: { shell: {}, read: {} },
  }
  await fire(event)
  assert.equal(event.messages[1].content[0].text, GUIDE_DEEP)
})

test("clear Flash build and fix tasks use strong personas without weak guidance", async () => {
  const { fire } = rigPlugin()
  for (const [text, prompt] of [
    ["从零开发一个网页游戏", FLASH_REACT_PROMPT],
    ["修复这个报错", FLASH_SPEC_PROMPT],
  ]) {
    const event = {
      sessionID: `s-${text}`,
      agent: "build",
      model: { id: "deepseek-v4-flash", providerID: "litellm" },
      system: [{ type: "text", text: "host" }],
      messages: [{ id: "msg-user", role: "user", content: [{ type: "text", text }] }],
      tools: { shell: {}, read: {} },
    }
    await fire(event)
    assert.deepEqual(event.system, [{ type: "text", text: prompt }])
    assert.equal(event.messages.length, 1)
  }
})

test("no user-role message means no guidance is fabricated", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-no-user",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [{ id: "msg-assistant", role: "assistant", content: [] }],
    tools: { shell: {}, read: {} },
  }
  await fire(event)
  assert.equal(event.messages.length, 1)
  assert.equal(event.messages.some((message) => message.metadata?.dshGodmodeGuide), false)
})

test("existing adjacent guidance is not duplicated", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-existing-guide",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "你好" }] },
      { role: "user", content: [{ type: "text", text: GUIDE_WEAK }], metadata: { dshGodmodeGuide: true } },
    ],
    tools: { shell: {}, read: {} },
  }
  await fire(event)
  assert.equal(event.messages.length, 2)
})

test("guidance persisted by 0.1.1 is recognized but never reproduced", async () => {
  const { fire } = rigPlugin()
  const legacy = { id: "legacy", role: "user", content: [{ type: "text", text: TURN_GUIDANCE }] }
  const event = {
    sessionID: "s-legacy-guide",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "你好" }] },
      legacy,
    ],
    tools: { shell: {}, read: {} },
  }
  await fire(event)
  assert.equal(event.messages.length, 2)
  assert.equal(event.messages[1], legacy)
})

test("third Pro request is derived from durable history and injects a request-local reminder", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-third-request",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user-1", role: "user", content: [{ type: "text", text: "first" }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  await fire(event)

  assert.equal(event.messages.at(-1).content[0].text, THIRD_REQUEST_REMINDER)
  assert.deepEqual(event.messages.at(-1).metadata, { dshGodmodeThirdRequestReminder: true })
  await fire(event)
  assert.equal(event.messages.filter((message) => message.content?.[0]?.text === THIRD_REQUEST_REMINDER).length, 1)
})

test("the reminder persisted by 0.1.1 suppresses request-local duplication", async () => {
  const { fire } = rigPlugin()
  const published = "<system_reminder>Tools: execute.search. Skills: cwd/.opencode/skills, ~/.config/opencode/skills.</system_reminder>"
  const event = {
    sessionID: "s-published-reminder",
    agent: "build",
    model: { id: "deepseek-v4-pro", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "task" }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
      { id: "msg-reminder", role: "user", content: [{ type: "text", text: published }] },
    ],
    tools: { shell: {}, read: {}, glob: {}, edit: {}, execute: {} },
  }
  await fire(event)
  assert.equal(event.messages.length, 4)
})

test("Flash never receives the Pro reminder on its third request", async () => {
  const { fire } = rigPlugin()
  const event = {
    sessionID: "s-flash-third-request",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "litellm" },
    system: [{ type: "text", text: "host" }],
    messages: [
      { id: "msg-user", role: "user", content: [{ type: "text", text: "task" }] },
      { id: "msg-assistant-1", role: "assistant", content: [] },
      { id: "msg-assistant-2", role: "assistant", content: [] },
    ],
    tools: { shell: {}, execute: {}, skill: {} },
  }
  await fire(event)

  assert.equal(event.messages.some((message) => message.content?.[0]?.text === THIRD_REQUEST_REMINDER), false)
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
