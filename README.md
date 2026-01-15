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

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/braintrustdata/opencode-braintrust
cd opencode-braintrust
./install.sh

# 2. Set your API key
export BRAINTRUST_API_KEY="your-api-key"
export TRACE_TO_BRAINTRUST="true"

# 3. Run OpenCode
opencode

# 4. View traces at:
# https://www.braintrust.dev/app/projects/opencode/logs
```

## Installation

### Option 1: Quick Install (Recommended)

```bash
git clone https://github.com/braintrustdata/opencode-braintrust
cd opencode-braintrust
./install.sh
```

### Option 2: Install from npm (when published)

Add to your OpenCode configuration (`opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-braintrust"]
}
```

### Option 3: Manual Installation

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
export TRACE_TO_BRAINTRUST="true"              # Enable/disable tracing (default: false)
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

## Troubleshooting

### Plugin not loading / class constructor error

If you see an error like `Cannot call a class constructor without |new|`:

1. Make sure you're using the latest build:
   ```bash
   cd /path/to/opencode-braintrust
   bun run build
   cp dist/index.js ~/.config/opencode/plugin/braintrust.js
   ```

2. Or reinstall using the install script:
   ```bash
   ./install.sh
   ```

### No traces appearing in Braintrust

1. Check that your API key is set:
   ```bash
   echo $BRAINTRUST_API_KEY
   ```

2. Enable debug mode to see what's happening:
   ```bash
   export BRAINTRUST_DEBUG=true
   opencode
   ```

3. Check OpenCode logs for errors

4. Verify the plugin is loaded:
   - Plugin should log "Braintrust plugin initialized" when OpenCode starts

### Tools not working

If the Braintrust tools aren't available to the AI:

1. Make sure `BRAINTRUST_API_KEY` is set
2. Check that the plugin loaded successfully
3. Try asking: "What tools do you have access to?"

### API connection errors

If you see connection errors:

1. Check your internet connection
2. Verify your API key is valid at https://www.braintrust.dev/app/settings
3. Check if there's a firewall blocking `api.braintrust.dev`

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
