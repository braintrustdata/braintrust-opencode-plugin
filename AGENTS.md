# Development Guide

## Setup

1. Install dependencies and build the plugin:
   ```bash
   ./install.sh
   ```

2. Set required environment variables:
   ```bash
   export BRAINTRUST_API_KEY='your-api-key'
   export BRAINTRUST_PROJECT='your-project-name'  # traces will be logged here
   export BRAINTRUST_DEBUG=true                   # optional: enables debug logging
   ```

## Dev Loop

### Running unit tests

```bash
bun test
```

### Running an end-to-end test

Run a simple opencode command to generate a trace:

```bash
./install.sh && BRAINTRUST_DEBUG=true opencode run -m anthropic/claude-3-haiku-20240307 "say hello and nothing else"
```

Use the Braintrust MCP tools to query the project logs. First resolve the project ID:

```
braintrust_query_logs: SELECT DISTINCT project_id FROM logs LIMIT 1
```

Then query for recent root spans (traces):

```
braintrust_query_logs: SELECT id, created, span_id, root_span_id, is_root, span_attributes FROM logs WHERE is_root = true ORDER BY created DESC LIMIT 5
```

To see all spans in a specific trace, use the `root_span_id`:

```
braintrust_query_logs: SELECT id, created, span_id, span_parents, span_attributes, input, output, metrics FROM logs WHERE root_span_id = '<root_span_id>' ORDER BY created ASC
```

## Project Structure

- `src/index.ts` - Plugin entry point, hooks registration
- `src/tracing.ts` - Tracing hooks implementation (session, turn, tool spans)
- `src/client.ts` - Braintrust API client
- `src/tools.ts` - Braintrust query tools exposed to OpenCode

## Trace Hierarchy

The plugin creates spans in this structure:

```
Session (root span)
  - Turn 1 (task span for user message)
    - Tool call (tool span)
    - Tool call (tool span)
  - Turn 2
    - Tool call
  ...
```

## Key Files

- `src/tracing.ts:113-136` - Root span creation (session.created event)
- `src/tracing.ts:280-348` - Turn span creation (chat.message hook)
- `src/tracing.ts:357-394` - Tool span creation (tool.execute.after hook)

## Debug Logs

OpenCode writes debug logs to `~/.local/share/opencode/log/`. When `BRAINTRUST_DEBUG=true`, the plugin logs tracing events there which can help diagnose issues.
