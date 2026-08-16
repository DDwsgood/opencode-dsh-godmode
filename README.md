# opencode-dsh-godmode

An [OpenCode V2](https://opencode.ai/v2/docs) server plugin that anchors **DeepSeek V4 Pro/Flash** with DSH personas and model-specific tool routing.

## What it does

The plugin registers the `ctx.session.hook("context", ...)` hook, which OpenCode V2 fires once per main-loop model step (title generation and compaction do **not** trigger it). For an event whose **model id or provider string exactly contains** `deepseek-v4-pro` or `deepseek-v4-flash`, it **completely replaces `event.system`** with a single system part holding the model's prompt.

The first model request exposes only OpenCode's `shell` tool. After promotion, Flash receives the complete host API tool record, while Pro follows anchored-standard and remains on the stable `shell`/`edit`/`read`/`glob`/`execute` resident set; other basic operations remain available through `shell`. `execute` retains on-demand discovery through `search`, including all connected MCP tools, without placing their full schemas in the Pro request. Pro keeps the verified hint `When you thought, thought in ENGLISH and starts with 'we need'`. Flash instead follows router-standard exactly: a zero-call keyword classifier routes the session's first user-role message to the spec, react, or weak persona, and only weak sessions receive the original depth-adaptive routing guide. The guide is reconstructed immediately after each user-role message in every outbound model context; it is never admitted to the session inbox, so it cannot wake the model or create an extra step. Pro receives the request-local discovery reminder `<system_reminder>Tools: execute -> search({}) -> tools. Skills: cwd/.agents/skills, $HOME/.agents/skills.</system_reminder>` only on the session's third model request; Flash never receives it. Neither Flash persona bans or penalizes `Let me`.

### Prompt bases

**Pro** — from the DeepSeek Harness `anchored-standard` preset
(`dsh-anchored-standard/preset/agent.cordis.yml`, `persona` row with `complete: true`):

```
You are a helpful software engineer assistant.
When you thought, thought in ENGLISH and starts with 'we need'
```

**Flash** — selected from the DeepSeek Harness `router-standard` personas by the first user-role message. Clear fix tasks use the spec persona, clear build tasks use the react persona, and unmatched or tied tasks use the weak-flash persona (`dsh-router-standard/preset/router-core.mjs`):

```
spec:
You are a helpful software engineer assistant.

react:
You are a hands-on software engineer who delivers working output fast.
Work directly: write or edit code, then verify it by reading and running. Keep the loop tight — produce, verify, fix — and do not build test harnesses, scaffolding, or ceremony the user did not ask for. Finish with a usable deliverable and a short summary.

weak:
You are a helpful assistant.
Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.
Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.
```

The Flash persona text remains verbatim. The Pro-only thinking hint is not appended, and `Let me` is not treated as a quality failure.

### Matching rule

A token **exactly occurs** when it is bounded on both sides by a non-alphanumeric character or the string edge (case-insensitive). This means:

| model id | matches |
|---|---|
| `deepseek-v4-pro` | ✅ Pro |
| `deepseek-v4-flash` | ✅ Flash |
| `deepseek-v4-pro-260425` | ✅ Pro (a `-` is a boundary, so a version suffix is the same family) |
| `deepseek-v4-flash-260425` | ✅ Flash |
| `deepseek-v4-prototype` | ❌ no — `pro` is immediately followed by `totype`, so the token is only a prefix of a longer name |
| `deepseek-v4-flasher` | ❌ no (same reason) |
| `gpt-4o`, `claude-sonnet-4`, `deepseek-v3` | ❌ no |

The check runs against both `event.model.id` and `event.model.providerID`.

## Install

Add the npm package to the `plugins` array in your `opencode.json` or global OpenCode configuration:

```jsonc
{
  "plugins": [
    "opencode-dsh-godmode@0.1.3"
  ]
}
```

OpenCode installs package plugins and their production dependencies in its isolated cache. This package has no runtime dependencies.

For local development, reference the checked-out entry file with an absolute path or a path relative to the configuration file:

```jsonc
{
  "plugins": ["./opencode-dsh-godmode/src/index.ts"]
}
```

## Run the tests

```sh
cd opencode-dsh-godmode
npm test            # node --test test/index.test.mjs
```

The unit tests use only Node's built-in test runner and assert module. They verify exact personas and routing guidance, zero-call task classification, deterministic request-local guidance placement, absence of guidance without a user-role message, first-request shell bootstrap, Pro's resident tool set, Flash's post-bootstrap full catalog, the request-local third-request reminder, model matching, and non-target isolation.

## License & sources

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The two prompts are reproduced from DeepSeek Harness sources that are themselves MIT-licensed (`dsh-anchored-standard` and `dsh-router-standard`); attribution is in [NOTICE](NOTICE).
