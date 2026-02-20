# @braintrust/trace-opencode

Braintrust tracing plugin for [OpenCode](https://opencode.ai). Automatically traces your OpenCode sessions to Braintrust with hierarchical spans.

- **Session spans**: Root span for each OpenCode session with metadata (workspace, hostname, etc.)
- **Turn spans**: Captures each user-assistant interaction
- **Tool spans**: Records individual tool executions with inputs and outputs

## Quick Start

Add to your OpenCode configuration (`opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["@braintrust/trace-opencode"]
}
```

Then,

```bash
# Set your API key
export BRAINTRUST_API_KEY="your-api-key"
export TRACE_TO_BRAINTRUST="true"

# Run OpenCode
opencode

# View traces at:
# https://www.braintrust.dev/app/projects/opencode/logs
```

## Configuration

You can configure the plugin using a config file or environment variables.

### Config File

Create a `braintrust.json` file in one of these locations:

- `.opencode/braintrust.json` - Project-level config
- `~/.config/opencode/braintrust.json` - Global config

```json
{
  "trace_to_braintrust": true,
  "project": "my-project",
  "api_key": "your-api-key",
  "debug": true
}
```

### Config Options

| Config Key | Env Var | Type | Default | Description |
|------------|---------|------|---------|-------------|
| `trace_to_braintrust` | `TRACE_TO_BRAINTRUST` | boolean | `false` | Enable/disable tracing |
| `project` | `BRAINTRUST_PROJECT` | string | `"opencode"` | Project name for traces |
| `debug` | `BRAINTRUST_DEBUG` | boolean | `false` | Enable debug logging |
| `api_key` | `BRAINTRUST_API_KEY` | string | | API key for authentication |
| `api_url` | `BRAINTRUST_API_URL` | string | `"https://api.braintrust.dev"` | API URL |
| `app_url` | `BRAINTRUST_APP_URL` | string | `"https://www.braintrust.dev"` | App URL |
| `org_name` | `BRAINTRUST_ORG_NAME` | string | | Organization name |
| `additional_metadata` | `BRAINTRUST_ADDITIONAL_METADATA` | string | | JSON object of additional metadata to attach to the root span. Standard metadata keys take precedence on conflict. |

### Precedence

Configuration is loaded with the following precedence (later overrides earlier):

1. Default values
2. `~/.config/opencode/braintrust.json` (global config)
3. `.opencode/braintrust.json` (project config)
4. Environment variables (highest priority)

## Adding Dynamic Metadata

Use `BRAINTRUST_ADDITIONAL_METADATA` to attach custom key-value pairs to the root span. This is useful for tagging traces in CI or linking them back to a specific run.

```bash
BRAINTRUST_ADDITIONAL_METADATA='{"ci": true, "run_id": "abc-123"}' opencode run "do the thing"
```

You can also set it via the config file:

```json
{
  "additional_metadata": {
    "team": "platform"
  }
}
```

The value must be a JSON object. Any keys that conflict with standard root span metadata (`session_id`, `workspace`, `directory`, `hostname`, `username`, `os`) will be overridden by the standard values.

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
