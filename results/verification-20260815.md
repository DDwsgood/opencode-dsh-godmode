# Verification — 2026-08-15

## Long-task regression

The final configuration was tested with the same prompt as the reported failing
session:

> 在本文件夹构建一个3d Minecraft游戏。尽量还原和详细。不要出错。随意使用任何工具。不要用子代理

Model: `opencode-go/deepseek-v4-pro#max`.

### Single conditional run

- Session ID omitted from the published report
- Two-minute gate: `We need` 7, `Let me` 0, no `The user wants` opening
- The same run was therefore continued to five minutes
- Runtime before API interrupt: 301 seconds
- Reasoning blocks: 4
- Tool calls: 4 × `shell`
- No block began with `The user wants`
- Total fingerprint: `We need` 12, `Let me` 0
- Final block: `Let me` 0; neutral `Now noise.js...` opening
- Durable guidance messages: exactly 1
- Tokens: input 4,451; cache read 21,120
- Aggregate cache-read ratio: 82.6%

The interrupted run did not fall back to `Let me` or `The user wants`. The
persisted guidance appeared once in the exported session rather than being
recreated at every model step.

## MCP discovery

An additional session verified Pro's on-demand discovery path.
After the shell bootstrap, the model used `execute` and its built-in `search`
without invoking any MCP operation. It found:

- `chrome-devtools`: 24 tools
- `markitdown`: 1 tool
- `pymupdf`: 1 tool

This keeps MCP capabilities available without placing their complete schemas in
the Pro request up front.

## Mechanism

- Pro: first request exposes only `shell`; promoted requests retain the anchored
  `shell`/`edit`/`read`/`glob`/`execute` resident set, with `execute.search` for
  MCP discovery. Other operations use `shell`.
- Flash: first request exposes only `shell`; promoted requests restore the full
  API tool record, matching routing-suite's catalog-insensitive Flash path.
- Both: system prompt is one small static part on every request; dynamic OpenCode
  system sections are not restored.
- A fixed routing-suite-style guide is durably admitted once per real user turn
  and mirrored only into that turn's first request before durable promotion.
- No prompt prohibits `Let me`.
