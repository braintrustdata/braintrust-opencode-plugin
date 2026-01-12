/**
 * Braintrust plugin for OpenCode
 *
 * Provides two main capabilities:
 * 1. Tracing - Automatically traces OpenCode sessions to Braintrust
 * 2. Data Access - Tools to query and interact with Braintrust data
 */

import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin"
import { createTracingHooks } from "./tracing"
import { createBraintrustTools } from "./tools"
import { BraintrustClient, loadConfig } from "./client"

export const BraintrustPlugin: Plugin = async (input: PluginInput) => {
  const config = loadConfig()

  // Initialize Braintrust client if API key is available
  let btClient: BraintrustClient | undefined
  if (config.apiKey) {
    btClient = new BraintrustClient(config)
    await btClient.initialize()
  }

  // Build hooks
  const hooks: Hooks = {}

  // Add tracing hooks if enabled
  if (config.tracingEnabled && btClient) {
    const tracingHooks = createTracingHooks(btClient, input, config)
    Object.assign(hooks, tracingHooks)
  }

  // Add Braintrust tools if client is available
  if (btClient) {
    hooks.tool = createBraintrustTools(btClient)
  }

  // Log initialization status
  if (btClient) {
    await input.client.app.log({
      body: {
        service: "braintrust",
        level: "info",
        message: `Braintrust plugin initialized${config.tracingEnabled ? " with tracing" : ""}`,
      },
    })
  } else {
    await input.client.app.log({
      body: {
        service: "braintrust",
        level: "warn",
        message:
          "Braintrust plugin loaded but BRAINTRUST_API_KEY not set. Set it in your environment to enable tracing and data access.",
      },
    })
  }

  return hooks
}

// Default export for OpenCode plugin loading
export default BraintrustPlugin

// Re-export types and utilities
export { BraintrustClient } from "./client"
export type { BraintrustConfig } from "./client"
