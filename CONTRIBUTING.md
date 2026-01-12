# Contributing to opencode-braintrust

Thank you for your interest in contributing! This document provides guidelines for developing and testing the plugin.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/braintrustdata/opencode-braintrust
   cd opencode-braintrust
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your BRAINTRUST_API_KEY
   ```

4. **Build the plugin**
   ```bash
   bun run build
   ```

## Development Workflow

### Building

```bash
# Build once
bun run build

# Watch mode (rebuilds on file changes)
bun run dev
```

### Type Checking

```bash
bun run typecheck
```

### Testing Locally with OpenCode

To test your changes with OpenCode:

```bash
# Option 1: Use the dist directory directly
opencode --plugin-dir ./dist

# Option 2: Copy to your local plugins directory
cp dist/index.js ~/.config/opencode/plugin/braintrust.js
```

## Project Structure

```
src/
├── index.ts       # Main plugin entry point
├── client.ts      # Braintrust API client
├── tracing.ts     # Session tracing hooks
└── tools.ts       # Braintrust tools for the AI

dist/              # Build output (generated)
└── index.js       # Bundled plugin
```

## Key Components

### 1. Plugin Entry (`src/index.ts`)

The main plugin export that:
- Initializes the Braintrust client
- Registers tracing hooks if enabled
- Registers custom tools

### 2. Braintrust Client (`src/client.ts`)

Handles:
- API URL discovery via login endpoint
- Project creation/retrieval
- Span insertion
- SQL query execution

### 3. Tracing Hooks (`src/tracing.ts`)

Implements OpenCode plugin hooks:
- `event`: Listens to session lifecycle events
- `chat.message`: Captures user messages and creates turn spans
- `tool.execute.before/after`: Records tool executions

### 4. Tools (`src/tools.ts`)

Defines custom tools available to the AI:
- `braintrust_query_logs`: Execute SQL queries
- `braintrust_list_projects`: List projects
- `braintrust_log_data`: Manually log data
- `braintrust_get_experiments`: View experiments

## Adding New Features

### Adding a New Tool

1. Add the tool definition in `src/tools.ts`:

```typescript
braintrust_your_tool: tool({
  description: "Description of what your tool does",
  args: {
    param1: tool.schema.string().describe("Parameter description"),
  },
  async execute(args) {
    // Tool implementation
    return "result"
  },
})
```

2. Use the `BraintrustClient` methods to interact with the API
3. Build and test

### Adding a New Hook

1. Add the hook in `src/tracing.ts` within `createTracingHooks()`:

```typescript
"hook.name": async (input, output) => {
  // Hook implementation
}
```

2. Update span data as needed
3. Build and test

## Testing

### Manual Testing

1. Build the plugin
2. Set `BRAINTRUST_DEBUG=true` to see detailed logs
3. Run OpenCode with your plugin
4. Check Braintrust for traces
5. Try using the tools in a conversation

### Testing Tracing

Start a session and verify:
- Session span is created with metadata
- Turn spans are created for each user message
- Tool spans are created for tool executions
- Spans have proper parent-child relationships

### Testing Tools

In an OpenCode session, try:
- "Query my Braintrust logs for the last 10 entries"
- "What projects do I have in Braintrust?"
- "Log this data to Braintrust with a score of 0.9"

## Code Style

- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Use async/await for asynchronous code
- Handle errors gracefully with try/catch
- Log debug information when `config.debug` is true

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create a git tag
4. Push to GitHub
5. Publish to npm: `npm publish`

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues and PRs
- Refer to [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins/)
- Refer to [Braintrust Documentation](https://braintrust.dev/docs)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
