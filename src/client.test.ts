/**
 * Tests for client configuration loading
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { loadConfig, parseBooleanEnv } from "./client"

describe("parseBooleanEnv", () => {
  it("returns false for undefined", () => {
    expect(parseBooleanEnv(undefined)).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(parseBooleanEnv("")).toBe(false)
  })

  it("returns true for 'true'", () => {
    expect(parseBooleanEnv("true")).toBe(true)
  })

  it("returns true for 'TRUE'", () => {
    expect(parseBooleanEnv("TRUE")).toBe(true)
  })

  it("returns true for 'tRuE' (mixed case)", () => {
    expect(parseBooleanEnv("tRuE")).toBe(true)
  })

  it("returns true for '1'", () => {
    expect(parseBooleanEnv("1")).toBe(true)
  })

  it("returns false for 'false'", () => {
    expect(parseBooleanEnv("false")).toBe(false)
  })

  it("returns false for '0'", () => {
    expect(parseBooleanEnv("0")).toBe(false)
  })

  it("returns false for 'yes'", () => {
    expect(parseBooleanEnv("yes")).toBe(false)
  })

  it("returns false for 'no'", () => {
    expect(parseBooleanEnv("no")).toBe(false)
  })
})

describe("loadConfig", () => {
  // Store original env values
  let originalTracing: string | undefined
  let originalDebug: string | undefined

  beforeEach(() => {
    // Save original values
    originalTracing = process.env.TRACE_TO_BRAINTRUST
    originalDebug = process.env.BRAINTRUST_DEBUG
    // Clear env vars for clean tests
    delete process.env.TRACE_TO_BRAINTRUST
    delete process.env.BRAINTRUST_DEBUG
  })

  afterEach(() => {
    // Restore original values
    if (originalTracing !== undefined) {
      process.env.TRACE_TO_BRAINTRUST = originalTracing
    } else {
      delete process.env.TRACE_TO_BRAINTRUST
    }
    if (originalDebug !== undefined) {
      process.env.BRAINTRUST_DEBUG = originalDebug
    } else {
      delete process.env.BRAINTRUST_DEBUG
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

  it("TRACE_TO_BRAINTRUST=TRUE enables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "TRUE"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(true)
  })

  it("TRACE_TO_BRAINTRUST=1 enables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "1"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(true)
  })

  it("TRACE_TO_BRAINTRUST=false disables tracing", () => {
    process.env.TRACE_TO_BRAINTRUST = "false"
    const config = loadConfig()
    expect(config.tracingEnabled).toBe(false)
  })

  it("defaults to debug disabled", () => {
    const config = loadConfig()
    expect(config.debug).toBe(false)
  })

  it("BRAINTRUST_DEBUG=true enables debug", () => {
    process.env.BRAINTRUST_DEBUG = "true"
    const config = loadConfig()
    expect(config.debug).toBe(true)
  })

  it("BRAINTRUST_DEBUG=1 enables debug", () => {
    process.env.BRAINTRUST_DEBUG = "1"
    const config = loadConfig()
    expect(config.debug).toBe(true)
  })
})
