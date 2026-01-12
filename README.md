# opencode-braintrust

Braintrust integration plugin for [OpenCode](https://opencode.ai). Provides automatic session tracing and data access tools for your Braintrust workspace.

## Features

### 1. Automatic Session Tracing

Traces your OpenCode sessions to Braintrust with hierarchical spans:

- **Session spans**: Root span for each OpenCode session with metadata (workspace, hostname, etc.)
- **Turn spans**: Captures each user-assistant interaction
- **Tool spans**: Records individual tool executions with inputs and outputs

### 2. Braintrust Data Access Tools

Custom tools available to the AI assistant:

- `braintrust_query_logs`: Execute SQL queries against your Braintrust logs
- `braintrust_list_projects`: List all projects in your organization
- `braintrust_log_data`: Manually log data for evaluation or tracking
- `braintrust_get_experiments`: View recent experiments

## Installation

### Option 1: Install from npm

Add to your OpenCode configuration (`opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-braintrust"]
}
```

### Option 2: Install from source

1. Clone this repository
2. Build the plugin:
   ```bash
   bun install
   bun run build
   ```
3. Copy to your plugin directory:
   ```bash
   cp dist/index.js ~/.config/opencode/plugin/braintrust.js
   ```

## Configuration

Set the following environment variables:

```bash
# Required
export BRAINTRUST_API_KEY="your-api-key"

# Optional
export BRAINTRUST_PROJECT="opencode"           # Project name (default: "opencode")
export BRAINTRUST_TRACING="true"               # Enable/disable tracing (default: true)
export BRAINTRUST_DEBUG="false"                # Enable debug logging (default: false)
export BRAINTRUST_APP_URL="https://www.braintrust.dev"  # Braintrust app URL
export BRAINTRUST_ORG_NAME="your-org"          # Organization name (if multiple orgs)
```

Alternatively, create a `.env` file in your project directory:

```env
BRAINTRUST_API_KEY=your-api-key
BRAINTRUST_PROJECT=my-project
```

## Usage

### Viewing Traces

Once configured, your OpenCode sessions will automatically appear in your Braintrust project. Visit:

```
https://www.braintrust.dev/app/projects/<your-project>/logs
```

### Using Data Access Tools

The AI assistant can use Braintrust tools directly:

**Query logs:**
```
Can you show me the last 10 logs from Braintrust?
```

**Log data for evaluation:**
```
Log this output to Braintrust with a score of 0.9 for accuracy
```

**List projects:**
```
What Braintrust projects do I have access to?
```

### SQL Query Examples

The `braintrust_query_logs` tool supports Braintrust's SQL dialect:

```sql
-- Recent logs
SELECT * FROM logs ORDER BY created DESC LIMIT 10

-- Logs with low scores
SELECT * FROM logs WHERE scores.Factuality < 0.5

-- Logs from the last hour
SELECT * FROM logs WHERE created > now() - interval 1 hour

-- Search by metadata
SELECT * FROM logs WHERE metadata.task_type = 'code_review'
```

## Trace Structure

Sessions are traced with the following hierarchy:

```
Session (task span)
├── metadata: session_id, workspace, hostname, username, os
├── Turn 1 (task span)
│   ├── input: "user message"
│   ├── metadata: turn_number, agent, model
│   ├── Tool 1 (tool span)
│   │   ├── input: tool arguments
│   │   └── output: tool result
│   └── Tool 2 (tool span)
├── Turn 2 (task span)
│   └── ...
└── metrics: total_turns, total_tool_calls
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run typecheck

# Run locally with OpenCode
opencode --plugin-dir ./dist
```

## API Reference

### BraintrustPlugin

The main plugin export. Automatically initializes when OpenCode loads.

### BraintrustClient

Low-level client for Braintrust API:

```typescript
import { BraintrustClient, loadConfig } from "opencode-braintrust"

const client = new BraintrustClient(loadConfig())
await client.initialize()

// Insert a span
await client.insertSpan({
  id: "...",
  span_id: "...",
  root_span_id: "...",
  input: "...",
  output: "...",
})

// Query logs
const results = await client.queryLogs("SELECT * FROM logs LIMIT 10")
```

## License

MIT

## Related

- [Braintrust](https://braintrust.dev) - AI evaluation and observability platform
- [OpenCode](https://opencode.ai) - AI-powered coding assistant
- [braintrust-skill](https://github.com/braintrustdata/braintrust-claude-plugin) - Similar plugin for Claude Code
