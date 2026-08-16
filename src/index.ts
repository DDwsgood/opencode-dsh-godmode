// opencode-dsh-godmode — OpenCode V2 server plugin.
//
// For main-loop model steps whose model id or provider string exactly contains
// `deepseek-v4-pro` or `deepseek-v4-flash`, the "context" session hook replaces
// the entire system prompt with that model's DeepSeek Harness persona,
// bootstraps one shell tool, and applies model-specific routing.

// Minimal local typings. Zero runtime imports: the opencode v2 host loads this
// default export and supplies the ctx it describes (see V2-PLUGIN-API §3).
interface SystemPart {
  type: "text"
  text: string
  cache?: boolean
  metadata?: unknown
}

interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

interface ContextEvent {
  sessionID: string
  agent: string
  model: ModelRef
  system: SystemPart[]
  messages: Array<{
    id?: string
    role?: string
    content?: Array<{ type?: string; text?: string }>
    metadata?: Record<string, unknown>
  }>
  tools: Record<string, unknown>
}

interface SetupContext {
  options?: Record<string, unknown>
  session: {
    hook(name: string, cb: (event: ContextEvent) => void | Promise<void>): unknown
  }
}

export const BOOTSTRAP_TOOL = "shell"
export const PRO_RESIDENT_TOOLS = new Set(["shell", "edit", "read", "glob", "execute"])
export const THINKING_HINT = "When you thought, thought in ENGLISH and starts with 'we need'"
export const GUIDE_WEAK =
  "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act."
export const GUIDE_DEEP =
  "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need."
// Retained only to recognize guidance already stored by version 0.1.1.
export const TURN_GUIDANCE =
  'Router: classify this task (build or fix), then adopt the matching style — build: direct production; fix: inspect first. Think deeply about architecture, edge cases, and integration points, then commit and act. Start the next reasoning block with the exact words "We need". Additional tools, including MCP tools, are discoverable only when needed through execute; inside its code call search({ query: "..." }) before using an undisclosed tool.'
export const THIRD_REQUEST_REMINDER =
  "<system_reminder>Tools: execute -> search({}) -> tools. Skills: cwd/.agents/skills, $HOME/.agents/skills. Image: vision CLI (vision --help).</system_reminder>"
const PUBLISHED_THIRD_REQUEST_REMINDER =
  "<system_reminder>Tools: execute.search. Skills: cwd/.opencode/skills, ~/.config/opencode/skills.</system_reminder>"

// Pro base persona — DeepSeek Harness "anchored-standard" preset persona row.
export const PRO_PROMPT =
  "You are a helpful software engineer assistant.\n" + THINKING_HINT

export const FLASH_SPEC_PROMPT = "You are a helpful software engineer assistant."
export const FLASH_REACT_PROMPT =
  "You are a hands-on software engineer who delivers working output fast.\n" +
  "Work directly: write or edit code, then verify it by reading and running. " +
  "Keep the loop tight — produce, verify, fix — and do not build test " +
  "harnesses, scaffolding, or ceremony the user did not ask for. " +
  "Finish with a usable deliverable and a short summary."
export const FLASH_PROMPT =
  "You are a helpful assistant.\n" +
  "Before acting, decide the task type (build or fix) and adopt the matching " +
  "style: build → hands-on production; fix → inspect-and-plan.\n" +
  "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans."

export type RoutingMode = "spec" | "react" | "weak"

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i

export function classifyTask(text: string): RoutingMode {
  const react = [...text.matchAll(REACT_RE)].length
  const spec = [...text.matchAll(SPEC_RE)].length
  if (react > spec) return "react"
  if (spec > react) return "spec"
  return "weak"
}

export function flashPromptForMode(mode: RoutingMode): string {
  if (mode === "spec") return FLASH_SPEC_PROMPT
  if (mode === "react") return FLASH_REACT_PROMPT
  return FLASH_PROMPT
}

export function isComplexTask(text: string): boolean {
  return text.length > 120 || COMPLEX_RE.test(text)
}

const PRO_TOKEN = "deepseek-v4-pro"
const FLASH_TOKEN = "deepseek-v4-flash"

