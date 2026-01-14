/**
 * Test helpers for span tracing tests
 *
 * Provides a DSL for constructing test events and comparing expected span trees
 */

import type {
  Event,
  EventSessionCreated,
  EventSessionIdle,
  EventSessionDeleted,
  EventMessageUpdated,
  EventMessagePartUpdated,
  Session,
  AssistantMessage,
  TextPart,
  ToolPart,
  ToolStateRunning,
} from "@opencode-ai/sdk"
import { EventProcessor } from "./event-processor"
import { TestSpanCollector, spansToTree, type SpanTree } from "./span-sink"

// ============================================================================
// Types
// ============================================================================

export interface TestSession {
  sessionID: string
  items: Array<TestItem>
}

/**
 * A test item is either an OpenCode Event or a hook call
 */
export type TestItem =
  | Event
  | { _hook: "chat.message"; userMessage: string; model?: { providerID: string; modelID: string } }
  | { _hook: "tool.execute"; callID: string; tool: string; title: string; input: Record<string, unknown>; output: string }

export interface TestToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
}

// ============================================================================
// Event Builders - Create real OpenCode SDK events
// ============================================================================

/**
 * Create a test session with items (events and hook calls)
 */
export function session(sessionID: string, ...items: TestItem[]): TestSession {
  return { sessionID, items }
}

/**
 * Create a session.created event
 */
export function sessionCreated(sessionID: string): EventSessionCreated {
  const sessionInfo: Session = {
    id: sessionID,
    projectID: "test-project",
    directory: "/test",
    version: "1.0.0",
    title: "Test",
    time: { created: Date.now(), updated: Date.now() },
  }
  return {
    type: "session.created",
    properties: { info: sessionInfo },
  }
}

/**
 * Create a session.idle event
 */
export function sessionIdle(sessionID: string): EventSessionIdle {
  return {
    type: "session.idle",
    properties: { sessionID },
  }
}

/**
 * Create a session.deleted event
 */
export function sessionDeleted(sessionID: string): EventSessionDeleted {
  const sessionInfo: Session = {
    id: sessionID,
    projectID: "test-project",
    directory: "/test",
    version: "1.0.0",
    title: "Test",
    time: { created: Date.now(), updated: Date.now() },
  }
  return {
    type: "session.deleted",
    properties: { info: sessionInfo },
  }
}

/**
 * User sends a chat message (hook call, not an event)
 */
export function chatMessage(
  userMessage: string,
  model?: { providerID: string; modelID: string }
): TestItem {
  return { _hook: "chat.message", userMessage, model }
}

/**
 * Create message.part.updated event for text
 */
export function textPart(sessionID: string, messageID: string, text: string): EventMessagePartUpdated {
  const part: TextPart = {
    id: `prt_text_${messageID}`,
    sessionID,
    messageID,
    type: "text",
    text,
  }
  return {
    type: "message.part.updated",
    properties: { part },
  }
}

/**
 * Create message.part.updated event for a tool call
 */
export function toolCallPart(
  sessionID: string,
  messageID: string,
  callID: string,
  tool: string,
  args: Record<string, unknown>
): EventMessagePartUpdated {
  const toolState: ToolStateRunning = {
    status: "running",
    input: args,
    time: { start: Date.now() },
  }
  const part: ToolPart = {
    id: `prt_tool_${callID}`,
    sessionID,
    messageID,
    type: "tool",
    callID,
    tool,
    state: toolState,
  }
  return {
    type: "message.part.updated",
    properties: { part },
  }
}

/**
 * Create message.updated event for assistant message completion
 */
