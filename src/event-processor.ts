/**
 * Event processor for testing - processes OpenCode events into spans
 *
 * This module extracts the core event processing logic so it can be tested
 * independently of the OpenCode plugin infrastructure.
 */

import type { Event } from "@opencode-ai/sdk"
import type { SpanData } from "./client"
import type { Clock } from "./clock"
import { wallClock } from "./clock"
import type { SpanSink } from "./span-sink"

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
  llmOutputParts: Map<string, string>
  llmToolCalls: Map<
    string,
    Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  >
  llmReasoningParts: Map<string, string> // messageId -> reasoning/thinking text
  processedLlmMessages: Set<string>
  // Tool span tracking
  toolStartTimes: Map<string, number>
  toolCallMessageIds: Map<string, string> // callID -> messageId (to look up reasoning)
}

export interface EventProcessorConfig {
  projectName: string
  worktree?: string
  directory?: string
}

/**
 * Processes OpenCode events and generates spans
 */
export class EventProcessor {
  private sessionStates = new Map<string, SessionState>()
  private spanSink: SpanSink
  private config: EventProcessorConfig
  private log: (msg: string, data?: unknown) => void
  private clock: Clock

  constructor(
    spanSink: SpanSink,
    config: EventProcessorConfig,
    options?: {
      log?: (msg: string, data?: unknown) => void
      clock?: Clock
    },
  ) {
    this.spanSink = spanSink
    this.config = config
    this.log = options?.log || (() => {})
    this.clock = options?.clock || wallClock
  }

  /**
   * Process a single event
   */
  async processEvent(event: Event): Promise<void> {
    const props = event.properties as Record<string, unknown>
    const info = props.info as Record<string, unknown> | undefined
    const sessionID = (props.sessionID as string) || (info?.id as string) || (props.id as string)

    if (event.type === "session.created") {
      await this.handleSessionCreated(info)
    } else if (event.type === "message.part.updated") {
      await this.handleMessagePartUpdated(props)
    } else if (event.type === "message.updated") {
      await this.handleMessageUpdated(props)
    } else if (event.type === "session.idle") {
      await this.handleSessionIdle(sessionID)
    } else if (event.type === "session.deleted") {
      await this.handleSessionDeleted(sessionID)
    } else if (event.type === "session.error") {
      await this.handleSessionError(props)
    }
  }

  /**
   * Process a chat.message hook call
   */
  async processChatMessage(
    sessionID: string,
    userMessage: string,
    model?: { providerID?: string; modelID?: string },
  ): Promise<void> {
    const state = this.sessionStates.get(sessionID)
    if (!state) {
      this.log("No state found for session", { sessionID })
      return
    }

    // Finalize previous turn if exists
    if (state.currentTurnSpanId) {
      const prevTurnSpan: SpanData = {
        id: state.currentTurnSpanId,
        span_id: state.currentTurnSpanId,
        root_span_id: state.effectiveRootSpanId,
        output: state.currentOutput || undefined,
        metrics: {
          end: this.clock.now(),
        },
        _is_merge: true,
      }
      await this.spanSink.insertSpan(prevTurnSpan)
    }

    // Create new turn span
    state.turnNumber++
    state.currentTurnSpanId = generateUUID()
    state.currentOutput = undefined
    state.currentInput = userMessage

    const now = this.clock.now()
    state.currentTurnStartTime = now

    const turnSpan: SpanData = {
      id: state.currentTurnSpanId,
      span_id: state.currentTurnSpanId,
      root_span_id: state.effectiveRootSpanId,
      span_parents: [state.rootSpanId],
      created: new Date(now).toISOString(),
      input: userMessage || undefined,
      metadata: {
        turn_number: state.turnNumber,
        model: model ? `${model.providerID}/${model.modelID}` : undefined,
      },
      metrics: {
        start: now,
      },
      span_attributes: {
        name: `Turn ${state.turnNumber}`,
        type: "task",
      },
    }

    await this.spanSink.insertSpan(turnSpan)
    this.log("Created turn span", { turnNumber: state.turnNumber })
  }

