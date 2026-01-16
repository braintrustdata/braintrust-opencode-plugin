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

## Configuration

You can configure the plugin in your `opencode.json`:

```json
{
  "braintrust": {
    "trace_to_braintrust": true
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trace_to_braintrust` | boolean | `false` | Enable/disable tracing to Braintrust |

### Environment Variable Override

Set `TRACE_TO_BRAINTRUST=true` to enable tracing:

```bash
TRACE_TO_BRAINTRUST=true opencode
```

## Dev Loop

### Running unit tests

```bash
bun test
```

### Running end-to-end tests

#### Happy path (successful session)

Run a simple opencode command to generate a trace:

```bash
./install.sh && TRACE_TO_BRAINTRUST=true BRAINTRUST_DEBUG=true opencode run -m anthropic/claude-3-haiku-20240307 "say hello and nothing else"
```

#### Error path (session error)

Trigger a session error by using an invalid API key:

```bash
./install.sh && ANTHROPIC_API_KEY=invalid-key TRACE_TO_BRAINTRUST=true BRAINTRUST_DEBUG=true opencode run -m anthropic/claude-3-haiku-20240307 "say hello" 2>&1 || true
```

Check the debug logs for session.error handling:

```bash
grep "session.error\|Handling session error\|Session error handled" ~/.local/share/opencode/log/*.log | tail -10
```

#### Verifying traces in Braintrust

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

To find spans with errors:

```
braintrust_query_logs: SELECT id, created, error, span_attributes FROM logs WHERE error IS NOT NULL ORDER BY created DESC LIMIT 5
```

## Project Structure

- `src/index.ts` - Plugin entry point, hooks registration
- `src/tracing.ts` - Tracing hooks implementation (session, turn, tool spans, error handling)
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

## Debug Logs

OpenCode writes debug logs to `~/.local/share/opencode/log/`. When `BRAINTRUST_DEBUG=true`, the plugin logs tracing events there which can help diagnose issues.
