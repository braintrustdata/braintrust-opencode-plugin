# Examples

This directory contains example configurations and usage patterns for the opencode-braintrust plugin.

## Configuration

### Basic Setup (`opencode.json`)

Copy the example configuration to your project:

```bash
cp examples/opencode.json .opencode/opencode.json
```

Or add to your global config:

```bash
cp examples/opencode.json ~/.config/opencode/opencode.json
```

### Environment Variables

Create a `.env` file in your project root:

```bash
cp .env.example .env
```

Edit `.env` and add your Braintrust API key.

## Usage Examples

### 1. Automatic Tracing

Simply use OpenCode as normal - all sessions will be automatically traced to Braintrust:

```bash
opencode
```

Your traces will appear at: `https://www.braintrust.dev/app/projects/opencode/logs`

### 2. Querying Logs

In an OpenCode session:

**User:** "Show me the last 10 logs from Braintrust"

**Assistant:** *Uses `braintrust_query_logs` tool*

**User:** "Show me all logs from the last hour with low factuality scores"

**Assistant:** *Executes SQL query with appropriate filters*

### 3. Manual Logging

**User:** "I want to log this conversation summary to Braintrust with a quality score"

**Assistant:** *Uses `braintrust_log_data` tool to record the data*

### 4. Project Management

**User:** "What Braintrust projects do I have access to?"

**Assistant:** *Uses `braintrust_list_projects` tool*

## Advanced Usage

### Custom Project Name

Set a custom project name in your `.env`:

```bash
BRAINTRUST_PROJECT=my-awesome-project
```

### Disable Tracing

To use only the data access tools without automatic tracing:

```bash
BRAINTRUST_TRACING=false
```

### Debug Mode

Enable debug logging to see detailed trace information:

```bash
BRAINTRUST_DEBUG=true
```

### Multiple Organizations

If you belong to multiple Braintrust organizations:

```bash
BRAINTRUST_ORG_NAME=my-org
```

## SQL Query Examples

### Recent Logs

```sql
SELECT * FROM logs
ORDER BY created DESC
LIMIT 10
```

### Logs with Scores

```sql
SELECT id, input, output, scores
FROM logs
WHERE scores.Factuality < 0.5
```

### Time-Based Queries

```sql
SELECT * FROM logs
WHERE created > now() - interval 1 hour
```

### Metadata Filtering

```sql
SELECT * FROM logs
WHERE metadata.task_type = 'code_review'
  AND scores.accuracy > 0.8
```

### Aggregations

```sql
SELECT
  day(created) as date,
  count(*) as total_logs,
  avg(scores.Factuality) as avg_factuality
FROM logs
WHERE created > now() - interval 7 day
GROUP BY day(created)
ORDER BY date DESC
```

## Viewing Traces

### In Braintrust UI

1. Go to https://www.braintrust.dev
2. Navigate to your project
3. Click on "Logs" tab
4. Browse your OpenCode sessions

### Trace Structure

```
Session
├── metadata: session_id, workspace, hostname
├── Turn 1
│   ├── input: "user message"
│   ├── Tool: read
│   │   └── output: file contents
│   └── Tool: write
│       └── output: file path
└── Turn 2
    └── ...
```

## Troubleshooting

### Plugin Not Loading

Check OpenCode logs:
```bash
opencode --verbose
```

### Traces Not Appearing

1. Verify API key is set: `echo $BRAINTRUST_API_KEY`
2. Enable debug mode: `BRAINTRUST_DEBUG=true`
3. Check the logs for errors
4. Verify project exists in Braintrust

### Tool Errors

If tools fail:
1. Check API key permissions
2. Verify project access
3. Check SQL query syntax
4. Enable debug mode for detailed error messages
