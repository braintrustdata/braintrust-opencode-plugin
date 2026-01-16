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
import type { BraintrustClient, BraintrustConfig, SpanData } from "./client"

// Generate a UUID
function generateUUID(): string {
  return crypto.randomUUID()
}

// State management for tracing
interface SessionState {
  rootSpanId: string
  effectiveRootSpanId: string // For child sessions, this is the parent's root span ID; otherwise same as rootSpanId
  currentTurnSpanId?: string
  turnNumber: number
  toolCallCount: number
  startTime: number
  currentTurnStartTime?: number
  currentInput?: string
  currentOutput?: string
  currentMessageId?: string
  // Parent-child session tracking (for subagents)
  parentSessionId?: string // If this is a child session, the parent's session ID
  parentRootSpanId?: string // The parent's root span ID (child spans link to this as root)
  parentTurnSpanId?: string // The parent's turn span ID (child's root span is a child of this)
  subagentTitle?: string // Title for subagent spans (e.g., "{subagent_type}: {description}")
  // LLM span tracking
  currentAssistantMessageId?: string
  llmOutputParts: Map<string, string> // messageId -> accumulated text
  llmToolCalls: Map<
    string,
    Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  > // messageId -> tool_calls
  llmReasoningParts: Map<string, string> // messageId -> reasoning/thinking text
  processedLlmMessages: Set<string> // track which assistant messages we've created spans for
  // Tool span tracking
  toolStartTimes: Map<string, number> // callID -> start timestamp
  toolCallMessageIds: Map<string, string> // callID -> messageId (to look up reasoning)
}

const sessionStates = new Map<string, SessionState>()

/**
 * Create tracing hooks for Braintrust
 */
