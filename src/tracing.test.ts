/**
 * Tests for tracing hooks
 *
 * Uses real OpenCode SDK events
 */

import { describe, expect, it } from "bun:test"
import { TestClock } from "./clock"
import { EventProcessor } from "./event-processor"
import { spansToTree, TestSpanCollector } from "./span-sink"
import {
  assertEventsProduceTree,
  chatMessage,
  childSessionCreated,
  eventsToTree,
  messageCompleted,
  reasoningPart,
  session,
  sessionCreated,
  sessionError,
  sessionIdle,
  textPart,
  toolCallPart,
  toolExecute,
} from "./test-helpers"

describe("Event to Span Transformation", () => {
  it("session -> turn -> llm", async () => {
    const sessionId = "ses_1"
    const messageId = "msg_1"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Hello, world!"),
        textPart(sessionId, messageId, "Hi there!"),
        messageCompleted(sessionId, messageId, { tokens: { input: 10, output: 5 } }),
        sessionIdle(sessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 10, completion_tokens: 5, tokens: 15 },
              },
            ],
          },
        ],
      },
    )
  })

  it("session -> multiple turns", async () => {
    const sessionId = "ses_multi"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        // Turn 1
        chatMessage("What is 2+2?"),
        textPart(sessionId, "msg_1", "2+2 equals 4."),
        messageCompleted(sessionId, "msg_1", { tokens: { input: 8, output: 6 } }),
        sessionIdle(sessionId),
        // Turn 2
        chatMessage("What about 3+3?"),
        textPart(sessionId, "msg_2", "3+3 equals 6."),
        messageCompleted(sessionId, "msg_2", { tokens: { input: 12, output: 7 } }),
        sessionIdle(sessionId),
        // Turn 3
        chatMessage("And 4+4?"),
        textPart(sessionId, "msg_3", "4+4 equals 8."),
        messageCompleted(sessionId, "msg_3", { tokens: { input: 15, output: 8 } }),
        sessionIdle(sessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 8, completion_tokens: 6, tokens: 14 },
              },
            ],
          },
          {
            span_attributes: { name: "Turn 2", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 12, completion_tokens: 7, tokens: 19 },
              },
            ],
          },
          {
            span_attributes: { name: "Turn 3", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 15, completion_tokens: 8, tokens: 23 },
              },
            ],
          },
        ],
      },
    )
  })

  it("session -> turn -> tool use (read)", async () => {
    const sessionId = "ses_tool"
    const messageId = "msg_1"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Read the config file"),
        // LLM decides to call read tool
        toolCallPart(sessionId, messageId, "call_1", "read", {
          filePath: "/home/user/project/src/config.ts",
        }),
        toolExecute(
          "call_1",
          "read",
          "/home/user/project/src/config.ts",
          { filePath: "/home/user/project/src/config.ts" },
          "export const config = { debug: true }",
        ),
        textPart(
          sessionId,
          messageId,
          "I've read the config file. It exports a config object with debug: true.",
        ),
        messageCompleted(sessionId, messageId, { tokens: { input: 20, output: 15 } }),
        sessionIdle(sessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              {
                span_attributes: { name: "read: config.ts", type: "tool" },
              },
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 20, completion_tokens: 15, tokens: 35 },
              },
            ],
          },
        ],
      },
    )
  })

  it("session -> turn -> multiple tool calls", async () => {
    const sessionId = "ses_multi_tool"
    const messageId = "msg_1"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Read the config and then edit it"),
        // LLM calls read first
        toolCallPart(sessionId, messageId, "call_1", "read", { filePath: "/project/config.ts" }),
        toolExecute(
          "call_1",
          "read",
          "/project/config.ts",
          { filePath: "/project/config.ts" },
          "export const debug = false",
        ),
        // LLM calls edit
        toolCallPart(sessionId, messageId, "call_2", "edit", {
          filePath: "/project/config.ts",
          oldString: "false",
          newString: "true",
        }),
        toolExecute(
          "call_2",
          "edit",
          "/project/config.ts",
          { filePath: "/project/config.ts", oldString: "false", newString: "true" },
          "Edit applied successfully",
        ),
        textPart(sessionId, messageId, "Done! I changed debug from false to true."),
        messageCompleted(sessionId, messageId, { tokens: { input: 30, output: 12 } }),
        sessionIdle(sessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              // Tool spans come first (processed before LLM span is created)
              {
                span_attributes: { name: "read: config.ts", type: "tool" },
              },
              {
                span_attributes: { name: "edit: config.ts", type: "tool" },
              },
              // LLM span comes last (created when messageCompleted is processed)
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 30, completion_tokens: 12, tokens: 42 },
              },
            ],
          },
        ],
      },
    )
  })
})

