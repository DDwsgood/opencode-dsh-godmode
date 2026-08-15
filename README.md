# opencode-dsh-godmode

An [OpenCode V2](https://opencode.ai/v2/docs) server plugin that anchors **DeepSeek V4 Pro/Flash** with static DSH prompts and model-specific tool routing.

## What it does

The plugin registers the `ctx.session.hook("context", ...)` hook, which OpenCode V2 fires once per main-loop model step (title generation and compaction do **not** trigger it). For an event whose **model id or provider string exactly contains** `deepseek-v4-pro` or `deepseek-v4-flash`, it **completely replaces `event.system`** with a single system part holding the model's prompt.

The first model request exposes only OpenCode's `shell` tool. After promotion, Flash receives the complete host API tool record, while Pro follows anchored-standard and remains on the stable `shell`/`edit`/`read`/`glob`/`execute` resident set; other basic operations remain available through `shell`. `execute` retains on-demand discovery through `search`, including all connected MCP tools, without placing their full schemas in the Pro request. The system remains one small, static persona plus the verified hint `When you thought, thought in ENGLISH and starts with 'we need'`; no dynamic environment, instructions, Code Mode catalog, or near-field system message is appended. Following routing-suite P14/P15, one fixed user-role guide is durably admitted once per real user turn. It is mirrored only into that turn's first request while the durable synthetic message awaits promotion, then reused from session history on later model steps. Neither prompt bans `Let me`.

### Prompt bases

**Pro** — from the DeepSeek Harness `anchored-standard` preset
(`dsh-anchored-standard/preset/agent.cordis.yml`, `persona` row with `complete: true`):

```
You are a helpful software engineer assistant.
When you thought, thought in ENGLISH and starts with 'we need'
```

**Flash** — from the DeepSeek Harness `router-standard` weak-flash persona
(`dsh-router-standard/preset/router-core.mjs`, `WEAK_FLASH`):

```
You are a helpful assistant.
Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.
Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.
When you thought, thought in ENGLISH and starts with 'we need'
```

The source persona text remains unchanged and the same short thinking hint is appended. No instruction bans `Let me`.

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
    "opencode-dsh-godmode@0.1.0"
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

The unit tests use only Node's built-in test runner and assert module. They verify exact prompt composition, first-request shell bootstrap, Pro's resident tool set, Flash's post-bootstrap full catalog, static system replacement, near-field guidance, model matching, and non-target isolation.

## License & sources

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The two prompts are reproduced from DeepSeek Harness sources that are themselves MIT-licensed (`dsh-anchored-standard` and `dsh-router-standard`); attribution is in [NOTICE](NOTICE).
