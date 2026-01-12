/**
 * Tracing hooks for OpenCode sessions
 *
 * Creates hierarchical spans in Braintrust:
 * - Session (root span)
 *   - Turn (task span for each user message)
 *     - Tool calls (tool spans)
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { BraintrustClient, BraintrustConfig, SpanData } from "./client"

// Generate a UUID
function generateUUID(): string {
  return crypto.randomUUID()
}

// State management for tracing
interface SessionState {
  rootSpanId: string
  currentTurnSpanId?: string
  turnNumber: number
  toolCallCount: number
  startTime: number
}

const sessionStates = new Map<string, SessionState>()

/**
 * Create tracing hooks for Braintrust
 */
export function createTracingHooks(
  client: BraintrustClient,
  input: PluginInput,
  config: BraintrustConfig
): Partial<Hooks> {
  const debug = config.debug

  const log = (msg: string, data?: unknown) => {
    if (debug) {
      console.log(`[braintrust-trace] ${msg}`, data ? JSON.stringify(data) : "")
    }
  }

  return {
    // Listen to all events for session lifecycle
    event: async ({ event }: { event: Event }) => {
      const sessionID =
        "sessionID" in event.properties
          ? (event.properties as { sessionID?: string }).sessionID
          : undefined

      if (event.type === "session.created" && sessionID) {
        log("Session created", { sessionID })

        // Create root span for session
        const rootSpanId = generateUUID()
        const state: SessionState = {
          rootSpanId,
          turnNumber: 0,
          toolCallCount: 0,
          startTime: Date.now(),
        }
        sessionStates.set(sessionID, state)

        const span: SpanData = {
          id: generateUUID(),
          span_id: rootSpanId,
          root_span_id: rootSpanId,
          metadata: {
            session_id: sessionID,
            workspace: input.worktree,
            directory: input.directory,
            hostname: getHostname(),
            username: getUsername(),
            os: getOS(),
          },
          metrics: {
            start: state.startTime,
          },
          span_attributes: {
            name: `OpenCode Session`,
            type: "task",
          },
        }

        await client.insertSpan(span)
        log("Created root span", { rootSpanId })
      }

      if (event.type === "session.deleted" && sessionID) {
        log("Session ended", { sessionID })
        const state = sessionStates.get(sessionID)
        if (state) {
          // Update root span with end time
          const span: SpanData = {
            id: generateUUID(),
            span_id: state.rootSpanId,
            root_span_id: state.rootSpanId,
            metrics: {
              start: state.startTime,
              end: Date.now(),
            },
            metadata: {
              total_turns: state.turnNumber,
              total_tool_calls: state.toolCallCount,
            },
            span_attributes: {
              name: `OpenCode Session`,
              type: "task",
            },
          }
          await client.insertSpan(span)
          sessionStates.delete(sessionID)
        }
      }
    },

    // Create turn span when user sends a message
    "chat.message": async (messageInput, output) => {
      const { sessionID } = messageInput
      log("Chat message", { sessionID })

      const state = sessionStates.get(sessionID)
      if (!state) {
        log("No state found for session", { sessionID })
        return
      }

      // Finalize previous turn if exists
      if (state.currentTurnSpanId) {
        const prevTurnSpan: SpanData = {
          id: generateUUID(),
          span_id: state.currentTurnSpanId,
          root_span_id: state.rootSpanId,
          span_parents: [state.rootSpanId],
          metrics: {
            end: Date.now(),
          },
          span_attributes: {
            name: `Turn ${state.turnNumber}`,
            type: "task",
          },
        }
        await client.insertSpan(prevTurnSpan)
      }

      // Create new turn span
      state.turnNumber++
      state.currentTurnSpanId = generateUUID()

      const userMessage =
        output.parts
          ?.filter((p) => p.type === "text")
          .map((p) => (p as { text?: string }).text)
          .join("\n") || ""

      const turnSpan: SpanData = {
        id: generateUUID(),
        span_id: state.currentTurnSpanId,
        root_span_id: state.rootSpanId,
        span_parents: [state.rootSpanId],
        input: userMessage,
        metadata: {
          turn_number: state.turnNumber,
          agent: messageInput.agent,
          model: messageInput.model,
        },
        metrics: {
          start: Date.now(),
        },
        span_attributes: {
          name: `Turn ${state.turnNumber}`,
          type: "task",
        },
      }

      await client.insertSpan(turnSpan)
      log("Created turn span", { turnNumber: state.turnNumber })
    },

    // Track tool executions
    "tool.execute.before": async (toolInput, output) => {
      const { tool, sessionID, callID } = toolInput
      log("Tool execute before", { tool, sessionID, callID })
      // We can store timing info here if needed
    },

    "tool.execute.after": async (toolInput, result) => {
      const { tool, sessionID, callID } = toolInput
      log("Tool execute after", { tool, sessionID, callID })

      const state = sessionStates.get(sessionID)
      if (!state || !state.currentTurnSpanId) {
        log("No state or turn for tool", { sessionID })
        return
      }

      state.toolCallCount++

      // Create tool span
      const toolSpanId = generateUUID()
      const toolSpan: SpanData = {
        id: generateUUID(),
        span_id: toolSpanId,
        root_span_id: state.rootSpanId,
        span_parents: [state.currentTurnSpanId],
        input: result.metadata,
        output: result.output.substring(0, 10000), // Truncate large outputs
        metadata: {
          tool_name: tool,
          call_id: callID,
          title: result.title,
        },
        metrics: {
          end: Date.now(),
        },
        span_attributes: {
          name: formatToolName(tool, result.title),
          type: "tool",
        },
      }

      await client.insertSpan(toolSpan)
      log("Created tool span", { tool, callID })
    },
  }
}

/**
 * Format a descriptive tool name
 */
function formatToolName(tool: string, title?: string): string {
  if (title) {
    // Truncate long titles
    const shortTitle = title.length > 50 ? title.substring(0, 47) + "..." : title
    return `${tool}: ${shortTitle}`
  }
  return tool
}

/**
 * Get system information
 */
function getHostname(): string {
  try {
    // Use Bun's API instead of Node's os module
    return Bun.hostname || process.env.HOSTNAME || "unknown"
  } catch {
    return "unknown"
  }
}

function getUsername(): string {
  try {
    return process.env.USER || process.env.USERNAME || "unknown"
  } catch {
    return "unknown"
  }
}

function getOS(): string {
  try {
    return process.platform || "unknown"
  } catch {
    return "unknown"
  }
}
