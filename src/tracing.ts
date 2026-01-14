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
  currentTurnStartTime?: number
  currentInput?: string
  currentOutput?: string
  currentMessageId?: string
}

const sessionStates = new Map<string, SessionState>()

/**
 * Create tracing hooks for Braintrust
 */
export function createTracingHooks(
  btClient: BraintrustClient,
  input: PluginInput,
  config: BraintrustConfig
): Partial<Hooks> {
  const { client } = input
  const debug = config.debug

  const log = (msg: string, data?: unknown) => {
    // Only log to OpenCode's structured logging (never stdout)
    client.app.log({
      body: {
        service: "braintrust-trace",
        level: debug ? "info" : "debug",
        message: msg,
        extra: data ? data : undefined,
      },
    }).catch(() => {})
  }

  // Log that we're creating hooks (this runs at plugin load time)
  client.app.log({
    body: {
      service: "braintrust-trace",
      level: "info",
      message: "Creating tracing hooks",
    },
  }).catch(() => {})

  return {
    // Listen to all events for session lifecycle
    event: async ({ event }: { event: Event }) => {
      // This should log to OpenCode's log file
      client.app.log({
        body: {
          service: "braintrust-trace",
          level: "info",
          message: `Event hook called: ${event.type}`,
        },
      }).catch(() => {})

      try {
        // Log every event to understand what we're receiving
        log("Event received", { type: event.type, properties: event.properties })

        // Extract sessionID from various possible locations in event.properties
        const props = event.properties as Record<string, unknown>
        const info = props.info as Record<string, unknown> | undefined
        const sessionID =
          (props.sessionID as string) ||
          (info?.id as string) ||
          (props.id as string)

        if (event.type === "session.created") {
          log("Session created event", {
            sessionID,
            hasSessionID: !!sessionID,
            infoId: info?.id,
          })

          if (!sessionID) {
            log("No session ID found, skipping trace creation")
            return
          }

          const sessionKey = String(sessionID)

          // Create root span for session
          const rootSpanId = generateUUID()
          const state: SessionState = {
            rootSpanId,
            turnNumber: 0,
            toolCallCount: 0,
            startTime: Date.now(),
          }
          sessionStates.set(sessionKey, state)

          const root_span: SpanData = {
            id: rootSpanId,  // Use span_id as id so merges work
            span_id: rootSpanId,
            root_span_id: rootSpanId,
            created: new Date(state.startTime).toISOString(),
            metadata: {
              session_id: sessionKey,
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
              name: `OpenCode: ${getProjectName(input.worktree)}`,
              type: "task",
            },
          }

          const rowId = await btClient.insertSpan(root_span, log)
          log("Created root span", { rootSpanId, rowId, success: !!rowId })
        }
        // Track message content from message.part.updated events
        else if (event.type === "message.part.updated") {
          const part = props.part as Record<string, unknown> | undefined
          if (part?.type === "text" && part?.text) {
            const partSessionID = part.sessionID as string
            if (!partSessionID) {
              log("message.part.updated: no sessionID in part")
              return
            }
            const state = sessionStates.get(partSessionID)
            if (!state) {
              log("message.part.updated: no state for session", { partSessionID, availableSessions: Array.from(sessionStates.keys()) })
              return
            }
            
            const text = part.text as string
            const time = part.time as Record<string, unknown> | undefined
            
            // If this message has time.end, it's complete - capture as output
            if (time?.end && state.currentTurnSpanId) {
              state.currentOutput = text
              log("Captured assistant output", { turnNumber: state.turnNumber, outputLength: text.length, output: text.substring(0, 100) })
            }
          }
        }
        // Close current turn on session.idle (user finished a conversation turn)
        else if (event.type === "session.idle") {
          if (!sessionID) {
            log("session.idle but no session ID found")
            return
          }

          const sessionKey = String(sessionID)
          const state = sessionStates.get(sessionKey)

          if (state && state.currentTurnSpanId) {
            log("Closing turn span on idle", { sessionKey, turnNumber: state.turnNumber, input: state.currentInput?.substring(0, 100), output: state.currentOutput?.substring(0, 100) })

            const now = Date.now()
            // Close current turn span using merge (only send fields to update)
            const turnSpan: SpanData = {
              id: state.currentTurnSpanId,
              span_id: state.currentTurnSpanId,
              root_span_id: state.rootSpanId,
              output: state.currentOutput || undefined,
              metrics: {
                end: now,
              },
              _is_merge: true,
            }
            await btClient.insertSpan(turnSpan, log)
            state.currentTurnSpanId = undefined
            state.currentInput = undefined
            state.currentOutput = undefined
            state.currentTurnStartTime = undefined
            log("Turn span closed", { sessionKey, turnNumber: state.turnNumber })
          }
        }
        // Fully close session on deleted
        else if (event.type === "session.deleted") {
          if (!sessionID) {
            log("session.deleted but no session ID found")
            return
          }

          const sessionKey = String(sessionID)
          const state = sessionStates.get(sessionKey)

          if (state) {
            log("Closing session span on delete", { sessionKey })

            // Close current turn span if exists using merge
            if (state.currentTurnSpanId) {
              const now = Date.now()
              const turnSpan: SpanData = {
                id: state.currentTurnSpanId,
                span_id: state.currentTurnSpanId,
                root_span_id: state.rootSpanId,
                output: state.currentOutput || undefined,
                metrics: {
                  end: now,
                },
                _is_merge: true,
              }
              await btClient.insertSpan(turnSpan, log)
            }

            // Update root span with end time using merge
            const span: SpanData = {
              id: state.rootSpanId,
              span_id: state.rootSpanId,
              root_span_id: state.rootSpanId,
              metrics: {
                end: Date.now(),
              },
              metadata: {
                total_turns: state.turnNumber,
                total_tool_calls: state.toolCallCount,
              },
              _is_merge: true,
            }
            await btClient.insertSpan(span, log)
            sessionStates.delete(sessionKey)
            log("Session span closed", { sessionKey })
          }
        }
        else {
          log(`unhandled event ${event.type}`)
        }
      } catch (error) {
        client.app.log({
          body: {
            service: "braintrust-trace",
            level: "error",
            message: `Error in event hook: ${error instanceof Error ? error.message : String(error)}`,
          },
        }).catch(() => {})
      }
    },

    // Create turn span when user sends a message
    "chat.message": async (messageInput, output) => {
      const { sessionID } = messageInput
      log("Chat message", { sessionID, parts: output.parts })

      const state = sessionStates.get(sessionID)
      if (!state) {
        log("No state found for session", { sessionID })
        return
      }

      // Finalize previous turn if exists (using merge to only update end time)
      if (state.currentTurnSpanId) {
        const prevTurnSpan: SpanData = {
          id: state.currentTurnSpanId,
          span_id: state.currentTurnSpanId,
          root_span_id: state.rootSpanId,
          output: state.currentOutput || undefined,
          metrics: {
            end: Date.now(),
          },
          _is_merge: true,
        }
        await btClient.insertSpan(prevTurnSpan, log)
      }

      // Create new turn span
      state.turnNumber++
      state.currentTurnSpanId = generateUUID()
      state.currentOutput = undefined

      // Extract user message from parts
      const userMessage =
        output.parts
          ?.filter((p: { type: string }) => p.type === "text")
          .map((p: { type: string; text?: string }) => p.text)
          .join("\n") || ""

      state.currentInput = userMessage
      const now = Date.now()
      state.currentTurnStartTime = now
      log("User message extracted", { userMessage, hasInput: !!userMessage, inputLength: userMessage.length })

      const turnSpan: SpanData = {
        id: state.currentTurnSpanId,  // Use span_id as id so merges work
        span_id: state.currentTurnSpanId,
        root_span_id: state.rootSpanId,
        span_parents: [state.rootSpanId],
        created: new Date(now).toISOString(),
        input: userMessage || undefined,  // Send undefined if empty, not empty string
        metadata: {
          turn_number: state.turnNumber,
          agent: messageInput.agent,
          // Flatten model object to string since Braintrust expects string values
          model: typeof messageInput.model === 'object' && messageInput.model 
            ? `${(messageInput.model as {providerID?: string}).providerID}/${(messageInput.model as {modelID?: string}).modelID}`
            : String(messageInput.model || ''),
        },
        metrics: {
          start: now,
        },
        span_attributes: {
          name: `Turn ${state.turnNumber}`,
          type: "task",
        },
      }

      const rowId = await btClient.insertSpan(turnSpan, log)
      log("Created turn span", { turnNumber: state.turnNumber, input: userMessage, rowId, spanId: state.currentTurnSpanId })
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

      await btClient.insertSpan(toolSpan, log)
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

function getProjectName(worktree: string): string {
  // Extract the last directory name from the worktree path
  const parts = worktree.split("/").filter(Boolean)
  return parts[parts.length - 1] || "unknown"
}
