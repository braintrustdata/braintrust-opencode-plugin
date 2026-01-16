/**
 * Braintrust plugin for OpenCode
 *
 * Provides two main capabilities:
 * 1. Tracing - Automatically traces OpenCode sessions to Braintrust
 * 2. Data Access - Tools to query and interact with Braintrust data
 */

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { BraintrustClient, loadConfig, type PluginConfig } from "./client"
import { createBraintrustTools } from "./tools"
import { createTracingHooks } from "./tracing"

export const BraintrustPlugin: Plugin = async (input: PluginInput) => {
  const { client } = input

  // Load plugin config from config files
  // Precedence: global config -> project config (project overrides global)
  let pluginConfig: PluginConfig | undefined
  try {
    const fs = await import("fs")
    const path = await import("path")
    const os = await import("os")

    // Load configs in order: global first, then project (so project overrides global)
    const configPaths = [
      path.join(os.homedir(), ".config", "opencode", "braintrust.json"), // global
      path.join(input.directory, ".opencode", "braintrust.json"), // project
    ]

    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, "utf-8")
          const parsed = JSON.parse(content) as PluginConfig
          // Merge: later config overrides earlier
          pluginConfig = pluginConfig ? { ...pluginConfig, ...parsed } : parsed
        }
      } catch {
        // Continue to next path
      }
    }
  } catch {
    // Config loading failed, proceed with env vars only
  }

  const config = loadConfig(pluginConfig)

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
export type { BraintrustClient, BraintrustConfig, PluginConfig } from "./client"