export function createTracingHooks(
  btClient: BraintrustClient,
  input: PluginInput,
  config: BraintrustConfig,
): Partial<Hooks> {
  const { client } = input
  const debug = config.debug

  const log = (msg: string, data?: unknown) => {
    // Only log to OpenCode's structured logging (never stdout)
    client.app
      .log({
        body: {
          service: "braintrust-trace",
          level: debug ? "info" : "debug",
          message: msg,
          extra: data ? data : undefined,
        },
      })
      .catch(() => {})
  }

  // Log that we're creating hooks (this runs at plugin load time)
  client.app
    .log({
      body: {
        service: "braintrust-trace",
        level: "info",
        message: "Creating tracing hooks",
      },
    })
    .catch(() => {})

  return {
    // Listen to all events for session lifecycle
    event: async ({ event }: { event: Event }) => {
      // This should log to OpenCode's log file
      client.app
        .log({
          body: {
            service: "braintrust-trace",
            level: "info",
            message: `Event hook called: ${event.type}`,
          },
        })
        .catch(() => {})

      try {
        // Log every event to understand what we're receiving
        log("Event received", { type: event.type, properties: event.properties })

        // Extract sessionID from various possible locations in event.properties
        const props = event.properties as Record<string, unknown>
        const info = props.info as Record<string, unknown> | undefined
        const sessionID =
          (props.sessionID as string) || (info?.id as string) || (props.id as string)

        if (event.type === "session.created") {
          // Check for child session (subagent) creation
          const sessionInfo = info as Record<string, unknown> | undefined
          const childSessionID = sessionInfo?.id as string
          const parentSessionID = sessionInfo?.parentID as string

          // Handle child session (subagent) - link to parent trace
          if (childSessionID && parentSessionID) {
            const parentState = sessionStates.get(parentSessionID)
            if (parentState) {
              // Extract subagent title from session title
              // OpenCode format: "{description} (@{agent.name} subagent)"
              // We want: "{agent.name}: {description}"
              const sessionTitle = sessionInfo?.title as string | undefined
              let subagentTitle = sessionTitle || "Subagent"
              if (sessionTitle) {
                const match = sessionTitle.match(/^(.+?)\s+\(@(\w+)\s+subagent\)$/)
                if (match) {
                  const [, description, agentType] = match
                  subagentTitle = `${agentType}: ${description}`
                }
              }

              log("Child session created, linking to parent", {
                childSessionID,
                parentSessionID,
                parentRootSpanId: parentState.rootSpanId,
                parentTurnSpanId: parentState.currentTurnSpanId,
                subagentTitle,
              })

              // Create child session state with parent linking info
              const childState: SessionState = {
                rootSpanId: "", // Will be set when we create the root span
                effectiveRootSpanId: parentState.effectiveRootSpanId, // Use parent's effective root for trace linking
                turnNumber: 0,
                toolCallCount: 0,
                startTime: Date.now(),
                parentSessionId: parentSessionID,
                parentRootSpanId: parentState.effectiveRootSpanId,
                parentTurnSpanId: parentState.currentTurnSpanId,
                subagentTitle,
                llmOutputParts: new Map(),
                llmToolCalls: new Map(),
                llmReasoningParts: new Map(),
                processedLlmMessages: new Set(),
                toolStartTimes: new Map(),
                toolCallMessageIds: new Map(),
              }
              sessionStates.set(childSessionID, childState)

              // Create root span for child session, linked to parent's trace
              const rootSpanId = generateUUID()
              childState.rootSpanId = rootSpanId

              const root_span: SpanData = {
                id: rootSpanId,
                span_id: rootSpanId,
                root_span_id: parentState.effectiveRootSpanId, // Link to parent's trace
                span_parents: parentState.currentTurnSpanId
                  ? [parentState.currentTurnSpanId]
                  : undefined, // Child of parent's turn
                created: new Date(childState.startTime).toISOString(),
                metadata: {
                  session_id: childSessionID,
                  parent_session_id: parentSessionID,
                  is_subagent: true,
                },
                metrics: {
                  start: childState.startTime,
                },
                span_attributes: {
                  name: subagentTitle,
                  type: "task",
                },
              }

              const rowId = await btClient.insertSpan(root_span, log)
              log("Created child session root span", {
                rootSpanId,
                rowId,
                success: !!rowId,
                parentRootSpanId: parentState.effectiveRootSpanId,
              })
              return
            }
          }

          // Handle regular (parent) session creation
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
            effectiveRootSpanId: rootSpanId, // For root sessions, effective root is self
            turnNumber: 0,
            toolCallCount: 0,
            startTime: Date.now(),
            llmOutputParts: new Map(),
            llmToolCalls: new Map(),
            llmReasoningParts: new Map(),
            processedLlmMessages: new Set(),
            toolStartTimes: new Map(),
            toolCallMessageIds: new Map(),
          }
          sessionStates.set(sessionKey, state)

          const root_span: SpanData = {
            id: rootSpanId, // Use span_id as id so merges work
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
          const partSessionID = part?.sessionID as string
          const messageId = part?.messageID as string

          if (!partSessionID || !part) {
            log("message.part.updated: no sessionID or part")
            return
          }

          const state = sessionStates.get(partSessionID)
          if (!state) {
            log("message.part.updated: no state for session", {
              partSessionID,
              availableSessions: Array.from(sessionStates.keys()),
            })
            return
          }

          // Track text content
          if (part.type === "text" && part.text) {
            const text = part.text as string
            const time = part.time as Record<string, unknown> | undefined

            // Track text content by messageId for LLM spans
            if (messageId) {
              state.llmOutputParts.set(messageId, text)
              log("Tracking LLM output part", { messageId, textLength: text.length })
            }

            // If this message has time.end, it's complete - capture as output for turn
            if (time?.end && state.currentTurnSpanId) {
              state.currentOutput = text
              log("Captured assistant output", {
                turnNumber: state.turnNumber,
                outputLength: text.length,
                output: text.substring(0, 100),
              })
            }
          }
          // Track tool calls for LLM span output
          else if (part.type === "tool" && messageId) {
            const callID = part.callID as string
            const tool = part.tool as string
            const partState = part.state as Record<string, unknown> | undefined
            const input = partState?.input as Record<string, unknown> | undefined

            if (callID && tool && input) {
              // Get or create tool_calls array for this message
              let toolCalls = state.llmToolCalls.get(messageId)
              if (!toolCalls) {
                toolCalls = []
                state.llmToolCalls.set(messageId, toolCalls)
              }

              // Check if we already have this tool call (avoid duplicates from streaming updates)
              const existingIndex = toolCalls.findIndex((tc) => tc.id === callID)
              const toolCall = {
                id: callID,
                type: "function" as const,
                function: {
                  name: tool,
                  arguments: JSON.stringify(input),
                },
              }

              if (existingIndex >= 0) {
                // Update existing
                toolCalls[existingIndex] = toolCall
              } else {
                // Add new
                toolCalls.push(toolCall)
              }

              // Store messageId for this callID so we can look up reasoning later
              state.toolCallMessageIds.set(callID, messageId)

              log("Tracking LLM tool call", { messageId, callID, tool })
            }
          }
          // Track reasoning/thinking content for LLM spans
          else if (part.type === "reasoning" && messageId) {
            const text = part.text as string
            if (text) {
              state.llmReasoningParts.set(messageId, text)
              log("Tracking LLM reasoning part", { messageId, textLength: text.length })
            }
          }
        }
        // Handle assistant message completion - create LLM span
        else if (event.type === "message.updated") {
          const messageInfo = props.info as Record<string, unknown> | undefined
          if (!messageInfo) {
            log("message.updated: no info in props")
            return
          }

          const role = messageInfo.role as string
          if (role !== "assistant") {
            log("message.updated: skipping non-assistant message", { role })
            return
          }

          const msgSessionID = messageInfo.sessionID as string
          const messageId = messageInfo.id as string
          const time = messageInfo.time as Record<string, unknown> | undefined

          if (!msgSessionID || !messageId) {
            log("message.updated: missing sessionID or messageId", { msgSessionID, messageId })
            return
          }

          const state = sessionStates.get(msgSessionID)
          if (!state) {
            log("message.updated: no state for session", { msgSessionID })
            return
          }

          // Only create LLM span when message is completed
          if (!time?.completed) {
            log("message.updated: message not completed yet", { messageId, time })
            return
          }

          // Skip if we already processed this message
          if (state.processedLlmMessages.has(messageId)) {
            log("message.updated: already processed", { messageId })
            return
          }

          // Need a current turn to attach the LLM span to
          if (!state.currentTurnSpanId) {
            log("message.updated: no current turn span", { messageId })
            return
          }

          // Mark as processed
          state.processedLlmMessages.add(messageId)

          // Extract token info
          const tokens = messageInfo.tokens as Record<string, unknown> | undefined
          const inputTokens = (tokens?.input as number) || 0
          const outputTokens = (tokens?.output as number) || 0
          const reasoningTokens = (tokens?.reasoning as number) || 0
          const totalTokens = inputTokens + outputTokens + reasoningTokens

          // Extract model info
          const providerID = (messageInfo.providerID as string) || "unknown"
          const modelID = (messageInfo.modelID as string) || "unknown"
          const modelName = `${providerID}/${modelID}`

          // Extract error info if present
          const msgError = messageInfo.error as
            | { name?: string; data?: { message?: string } }
            | undefined
          let llmErrorString: string | undefined
          if (msgError) {
            const errorName = msgError.name || "UnknownError"
            const errorMessage = msgError.data?.message || errorName
            llmErrorString = `${errorMessage}\n\ntype: ${errorName}`
          }

          // Get output text, tool calls, and reasoning from tracked parts
          const outputText = state.llmOutputParts.get(messageId) || ""
          const toolCalls = state.llmToolCalls.get(messageId)
          const reasoningText = state.llmReasoningParts.get(messageId)

          // Build assistant message object - include tool_calls and reasoning if present
          const assistantMessage: Record<string, unknown> = {
            role: "assistant",
            content: outputText,
          }
          if (toolCalls && toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls
          }
          if (reasoningText) {
            assistantMessage.reasoning = { content: reasoningText }
          }

          // Build input as messages array (all messages except the last)
          // Build output as single-element array with the assistant response
          // This is the format Braintrust's LLM view expects
          const llmInput: Array<Record<string, unknown>> = []
          if (state.currentInput) {
            llmInput.push({ role: "user", content: state.currentInput })
          }
          const llmOutput = [assistantMessage]

          // Create LLM span
          const llmSpanId = generateUUID()
          const llmSpan: SpanData = {
            id: llmSpanId,
            span_id: llmSpanId,
            root_span_id: state.effectiveRootSpanId,
            span_parents: [state.currentTurnSpanId],
            created: new Date(time.created as number).toISOString(),
            input: llmInput.length > 0 ? llmInput : undefined,
            output: llmOutput,
            error: llmErrorString,
            metrics: {
              start: time.created as number,
              end: time.completed as number,
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              tokens: totalTokens,
              reasoning_tokens: reasoningTokens || undefined,
            },
            metadata: {
              model: modelName,
              provider: providerID,
              message_id: messageId,
            },
            span_attributes: {
              name: modelName,
              type: "llm",
            },
          }

          const rowId = await btClient.insertSpan(llmSpan, log)
          log("Created LLM span", {
            messageId,
            modelName,
            tokens: totalTokens,
            reasoningTokens,
            rowId,
            turnSpanId: state.currentTurnSpanId,
            outputLength: outputText.length,
            reasoningLength: reasoningText?.length || 0,
            toolCallsCount: toolCalls?.length || 0,
            hasError: !!llmErrorString,
          })
        }
        // Close current turn on session.idle (user finished a conversation turn)
        else if (event.type === "session.idle") {
          if (!sessionID) {
            log("session.idle but no session ID found")
            return
          }

          const sessionKey = String(sessionID)
          const state = sessionStates.get(sessionKey)

          if (state) {
            const now = Date.now()
            const isChildSession = !!state.parentSessionId

            // Close current turn span if exists
            if (state.currentTurnSpanId) {
              log("Closing turn span on idle", {
                sessionKey,
                turnNumber: state.turnNumber,
                input: state.currentInput?.substring(0, 100),
                output: state.currentOutput?.substring(0, 100),
                isChildSession,
              })

              const turnSpan: SpanData = {
                id: state.currentTurnSpanId,
                span_id: state.currentTurnSpanId,
                root_span_id: state.effectiveRootSpanId,
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

            // For child sessions (subagents), also close the root span since they don't get session.deleted
            if (isChildSession && state.rootSpanId) {
              log("Closing child session root span on idle", {
                sessionKey,
                parentSessionId: state.parentSessionId,
                rootSpanId: state.rootSpanId,
              })

              const rootSpan: SpanData = {
                id: state.rootSpanId,
                span_id: state.rootSpanId,
                root_span_id: state.effectiveRootSpanId,
                metrics: {
                  end: now,
                },
                metadata: {
                  total_turns: state.turnNumber,
                  total_tool_calls: state.toolCallCount,
                },
                _is_merge: true,
              }
              await btClient.insertSpan(rootSpan, log)

              // Clean up child session state
              sessionStates.delete(sessionKey)
              log("Child session closed", { sessionKey })
            }
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

            const now = Date.now()

            // Close current turn span if exists using merge
            if (state.currentTurnSpanId) {
              const turnSpan: SpanData = {
                id: state.currentTurnSpanId,
                span_id: state.currentTurnSpanId,
                root_span_id: state.effectiveRootSpanId,
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
              root_span_id: state.effectiveRootSpanId,
              metrics: {
                end: now,
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
        // Handle session error - close spans with error info
        else if (event.type === "session.error") {
          const errorSessionID = props.sessionID as string
          if (!errorSessionID) {
            log("session.error but no session ID found")
            return
          }

          const sessionKey = String(errorSessionID)
          const state = sessionStates.get(sessionKey)

          if (state) {
            const now = Date.now()

            // Extract error info from event.properties
            // Error structure: { name: "ErrorType", data: { message?: string, ... } }
            const errorObj = props.error as
              | { name?: string; data?: { message?: string } }
              | undefined
            const errorName = errorObj?.name || "UnknownError"
            const errorMessage = errorObj?.data?.message || errorName

            // Format error string similar to Braintrust SDK pattern: "message\n\ntype: ErrorType"
            const errorString = `${errorMessage}\n\ntype: ${errorName}`

            log("Handling session error", { sessionKey, errorName, errorMessage })

            // Close current turn span with error if exists
            if (state.currentTurnSpanId) {
              const turnSpan: SpanData = {
                id: state.currentTurnSpanId,
                span_id: state.currentTurnSpanId,
                root_span_id: state.effectiveRootSpanId,
                output: state.currentOutput || undefined,
                error: errorString,
                metrics: { end: now },
                _is_merge: true,
              }
              await btClient.insertSpan(turnSpan, log)
            }

            // Close root span with error and metadata
            const rootSpan: SpanData = {
              id: state.rootSpanId,
              span_id: state.rootSpanId,
              root_span_id: state.effectiveRootSpanId,
              error: errorString,
              metrics: { end: now },
              metadata: {
                total_turns: state.turnNumber,
                total_tool_calls: state.toolCallCount,
                error_type: errorName,
              },
              _is_merge: true,
            }
            await btClient.insertSpan(rootSpan, log)

            // Clean up session state
            sessionStates.delete(sessionKey)
            log("Session error handled", { sessionKey, errorName, errorMessage })
          }
        } else {
          log(`unhandled event ${event.type}`)
        }
      } catch (error) {
        client.app
          .log({
            body: {
              service: "braintrust-trace",
              level: "error",
              message: `Error in event hook: ${error instanceof Error ? error.message : String(error)}`,
            },
          })
          .catch(() => {})
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
          root_span_id: state.effectiveRootSpanId,
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
      log("User message extracted", {
        userMessage,
        hasInput: !!userMessage,
        inputLength: userMessage.length,
      })

      const turnSpan: SpanData = {
        id: state.currentTurnSpanId, // Use span_id as id so merges work
        span_id: state.currentTurnSpanId,
        root_span_id: state.effectiveRootSpanId,
        span_parents: [state.rootSpanId],
        created: new Date(now).toISOString(),
        input: userMessage || undefined, // Send undefined if empty, not empty string
        metadata: {
          turn_number: state.turnNumber,
          agent: messageInput.agent,
          // Flatten model object to string since Braintrust expects string values
          model:
            typeof messageInput.model === "object" && messageInput.model
              ? `${(messageInput.model as { providerID?: string }).providerID}/${(messageInput.model as { modelID?: string }).modelID}`
              : String(messageInput.model || ""),
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
      log("Created turn span", {
        turnNumber: state.turnNumber,
        input: userMessage,
        rowId,
        spanId: state.currentTurnSpanId,
      })
    },

    // Track tool executions
    "tool.execute.before": async (toolInput, _output) => {
      const { tool, sessionID, callID } = toolInput
      log("Tool execute before", { tool, sessionID, callID })

      // Store start time for this tool call
      const state = sessionStates.get(sessionID)
      if (state) {
        state.toolStartTimes.set(callID, Date.now())
      }
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

      // Get start time and clean up
      const startTime = state.toolStartTimes.get(callID)
      state.toolStartTimes.delete(callID)

      // Look up reasoning for this tool call via messageId
      const messageId = state.toolCallMessageIds.get(callID)
      const reasoning = messageId ? state.llmReasoningParts.get(messageId) : undefined
      state.toolCallMessageIds.delete(callID)

      // Create tool span
      const toolSpanId = generateUUID()
      const endTime = Date.now()
      const toolSpan: SpanData = {
        id: generateUUID(),
        span_id: toolSpanId,
        root_span_id: state.effectiveRootSpanId,
        span_parents: [state.currentTurnSpanId],
        input: result.metadata,
        output: result.output.substring(0, 10000), // Truncate large outputs
        metadata: {
          tool_name: tool,
          call_id: callID,
          title: result.title,
          reasoning: reasoning || undefined,
        },
        metrics: {
          start: startTime,
          end: endTime,
        },
        span_attributes: {
          name: formatToolName(tool, result.title),
          type: "tool",
        },
      }

      await btClient.insertSpan(toolSpan, log)
      log("Created tool span", {
        tool,
        callID,
        startTime,
        endTime,
        hasReasoning: !!reasoning,
        reasoningLength: reasoning?.length || 0,
      })
    },
  }
}

/**
 * Format a descriptive tool name
 */
function formatToolName(tool: string, title?: string): string {
  if (title) {
    let displayTitle = title

    // For file operations, show just the filename instead of full path
    if ((tool === "read" || tool === "edit") && title.includes("/")) {
      const parts = title.split("/")
      displayTitle = parts[parts.length - 1] || title
    }

    // Truncate long titles
    const shortTitle =
      displayTitle.length > 50 ? `${displayTitle.substring(0, 47)}...` : displayTitle
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