  /**
   * Process a tool.execute.before hook call
   */
  async processToolExecuteBefore(sessionID: string, callID: string): Promise<void> {
    const state = this.sessionStates.get(sessionID)
    if (state) {
      state.toolStartTimes.set(callID, this.clock.now())
    }
  }

  /**
   * Process a tool.execute.after hook call
   */
  async processToolExecuteAfter(
    sessionID: string,
    callID: string,
    tool: string,
    title: string,
    output: string,
    metadata: unknown,
  ): Promise<void> {
    const state = this.sessionStates.get(sessionID)
    if (!state || !state.currentTurnSpanId) {
      this.log("No state or turn for tool", { sessionID })
      return
    }

    state.toolCallCount++

    const startTime = state.toolStartTimes.get(callID)
    state.toolStartTimes.delete(callID)

    // Look up reasoning for this tool call via messageId
    const messageId = state.toolCallMessageIds.get(callID)
    const reasoning = messageId ? state.llmReasoningParts.get(messageId) : undefined
    state.toolCallMessageIds.delete(callID)

    const toolSpanId = generateUUID()
    const endTime = this.clock.now()
    const toolSpan: SpanData = {
      id: generateUUID(),
      span_id: toolSpanId,
      root_span_id: state.effectiveRootSpanId,
      span_parents: [state.currentTurnSpanId],
      input: metadata,
      output: typeof output === "string" ? output.substring(0, 10000) : output,
      metadata: {
        tool_name: tool,
        call_id: callID,
        title,
        reasoning: reasoning || undefined,
      },
      metrics: {
        start: startTime,
        end: endTime,
      },
      span_attributes: {
        name: this.formatToolName(tool, title),
        type: "tool",
      },
    }

    await this.spanSink.insertSpan(toolSpan)
    this.log("Created tool span", { tool, callID })
  }