// A token "exactly occurs" when it is bounded on both sides by a non-
// alphanumeric character or the string edge. A hyphen suffix such as
// `deepseek-v4-pro-260425` is the same model family (the `-` is a boundary),
// while `deepseek-v4-prototype` is NOT a match: `pro` is immediately followed
// by the alphanumeric `totype`, so the token is only a prefix of a longer name.
function containsToken(haystack: unknown, token: string): boolean {
  if (typeof haystack !== "string" || haystack.length === 0) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(haystack)
}

// Returns the replacement system prompt for a model, or null when neither the
// model id nor the provider string exactly contains a target token.
export function promptForModel(model: {
  id?: string
  providerID?: string
}, messages: ContextEvent["messages"] = []): string | null {
  if (!model) return null
  if (containsToken(model.id, PRO_TOKEN)) return PRO_PROMPT
  if (containsToken(model.id, FLASH_TOKEN)) return flashPromptForMode(modeForMessages(messages))
  if (containsToken(model.providerID, PRO_TOKEN)) return PRO_PROMPT
  if (containsToken(model.providerID, FLASH_TOKEN)) return flashPromptForMode(modeForMessages(messages))
  return null
}

export default {
  id: "opencode-dsh-godmode",
  setup(ctx: SetupContext): void {
    // The "context" hook fires once per main-loop model step (title generation
    // and compaction do not trigger it), so no internal-call skip is needed.
    ctx.session.hook("context", (event) => {
      const mode = modeForMessages(event.messages)
      const text = promptForModel(event.model, event.messages)
      if (text === null) return
      const flash = text !== PRO_PROMPT
      const bootstrapping = !event.messages.some((message) => message.role === "assistant")
      // Keep the initial system prompt byte-stable and minimal for every step.
      // Request one narrows the API tool surface. Flash later restores the full
      // record; Pro keeps an anchored resident set with on-demand discovery.
      event.system.splice(0, event.system.length, { type: "text", text })
      if (bootstrapping && BOOTSTRAP_TOOL in event.tools) {
        for (const name of Object.keys(event.tools)) {
          if (name !== BOOTSTRAP_TOOL) delete event.tools[name]
        }
      }
      if (!bootstrapping && text === PRO_PROMPT) {
        for (const name of Object.keys(event.tools)) {
          if (!PRO_RESIDENT_TOOLS.has(name)) delete event.tools[name]
        }
      }
      const requestNumber = event.messages.filter((message) => message.role === "assistant").length + 1
      if (flash && mode === "weak") insertGuidance(event.messages)
      if (text === PRO_PROMPT && requestNumber === 3 && !event.messages.some(isThirdRequestReminder)) {
        event.messages.push({
          role: "user",
          content: [{ type: "text", text: THIRD_REQUEST_REMINDER }],
          metadata: { dshGodmodeThirdRequestReminder: true },
        })
      }
    })
  },
}

function isGuidance(message: ContextEvent["messages"][number] | undefined) {
  return message?.content?.some(
    (part) =>
      part.type === "text" &&
      (part.text === GUIDE_WEAK || part.text === GUIDE_DEEP || part.text === TURN_GUIDANCE),
  ) === true
}

function isThirdRequestReminder(message: ContextEvent["messages"][number]) {
  return message.content?.some(
    (part) =>
      part.type === "text" &&
      (part.text === THIRD_REQUEST_REMINDER || part.text === PUBLISHED_THIRD_REQUEST_REMINDER),
  ) === true
}

function messageText(message: ContextEvent["messages"][number]): string {
  return message.content?.map((part) => part.text ?? "").join(" ") ?? ""
}

function modeForMessages(messages: ContextEvent["messages"]): RoutingMode {
  const first = messages.find(
    (message) => message.role === "user" && !isGuidance(message) && !isThirdRequestReminder(message),
  )
  return classifyTask(first ? messageText(first) : "")
}

function insertGuidance(messages: ContextEvent["messages"]): void {
  const rebuilt: ContextEvent["messages"] = []
  for (const [index, message] of messages.entries()) {
    rebuilt.push(message)
    if (message.role !== "user" || isGuidance(message) || isThirdRequestReminder(message)) continue
    const text = messageText(message)
    if (!text.trim() || isGuidance(messages[index + 1])) continue
    const guide = isComplexTask(text) ? GUIDE_DEEP : GUIDE_WEAK
    rebuilt.push({
      role: "user",
      content: [{ type: "text", text: guide }],
      metadata: { dshGodmodeGuide: true, userMessageID: message.id },
    })
  }
  messages.splice(0, messages.length, ...rebuilt)
}