export function messageCompleted(
  sessionID: string,
  messageID: string,
  options?: {
    tokens?: { input: number; output: number }
    model?: { providerID: string; modelID: string }
    time?: { created: number; completed: number }
  }
): EventMessageUpdated {
  const modelInfo = options?.model || { providerID: "anthropic", modelID: "claude-3-haiku" }
  const time = options?.time || { created: Date.now(), completed: Date.now() + 500 }

  const messageInfo: AssistantMessage = {
    id: messageID,
    sessionID,
    role: "assistant",
    time,
    parentID: "parent",
    modelID: modelInfo.modelID,
    providerID: modelInfo.providerID,
    mode: "build",
    path: { cwd: "/test", root: "/test" },
    cost: 0.001,
    tokens: {
      input: options?.tokens?.input || 10,
      output: options?.tokens?.output || 5,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
  return {
    type: "message.updated",
    properties: { info: messageInfo },
  }
}

/**
 * Tool execution (hook call, not an event)
 */
export function toolExecute(
  callID: string,
  tool: string,
  title: string,
  input: Record<string, unknown>,
  output: string
): TestItem {
  return { _hook: "tool.execute", callID, tool, title, input, output }
}

/**
 * Helper to build a tool call object for use with toolCallPart
 */
export function toolCall(id: string, tool: string, args: Record<string, unknown>): TestToolCall {
  return { id, tool, args }
}

// ============================================================================
// Expected Span Type - matches SpanData structure from Braintrust
// ============================================================================

/**
 * Expected span - matches the structure reported to Braintrust
 * All fields are optional for flexible matching
 */
export interface ExpectedSpan {
  span_attributes?: {
    name?: string | RegExp
    type?: "llm" | "task" | "tool" | "function" | "eval" | "score"
  }
  input?: unknown
  output?: unknown
  metrics?: {
    start?: number
    end?: number
    prompt_tokens?: number
    completion_tokens?: number
    tokens?: number
  }
  metadata?: Record<string, unknown>
  children?: ExpectedSpan[]
}

// ============================================================================
// Main Test Function - Process events and compare to expected structure
// ============================================================================

type HookItem =
  | { _hook: "chat.message"; userMessage: string; model?: { providerID: string; modelID: string } }
  | { _hook: "tool.execute"; callID: string; tool: string; title: string; input: Record<string, unknown>; output: string }

function isHook(item: TestItem): item is HookItem {
  return typeof item === "object" && "_hook" in item
}

/**
 * Process test session items and return the span tree
 */
export async function eventsToTree(testSession: TestSession, projectName = "test-project"): Promise<SpanTree | null> {
  const collector = new TestSpanCollector()
  const processor = new EventProcessor(collector, { projectName })

  const { sessionID } = testSession

  for (const item of testSession.items) {
    if (isHook(item)) {
      if (item._hook === "chat.message") {
        const hook = item as { _hook: "chat.message"; userMessage: string; model?: { providerID: string; modelID: string } }
        await processor.processChatMessage(
          sessionID,
          hook.userMessage,
          hook.model || { providerID: "anthropic", modelID: "claude-3-haiku" }
        )
      } else if (item._hook === "tool.execute") {
        const hook = item as { _hook: "tool.execute"; callID: string; tool: string; title: string; input: Record<string, unknown>; output: string }
        await processor.processToolExecuteBefore(sessionID, hook.callID)
        await processor.processToolExecuteAfter(sessionID, hook.callID, hook.tool, hook.title, hook.output, hook.input)
      }
    } else {
      // It's a real Event
      await processor.processEvent(item)
    }
  }

  return spansToTree(collector.getSpans())
}

/**
 * Check if a span name matches (string or regex)
 */
function nameMatches(actual: string | undefined, expected: string | RegExp | undefined): boolean {
  if (expected === undefined) return true
  if (actual === undefined) return false
  if (expected instanceof RegExp) return expected.test(actual)
  return actual === expected
}

/**
 * Check if a single span matches expected (without checking children)
 */
function spanMatchesSingle(actual: SpanTree, expected: ExpectedSpan): boolean {
  if (expected.span_attributes?.name !== undefined) {
    if (!nameMatches(actual.name, expected.span_attributes.name)) return false
  }

  if (expected.span_attributes?.type !== undefined) {
    if (actual.type !== expected.span_attributes.type) return false
  }

  if (expected.metrics) {
    if (expected.metrics.prompt_tokens !== undefined && actual.metrics?.prompt_tokens !== expected.metrics.prompt_tokens)
      return false
    if (expected.metrics.completion_tokens !== undefined && actual.metrics?.completion_tokens !== expected.metrics.completion_tokens)
      return false
    if (expected.metrics.tokens !== undefined && actual.metrics?.tokens !== expected.metrics.tokens) return false
  }

  if (expected.input !== undefined) {
    if (JSON.stringify(actual.input) !== JSON.stringify(expected.input)) return false
  }

  if (expected.output !== undefined) {
    if (JSON.stringify(actual.output) !== JSON.stringify(expected.output)) return false
  }

  return true
}

/**
 * Check if actual span tree matches expected structure
 */
export function matchesExpected(actual: SpanTree | null, expected: ExpectedSpan): boolean {
  if (!actual) return false

  if (!spanMatchesSingle(actual, expected)) return false

  if (expected.children !== undefined) {
    if (actual.children.length !== expected.children.length) return false

    for (let i = 0; i < expected.children.length; i++) {
      if (!matchesExpected(actual.children[i], expected.children[i])) return false
    }
  }

  return true
}

/**
 * Get a diff description of what doesn't match
 */
export function getDiff(actual: SpanTree | null, expected: ExpectedSpan, path = "root"): string[] {
  const diffs: string[] = []

  if (!actual) {
    diffs.push(`${path}: expected span but got null`)
    return diffs
  }

  if (expected.span_attributes?.name !== undefined) {
    if (!nameMatches(actual.name, expected.span_attributes.name)) {
      diffs.push(`${path}.span_attributes.name: expected "${expected.span_attributes.name}", got "${actual.name}"`)
    }
  }

  if (expected.span_attributes?.type !== undefined && actual.type !== expected.span_attributes.type) {
    diffs.push(`${path}.span_attributes.type: expected "${expected.span_attributes.type}", got "${actual.type}"`)
  }

  if (expected.metrics) {
    if (expected.metrics.prompt_tokens !== undefined && actual.metrics?.prompt_tokens !== expected.metrics.prompt_tokens) {
      diffs.push(`${path}.metrics.prompt_tokens: expected ${expected.metrics.prompt_tokens}, got ${actual.metrics?.prompt_tokens}`)
    }
    if (expected.metrics.completion_tokens !== undefined && actual.metrics?.completion_tokens !== expected.metrics.completion_tokens) {
      diffs.push(`${path}.metrics.completion_tokens: expected ${expected.metrics.completion_tokens}, got ${actual.metrics?.completion_tokens}`)
    }
  }

  if (expected.children !== undefined) {
    if (actual.children.length !== expected.children.length) {
      diffs.push(`${path}.children.length: expected ${expected.children.length}, got ${actual.children.length}`)
      diffs.push(`  expected: ${expected.children.map((c) => `${c.span_attributes?.type}:${c.span_attributes?.name}`).join(", ")}`)
      diffs.push(`  actual: ${actual.children.map((c) => `${c.type}:${c.name}`).join(", ")}`)
    } else {
      for (let i = 0; i < expected.children.length; i++) {
        diffs.push(...getDiff(actual.children[i], expected.children[i], `${path}.children[${i}]`))
      }
    }
  }

  return diffs
}

/**
 * Assert that actual tree matches expected structure
 */
export function assertTreeMatches(actual: SpanTree | null, expected: ExpectedSpan): void {
  if (!matchesExpected(actual, expected)) {
    const diffs = getDiff(actual, expected)
    throw new Error(`Span tree does not match expected:\n${diffs.join("\n")}`)
  }
}

/**
 * Main entry point: process items and assert tree matches expected
 */
export async function assertEventsProduceTree(
  testSession: TestSession,
  expected: ExpectedSpan,
  projectName = "test-project"
): Promise<void> {
  const actual = await eventsToTree(testSession, projectName)
  assertTreeMatches(actual, expected)
}