  private async handleSessionCreated(
    sessionInfo: Record<string, unknown> | undefined,
  ): Promise<void> {
    const sessionID = sessionInfo?.id as string
    const parentSessionID = sessionInfo?.parentID as string

    // Handle child session (subagent) - link to parent trace
    if (sessionID && parentSessionID) {
      const parentState = this.sessionStates.get(parentSessionID)
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

        this.log("Child session created, linking to parent", {
          sessionID,
          parentSessionID,
          parentRootSpanId: parentState.rootSpanId,
          parentTurnSpanId: parentState.currentTurnSpanId,
          subagentTitle,
        })

        // Create child session state with parent linking info
        const rootSpanId = generateUUID()
        const childState: SessionState = {
          rootSpanId,
          effectiveRootSpanId: parentState.effectiveRootSpanId, // Use parent's effective root for trace linking
          turnNumber: 0,
          toolCallCount: 0,
          startTime: this.clock.now(),
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
        this.sessionStates.set(sessionID, childState)

        // Create root span for child session, linked to parent's trace
        const root_span: SpanData = {
          id: rootSpanId,
          span_id: rootSpanId,
          root_span_id: parentState.effectiveRootSpanId, // Link to parent's trace
          span_parents: parentState.currentTurnSpanId ? [parentState.currentTurnSpanId] : undefined, // Child of parent's turn
          created: new Date(childState.startTime).toISOString(),
          metadata: {
            session_id: sessionID,
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

        await this.spanSink.insertSpan(root_span)
        this.log("Created child session root span", { rootSpanId })
        return
      }
    }

    // Handle regular (parent) session creation
    if (!sessionID) {
      this.log("No session ID found, skipping trace creation")
      return
    }

    const sessionKey = String(sessionID)
    const rootSpanId = generateUUID()
    const state: SessionState = {
      rootSpanId,
      effectiveRootSpanId: rootSpanId, // For root sessions, effective root is self
      turnNumber: 0,
      toolCallCount: 0,
      startTime: this.clock.now(),
      llmOutputParts: new Map(),
      llmToolCalls: new Map(),
      llmReasoningParts: new Map(),
      processedLlmMessages: new Set(),
      toolStartTimes: new Map(),
      toolCallMessageIds: new Map(),
    }
    this.sessionStates.set(sessionKey, state)

    const root_span: SpanData = {
      id: rootSpanId,
      span_id: rootSpanId,
      root_span_id: rootSpanId,
      created: new Date(state.startTime).toISOString(),
      metadata: {
        session_id: sessionKey,
        workspace: this.config.worktree,
        directory: this.config.directory,
      },
      metrics: {
        start: state.startTime,
      },
      span_attributes: {
        name: `OpenCode: ${this.config.projectName}`,
        type: "task",
      },
    }

    await this.spanSink.insertSpan(root_span)
    this.log("Created root span", { rootSpanId })
  }

  private async handleMessagePartUpdated(props: Record<string, unknown>): Promise<void> {
    const part = props.part as Record<string, unknown> | undefined
    const partSessionID = part?.sessionID as string
    const messageId = part?.messageID as string

    if (!partSessionID || !part) {
      this.log("message.part.updated: no sessionID or part")
      return
    }

    const state = this.sessionStates.get(partSessionID)
    if (!state) {
      this.log("message.part.updated: no state for session", { partSessionID })
      return
    }

    // Track text content
    if (part.type === "text" && part.text) {
      const text = part.text as string
      const time = part.time as Record<string, unknown> | undefined

      if (messageId) {
        state.llmOutputParts.set(messageId, text)
        this.log("Tracking LLM output part", { messageId, textLength: text.length })
      }

      if (time?.end && state.currentTurnSpanId) {
        state.currentOutput = text
      }
    }
    // Track tool calls for LLM span output
    else if (part.type === "tool" && messageId) {
      const callID = part.callID as string
      const tool = part.tool as string
      const partState = part.state as Record<string, unknown> | undefined
      const input = partState?.input as Record<string, unknown> | undefined

      if (callID && tool && input) {
        let toolCalls = state.llmToolCalls.get(messageId)
        if (!toolCalls) {
          toolCalls = []
          state.llmToolCalls.set(messageId, toolCalls)
        }

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
          toolCalls[existingIndex] = toolCall
        } else {
          toolCalls.push(toolCall)
        }

        // Store messageId for this callID so we can look up reasoning later
        state.toolCallMessageIds.set(callID, messageId)

        this.log("Tracking LLM tool call", { messageId, callID, tool })
      }
    }
    // Track reasoning/thinking content for LLM spans
    else if (part.type === "reasoning" && messageId) {
      const text = part.text as string
      if (text) {
        state.llmReasoningParts.set(messageId, text)
        this.log("Tracking LLM reasoning part", { messageId, textLength: text.length })
      }
    }
  }

  private async handleMessageUpdated(props: Record<string, unknown>): Promise<void> {
    const messageInfo = props.info as Record<string, unknown> | undefined
    if (!messageInfo) {
      this.log("message.updated: no info in props")
      return
    }

    const role = messageInfo.role as string
    if (role !== "assistant") {
      this.log("message.updated: skipping non-assistant message", { role })
      return
    }

    const msgSessionID = messageInfo.sessionID as string
    const messageId = messageInfo.id as string
    const time = messageInfo.time as Record<string, unknown> | undefined

    if (!msgSessionID || !messageId) {
      this.log("message.updated: missing sessionID or messageId", { msgSessionID, messageId })
      return
    }

    const state = this.sessionStates.get(msgSessionID)
    if (!state) {
      this.log("message.updated: no state for session", { msgSessionID })
      return
    }

    // Only create LLM span when message is completed
    if (!time?.completed) {
      this.log("message.updated: message not completed yet", { messageId, time })
      return
    }

    // Skip if we already processed this message
    if (state.processedLlmMessages.has(messageId)) {
      this.log("message.updated: already processed", { messageId })
      return
    }

    // Need a current turn to attach the LLM span to
    if (!state.currentTurnSpanId) {
      this.log("message.updated: no current turn span", { messageId })
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
      // Braintrust expects reasoning as an array of objects with id and content
      assistantMessage.reasoning = [{ id: "reasoning", content: reasoningText }]
    }

    // Build input/output in Braintrust's expected format
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

    await this.spanSink.insertSpan(llmSpan)
    this.log("Created LLM span", { messageId, modelName, tokens: totalTokens })
  }

  private async handleSessionIdle(sessionID: string | undefined): Promise<void> {
    if (!sessionID) {
      this.log("session.idle but no session ID found")
      return
    }

    const sessionKey = String(sessionID)
    const state = this.sessionStates.get(sessionKey)

    if (state) {
      const now = this.clock.now()
      const isChildSession = !!state.parentSessionId

      // Close current turn span if exists
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
        await this.spanSink.insertSpan(turnSpan)
        state.currentTurnSpanId = undefined
        state.currentInput = undefined
        state.currentOutput = undefined
        state.currentTurnStartTime = undefined
        this.log("Turn span closed", { sessionKey, turnNumber: state.turnNumber })
      }

      // For child sessions (subagents), also close the root span since they don't get session.deleted
      if (isChildSession && state.rootSpanId) {
        this.log("Closing child session root span on idle", {
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
        await this.spanSink.insertSpan(rootSpan)

        // Clean up child session state
        this.sessionStates.delete(sessionKey)
        this.log("Child session closed", { sessionKey })
      }
    }
  }

  private async handleSessionDeleted(sessionID: string | undefined): Promise<void> {
    if (!sessionID) {
      this.log("session.deleted but no session ID found")
      return
    }

    const sessionKey = String(sessionID)
    const state = this.sessionStates.get(sessionKey)

    if (state) {
      const now = this.clock.now()

      // Close current turn span if exists
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
        await this.spanSink.insertSpan(turnSpan)
      }

      // Close root span
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
      await this.spanSink.insertSpan(span)
      this.sessionStates.delete(sessionKey)
      this.log("Session span closed", { sessionKey })
    }
  }

  private async handleSessionError(props: Record<string, unknown>): Promise<void> {
    const sessionID = props.sessionID as string
    if (!sessionID) {
      this.log("session.error but no session ID found")
      return
    }

    const sessionKey = String(sessionID)
    const state = this.sessionStates.get(sessionKey)

    if (state) {
      const now = this.clock.now()

      // Extract error info from event.properties
      // Error structure: { name: "ErrorType", data: { message?: string, ... } }
      const errorObj = props.error as { name?: string; data?: { message?: string } } | undefined
      const errorName = errorObj?.name || "UnknownError"
      const errorMessage = errorObj?.data?.message || errorName

      // Format error string similar to Braintrust SDK pattern: "message\n\ntype: ErrorType"
      const errorString = `${errorMessage}\n\ntype: ${errorName}`

      this.log("Handling session error", { sessionKey, errorName, errorMessage })

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
        await this.spanSink.insertSpan(turnSpan)
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
      await this.spanSink.insertSpan(rootSpan)

      // Clean up session state
      this.sessionStates.delete(sessionKey)
      this.log("Session error handled", { sessionKey, errorName, errorMessage })
    }
  }

  private formatToolName(tool: string, title?: string): string {
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
}

/**
 * Helper function to process a list of events and return the resulting span tree
 */
export async function processEventsToSpans(
  events: Event[],
  config: EventProcessorConfig,
  chatMessages?: Array<{
    sessionID: string
    userMessage: string
    model?: { providerID?: string; modelID?: string }
  }>,
  _toolCalls?: Array<{
    sessionID: string
    callID: string
    tool: string
    title: string
    output: string
    metadata: unknown
  }>,
): Promise<SpanData[]> {
  const { TestSpanCollector } = await import("./span-sink")
  const collector = new TestSpanCollector()
  const processor = new EventProcessor(collector, config)

  // Process events in order, interleaving chat messages and tool calls as needed
  for (const event of events) {
    await processor.processEvent(event)

    // Check if we need to process a chat message after session.created
    if (event.type === "session.created" && chatMessages) {
      const props = event.properties as Record<string, unknown>
      const info = props.info as Record<string, unknown> | undefined
      const sessionID = (props.sessionID as string) || (info?.id as string)

      const chatMsg = chatMessages.find((cm) => cm.sessionID === sessionID)
      if (chatMsg) {
        await processor.processChatMessage(chatMsg.sessionID, chatMsg.userMessage, chatMsg.model)
      }
    }
  }

  return collector.getSpans()
}