describe("Session Errors", () => {
  it("session error during turn closes spans with error", async () => {
    const sessionId = "ses_error"
    const messageId = "msg_1"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Do something"),
        textPart(sessionId, messageId, "Working on it..."),
        messageCompleted(sessionId, messageId, { tokens: { input: 10, output: 5 } }),
        // Error occurs during session
        sessionError(sessionId, "ApiError", "Rate limit exceeded"),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        error: /Rate limit exceeded[\s\S]*type: ApiError/,
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            error: /Rate limit exceeded[\s\S]*type: ApiError/,
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
              },
            ],
          },
        ],
      },
    )
  })

  it("session error before any turn still closes root span with error", async () => {
    const sessionId = "ses_error_early"

    await assertEventsProduceTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        // Error occurs immediately, before any chat message
        sessionError(sessionId, "AuthError", "Invalid API key"),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        error: /Invalid API key[\s\S]*type: AuthError/,
        children: [],
      },
    )
  })
})

describe("Subagents (Child Sessions)", () => {
  it("subagent creates child span linked to parent trace", async () => {
    const parentSessionId = "ses_parent"
    const childSessionId = "ses_child"

    await assertEventsProduceTree(
      session(
        parentSessionId,
        // Parent session starts
        sessionCreated(parentSessionId),
        chatMessage("Search the codebase"),
        // Parent LLM response triggers subagent
        textPart(parentSessionId, "msg_1", "Let me search for that..."),
        messageCompleted(parentSessionId, "msg_1", { tokens: { input: 10, output: 5 } }),
        // Child session (subagent) created
        childSessionCreated(childSessionId, parentSessionId, "Find files (@explore subagent)"),
        // Child does some work (note: sessionID specified to target child session)
        chatMessage("Searching...", { sessionID: childSessionId }),
        textPart(childSessionId, "msg_child_1", "Found 3 files"),
        messageCompleted(childSessionId, "msg_child_1", { tokens: { input: 8, output: 4 } }),
        // Child session completes
        sessionIdle(childSessionId),
        // Parent continues
        sessionIdle(parentSessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
              },
              // Subagent appears as child of the turn
              {
                span_attributes: { name: "explore: Find files", type: "task" },
                children: [
                  {
                    span_attributes: { name: "Turn 1", type: "task" },
                    children: [
                      {
                        span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    )
  })

  it("subagent with default title format", async () => {
    const parentSessionId = "ses_parent2"
    const childSessionId = "ses_child2"

    await assertEventsProduceTree(
      session(
        parentSessionId,
        sessionCreated(parentSessionId),
        chatMessage("Do a task"),
        textPart(parentSessionId, "msg_1", "Starting task..."),
        messageCompleted(parentSessionId, "msg_1", { tokens: { input: 5, output: 3 } }),
        // Child with custom title format
        childSessionCreated(
          childSessionId,
          parentSessionId,
          "Research the topic (@general subagent)",
        ),
        chatMessage("Researching...", { sessionID: childSessionId }),
        textPart(childSessionId, "msg_c1", "Done"),
        messageCompleted(childSessionId, "msg_c1", { tokens: { input: 4, output: 2 } }),
        sessionIdle(childSessionId),
        sessionIdle(parentSessionId),
      ),
      {
        span_attributes: { name: "OpenCode: test-project", type: "task" },
        children: [
          {
            span_attributes: { name: "Turn 1", type: "task" },
            children: [
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
              },
              {
                // Title parsed from "Research the topic (@general subagent)" -> "general: Research the topic"
                span_attributes: { name: "general: Research the topic", type: "task" },
                children: [
                  {
                    span_attributes: { name: "Turn 1", type: "task" },
                    children: [
                      {
                        span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    )
  })
})

describe("Reasoning/Thinking Content", () => {
  it("LLM span includes reasoning content in output", async () => {
    const sessionId = "ses_reasoning"
    const messageId = "msg_1"

    const tree = await eventsToTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Think about this problem"),
        // Model produces reasoning/thinking first
        reasoningPart(sessionId, messageId, "Let me think step by step about this problem..."),
        // Then produces the actual response
        textPart(sessionId, messageId, "Here is my answer."),
        messageCompleted(sessionId, messageId, {
          tokens: { input: 10, output: 5 },
        }),
        sessionIdle(sessionId),
      ),
    )

    // Find the LLM span
    const turnSpan = tree?.children[0]
    const llmSpan = turnSpan?.children[0]

    expect(llmSpan?.type).toBe("llm")

    // Check that reasoning is included in the output
    // Braintrust expects reasoning as an array of objects with id and content
    const output = llmSpan?.output as Array<{ reasoning?: Array<{ id: string; content: string }> }>
    expect(output).toBeDefined()
    expect(output[0]?.reasoning?.[0]?.content).toBe(
      "Let me think step by step about this problem...",
    )
  })

  it("tool span includes reasoning in metadata", async () => {
    const sessionId = "ses_tool_reasoning"
    const messageId = "msg_1"

    const tree = await eventsToTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Read the file"),
        // Model thinks about what to do
        reasoningPart(sessionId, messageId, "I need to read the config file to understand..."),
        // Then calls a tool
        toolCallPart(sessionId, messageId, "call_1", "read", { filePath: "/config.ts" }),
        toolExecute("call_1", "read", "/config.ts", { filePath: "/config.ts" }, "file contents"),
        textPart(sessionId, messageId, "I read the file."),
        messageCompleted(sessionId, messageId, { tokens: { input: 15, output: 8 } }),
        sessionIdle(sessionId),
      ),
    )

    // Find the tool span
    const turnSpan = tree?.children[0]
    // Tool spans and LLM span are children of turn - find the tool one
    const toolSpan = turnSpan?.children.find((c) => c.type === "tool")

    expect(toolSpan?.type).toBe("tool")
    expect(toolSpan?.metadata?.reasoning).toBe("I need to read the config file to understand...")
  })
})

describe("Fail-open: missing or non-string tool output", () => {
  it("tool with undefined output creates span without crashing", async () => {
    const sessionId = "ses_undef_output"
    const messageId = "msg_1"

    const tree = await eventsToTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Call a custom MCP tool"),
        toolCallPart(sessionId, messageId, "call_1", "mcp_tool", { query: "test" }),
        toolExecute("call_1", "mcp_tool", "mcp_tool", { query: "test" }, undefined),
        textPart(sessionId, messageId, "Done."),
        messageCompleted(sessionId, messageId, { tokens: { input: 10, output: 5 } }),
        sessionIdle(sessionId),
      ),
    )

    const turnSpan = tree?.children[0]
    const toolSpan = turnSpan?.children.find((c) => c.type === "tool")

    expect(toolSpan).toBeDefined()
    expect(toolSpan?.type).toBe("tool")
    expect(toolSpan?.name).toBe("mcp_tool: mcp_tool")
    expect(toolSpan?.output).toBeUndefined()
  })

  it("tool with object output (MCP content[]) creates span without crashing", async () => {
    const sessionId = "ses_obj_output"
    const messageId = "msg_1"

    const mcpContent = [
      { type: "text", text: "Here are the results" },
      { type: "image", data: "base64..." },
    ]

    const tree = await eventsToTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Call an MCP tool that returns content[]"),
        toolCallPart(sessionId, messageId, "call_1", "mcp_search", { q: "foo" }),
        toolExecute("call_1", "mcp_search", "mcp_search", { q: "foo" }, mcpContent as any),
        textPart(sessionId, messageId, "Found results."),
        messageCompleted(sessionId, messageId, { tokens: { input: 12, output: 6 } }),
        sessionIdle(sessionId),
      ),
    )

    const turnSpan = tree?.children[0]
    const toolSpan = turnSpan?.children.find((c) => c.type === "tool")

    expect(toolSpan).toBeDefined()
    expect(toolSpan?.type).toBe("tool")
    // Object output should be passed through as-is (not truncated with .substring)
    expect(toolSpan?.output).toEqual(mcpContent)
  })

  it("tool with very long string output is truncated to 10000 chars", async () => {
    const sessionId = "ses_long_output"
    const messageId = "msg_1"

    const longOutput = "x".repeat(20000)

    const tree = await eventsToTree(
      session(
        sessionId,
        sessionCreated(sessionId),
        chatMessage("Call a tool with huge output"),
        toolCallPart(sessionId, messageId, "call_1", "read", { filePath: "/big.txt" }),
        toolExecute("call_1", "read", "/big.txt", { filePath: "/big.txt" }, longOutput),
        textPart(sessionId, messageId, "Read the file."),
        messageCompleted(sessionId, messageId, { tokens: { input: 10, output: 5 } }),
        sessionIdle(sessionId),
      ),
    )

    const turnSpan = tree?.children[0]
    const toolSpan = turnSpan?.children.find((c) => c.type === "tool")

    expect(toolSpan).toBeDefined()
    expect(typeof toolSpan?.output).toBe("string")
    expect((toolSpan?.output as string).length).toBe(10000)
  })
})

describe("Fail-open: chat.message with missing output", () => {
  it("chat.message with undefined output does not crash", async () => {
    const clock = new TestClock()
    const collector = new TestSpanCollector()
    const processor = new EventProcessor(collector, { projectName: "test-project" }, { clock })

    // Create session
    clock.tick()
    await processor.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "ses_no_output",
          projectID: "test-project",
          directory: "/test",
          version: "1.0.0",
          title: "Test",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    })

    // Call processChatMessageRaw with undefined output — this mirrors the
    // production hook receiving an output object without parts
    clock.tick()
    await processor.processChatMessageRaw("ses_no_output", undefined)

    // Session should still be functional — send idle to close
    clock.tick()
    await processor.processEvent({
      type: "session.idle",
      properties: { sessionID: "ses_no_output" },
    })

    const tree = spansToTree(collector.getSpans())
    expect(tree).not.toBeNull()
    // A turn should have been created with empty input
    expect(tree?.children.length).toBe(1)
    expect(tree?.children[0]?.name).toBe("Turn 1")
    expect(tree?.children[0]?.input).toBeUndefined() // empty string becomes undefined
  })

  it("chat.message with empty parts array does not crash", async () => {
    const clock = new TestClock()
    const collector = new TestSpanCollector()
    const processor = new EventProcessor(collector, { projectName: "test-project" }, { clock })

    clock.tick()
    await processor.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "ses_empty_parts",
          projectID: "test-project",
          directory: "/test",
          version: "1.0.0",
          title: "Test",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    })

    clock.tick()
    await processor.processChatMessageRaw("ses_empty_parts", { parts: [] })

    clock.tick()
    await processor.processEvent({
      type: "session.idle",
      properties: { sessionID: "ses_empty_parts" },
    })

    const tree = spansToTree(collector.getSpans())
    expect(tree).not.toBeNull()
    expect(tree?.children.length).toBe(1)
    expect(tree?.children[0]?.name).toBe("Turn 1")
  })
})
