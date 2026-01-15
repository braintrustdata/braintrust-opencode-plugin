/**
 * Braintrust plugin for OpenCode
 *
 * Provides two main capabilities:
 * 1. Tracing - Automatically traces OpenCode sessions to Braintrust
 * 2. Data Access - Tools to query and interact with Braintrust data
 */

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { BraintrustClient, loadConfig } from "./client"
import { createBraintrustTools } from "./tools"
import { createTracingHooks } from "./tracing"

export const BraintrustPlugin: Plugin = async (input: PluginInput) => {
  const { client } = input

  const config = loadConfig()

  // Create Braintrust client but don't initialize yet (lazy initialization)
  let btClient: BraintrustClient | undefined
  let _initPromise: Promise<void> | undefined

  if (config.apiKey) {
    btClient = new BraintrustClient(config)
    // Start initialization in background, don't await
    _initPromise = btClient.initialize().catch((error) => {
      // Log error but continue
      client.app
        .log({
          body: {
            service: "braintrust",
            level: "warn",
            message: `Braintrust initialization failed: ${error instanceof Error ? error.message : String(error)}. Tracing disabled.`,
          },
        })
        .catch(() => {})
    })
  }

  // Build hooks
  const hooks: Hooks = {}

  // Add tracing hooks if enabled
  if (config.tracingEnabled && btClient) {
    const tracingHooks = createTracingHooks(btClient, input, config)
    Object.assign(hooks, tracingHooks)

    // Log what hooks we're returning
    client.app
      .log({
        body: {
          service: "braintrust",
          level: "info",
          message: `Tracing hooks registered: ${Object.keys(tracingHooks).join(", ")}`,
        },
      })
      .catch(() => {})
  }

  // Add Braintrust tools if client is available
  if (btClient) {
    hooks.tool = createBraintrustTools(btClient)
  }

  // Log initialization status (non-blocking to avoid hanging startup)
  if (btClient) {
    client.app
      .log({
        body: {
          service: "braintrust",
          level: "info",
          message: `Logging Braintrust spans to project "${config.projectName}"`,
        },
      })
      .catch(() => {})
  } else {
    client.app
      .log({
        body: {
          service: "braintrust",
          level: "warn",
          message:
            "Braintrust plugin loaded but BRAINTRUST_API_KEY not set. Set it in your environment to enable tracing and data access.",
        },
      })
      .catch(() => {})
  }

  return hooks
}

// Default export for OpenCode plugin loading
export default BraintrustPlugin

// Re-export types only (not the class, since OpenCode will try to call all exports as plugins)
export type { BraintrustClient, BraintrustConfig } from "./client"
