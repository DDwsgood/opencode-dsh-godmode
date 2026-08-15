// opencode-dsh-godmode — OpenCode V2 server plugin.
//
// For main-loop model steps whose model id or provider string exactly contains
// `deepseek-v4-pro` or `deepseek-v4-flash`, the "context" session hook replaces
// the entire system prompt with that model's static DeepSeek Harness persona,
// bootstraps one shell tool, and applies model-specific post-bootstrap routing.

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
    synthetic(input: {
      sessionID: string
      text: string
      description?: string
      metadata?: Record<string, unknown>
      resume?: boolean
    }): Promise<unknown>
  }
}

// The generated-prefix anchor follows dsh-router-standard P15: once the model
// generates "We need", autoregressive continuation keeps the intended register.
export const BOOTSTRAP_TOOL = "shell"
export const PRO_RESIDENT_TOOLS = new Set(["shell", "edit", "read", "glob", "execute"])
export const THINKING_HINT = "When you thought, thought in ENGLISH and starts with 'we need'"
export const TURN_GUIDANCE =
  'Router: classify this task (build or fix), then adopt the matching style — build: direct production; fix: inspect first. Think deeply about architecture, edge cases, and integration points, then commit and act. Start the next reasoning block with the exact words "We need". Additional tools, including MCP tools, are discoverable only when needed through execute; inside its code call search({ query: "..." }) before using an undisclosed tool.'

// Pro base persona — DeepSeek Harness "anchored-standard" preset persona row.
export const PRO_PROMPT =
  "You are a helpful software engineer assistant.\n" + THINKING_HINT

// Flash prompt — DeepSeek Harness "router-standard" weak-flash persona
// (dsh-router-standard/preset/router-core.mjs, WEAK_FLASH); the base is verbatim.
export const FLASH_PROMPT =
  "You are a helpful assistant.\n" +
  "Before acting, decide the task type (build or fix) and adopt the matching " +
  "style: build → hands-on production; fix → inspect-and-plan.\n" +
  "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n" +
  THINKING_HINT

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
}): string | null {
  if (!model) return null
  if (containsToken(model.id, PRO_TOKEN)) return PRO_PROMPT
  if (containsToken(model.id, FLASH_TOKEN)) return FLASH_PROMPT
  if (containsToken(model.providerID, PRO_TOKEN)) return PRO_PROMPT
  if (containsToken(model.providerID, FLASH_TOKEN)) return FLASH_PROMPT
  return null
}

export default {
  id: "opencode-dsh-godmode",
  setup(ctx: SetupContext): void {
    const admittedGuides = new Set<string>()
    // The "context" hook fires once per main-loop model step (title generation
    // and compaction do not trigger it), so no internal-call skip is needed.
    ctx.session.hook("context", async (event) => {
      const text = promptForModel(event.model)
      if (text === null) return
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
      const guidanceIndex = event.messages.findLastIndex(isGuidance)
      const userIndex = event.messages.findLastIndex((message) => message.role === "user" && !isGuidance(message))
      if (userIndex <= guidanceIndex) return

      const user = event.messages[userIndex]
      const key = user?.id ?? `${event.sessionID}:${userIndex}`
      if (!admittedGuides.has(key)) {
        admittedGuides.add(key)
        await ctx.session.synthetic({
          sessionID: event.sessionID,
          text: TURN_GUIDANCE,
          description: "DSH routing guidance",
          metadata: {
            source: "opencode-dsh-godmode",
            ...(user?.id ? { userMessageID: user.id } : {}),
          },
          resume: false,
        })
      }
      // The durable synthetic input becomes visible at the next safe boundary;
      // mirror it only for this first request so routing applies immediately.
      event.messages.push({
        role: "user",
        content: [{ type: "text", text: TURN_GUIDANCE }],
        metadata: { dshGodmodeGuide: true },
      })
    })
  },
}

function isGuidance(message: ContextEvent["messages"][number]) {
  return message.content?.some((part) => part.type === "text" && part.text === TURN_GUIDANCE) === true
}
