/**
 * Tests for tracing hooks
 *
 * Uses real OpenCode SDK events
 */

import { describe, it } from "bun:test"
import {
  assertEventsProduceTree,
  chatMessage,
  messageCompleted,
  session,
  sessionCreated,
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
              // LLM span comes first due to earlier time.created timestamp
              {
                span_attributes: { name: "anthropic/claude-3-haiku", type: "llm" },
                metrics: { prompt_tokens: 30, completion_tokens: 12, tokens: 42 },
              },
              {
                span_attributes: { name: "read: config.ts", type: "tool" },
              },
              {
                span_attributes: { name: "edit: config.ts", type: "tool" },
              },
            ],
          },
        ],
      },
    )
  })
})
