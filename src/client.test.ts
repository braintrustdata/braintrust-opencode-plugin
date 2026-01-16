/**
 * Tests for client configuration loading
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { loadConfig, type PluginConfig, parseBooleanEnv } from "./client"

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
  const originalEnv: Record<string, string | undefined> = {}
  const envVars = [
    "TRACE_TO_BRAINTRUST",
    "BRAINTRUST_DEBUG",
    "BRAINTRUST_API_KEY",
    "BRAINTRUST_API_URL",
    "BRAINTRUST_APP_URL",
    "BRAINTRUST_ORG_NAME",
    "BRAINTRUST_PROJECT",
  ]

  beforeEach(() => {
    // Save and clear all relevant env vars
    for (const key of envVars) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    // Restore original values
    for (const key of envVars) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key]
      } else {
        delete process.env[key]
      }
    }
  })

  describe("defaults", () => {
    it("uses default values when no config provided", () => {
      const config = loadConfig()
      expect(config.apiKey).toBe("")
      expect(config.apiUrl).toBeUndefined()
      expect(config.appUrl).toBe("https://www.braintrust.dev")
      expect(config.orgName).toBeUndefined()
      expect(config.projectName).toBe("opencode")
      expect(config.tracingEnabled).toBe(false)
      expect(config.debug).toBe(false)
    })
  })

  describe("env vars only", () => {
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

  describe("pluginConfig only (from opencode.json)", () => {
    it("loads all settings from pluginConfig", () => {
      const pluginConfig: PluginConfig = {
        api_key: "test-api-key",
        api_url: "https://custom-api.example.com",
        app_url: "https://custom-app.example.com",
        org_name: "test-org",
        project: "test-project",
        trace_to_braintrust: true,
        debug: true,
      }
      const config = loadConfig(pluginConfig)
      expect(config.apiKey).toBe("test-api-key")
      expect(config.apiUrl).toBe("https://custom-api.example.com")
      expect(config.appUrl).toBe("https://custom-app.example.com")
      expect(config.orgName).toBe("test-org")
      expect(config.projectName).toBe("test-project")
      expect(config.tracingEnabled).toBe(true)
      expect(config.debug).toBe(true)
    })

    it("handles partial pluginConfig", () => {
      const pluginConfig: PluginConfig = {
        project: "my-project",
        trace_to_braintrust: true,
      }
      const config = loadConfig(pluginConfig)
      expect(config.apiKey).toBe("")
      expect(config.projectName).toBe("my-project")
      expect(config.tracingEnabled).toBe(true)
      expect(config.debug).toBe(false)
    })

    it("handles pluginConfig with false booleans", () => {
      const pluginConfig: PluginConfig = {
        trace_to_braintrust: false,
        debug: false,
      }
      const config = loadConfig(pluginConfig)
      expect(config.tracingEnabled).toBe(false)
      expect(config.debug).toBe(false)
    })
  })

  describe("env vars override pluginConfig", () => {
    it("env var overrides pluginConfig for api_key", () => {
      process.env.BRAINTRUST_API_KEY = "env-api-key"
      const pluginConfig: PluginConfig = { api_key: "config-api-key" }
      const config = loadConfig(pluginConfig)
      expect(config.apiKey).toBe("env-api-key")
    })

    it("env var overrides pluginConfig for project", () => {
      process.env.BRAINTRUST_PROJECT = "env-project"
      const pluginConfig: PluginConfig = { project: "config-project" }
      const config = loadConfig(pluginConfig)
      expect(config.projectName).toBe("env-project")
    })

    it("env var overrides pluginConfig for trace_to_braintrust", () => {
      process.env.TRACE_TO_BRAINTRUST = "false"
      const pluginConfig: PluginConfig = { trace_to_braintrust: true }
      const config = loadConfig(pluginConfig)
      expect(config.tracingEnabled).toBe(false)
    })

    it("env var overrides pluginConfig for debug", () => {
      process.env.BRAINTRUST_DEBUG = "true"
      const pluginConfig: PluginConfig = { debug: false }
      const config = loadConfig(pluginConfig)
      expect(config.debug).toBe(true)
    })

    it("pluginConfig is used when env var is not set", () => {
      process.env.BRAINTRUST_API_KEY = "env-key"
      // BRAINTRUST_PROJECT not set
      const pluginConfig: PluginConfig = {
        api_key: "config-key",
        project: "config-project",
      }
      const config = loadConfig(pluginConfig)
      expect(config.apiKey).toBe("env-key") // overridden
      expect(config.projectName).toBe("config-project") // from pluginConfig
    })
  })
})
