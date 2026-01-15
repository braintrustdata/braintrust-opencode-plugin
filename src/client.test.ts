/**
 * Tests for client configuration loading
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { loadConfig } from "./client"

describe("loadConfig", () => {
  // Store original env value
  let originalEnv: string | undefined

  beforeEach(() => {
    // Save original value
    originalEnv = process.env.TRACE_TO_BRAINTRUST
    // Clear env var for clean tests
    delete process.env.TRACE_TO_BRAINTRUST
  })

  afterEach(() => {
    // Restore original value
    if (originalEnv !== undefined) {
      process.env.TRACE_TO_BRAINTRUST = originalEnv
    } else {
      delete process.env.TRACE_TO_BRAINTRUST
    }
  })

  it("defaults to tracing disabled", () => {
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(false)
  })

  it("TRACE_TO_BRAINTRUST=true enables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "true"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(true)
  })

  it("TRACE_TO_BRAINTRUST=false disables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "false"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(false)
  })

  it("any value other than 'true' disables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "yes"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(false)
  })
})
