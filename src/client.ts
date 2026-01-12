/**
 * Braintrust API client for the OpenCode plugin
 */

export interface BraintrustConfig {
  apiKey: string
  apiUrl?: string
  appUrl: string
  orgName?: string
  projectName: string
  tracingEnabled: boolean
  debug: boolean
}

export interface SpanData {
  id: string
  span_id: string
  root_span_id: string
  span_parents?: string[]
  input?: unknown
  output?: unknown
  expected?: unknown
  scores?: Record<string, number>
  metadata?: Record<string, unknown>
  metrics?: {
    start?: number
    end?: number
    prompt_tokens?: number
    completion_tokens?: number
    tokens?: number
  }
  context?: {
    caller_functionname?: string
    caller_filename?: string
    caller_lineno?: number
  }
  span_attributes?: {
    name?: string
    type?: "llm" | "task" | "tool" | "function" | "eval" | "score"
  }
}

interface LoginResponse {
  org_info: Array<{
    name: string
    api_url: string
  }>
}

interface ProjectResponse {
  id: string
  name: string
}

interface InsertResponse {
  row_ids: string[]
}

export function loadConfig(): BraintrustConfig {
  return {
    apiKey: process.env.BRAINTRUST_API_KEY || "",
    apiUrl: process.env.BRAINTRUST_API_URL,
    appUrl: process.env.BRAINTRUST_APP_URL || "https://www.braintrust.dev",
    orgName: process.env.BRAINTRUST_ORG_NAME,
    projectName: process.env.BRAINTRUST_PROJECT || "opencode",
    tracingEnabled: process.env.BRAINTRUST_TRACING !== "false",
    debug: process.env.BRAINTRUST_DEBUG === "true",
  }
}

export class BraintrustClient {
  private config: BraintrustConfig
  private resolvedApiUrl?: string
  private projectId?: string

  constructor(config: BraintrustConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    // Resolve API URL
    this.resolvedApiUrl = await this.resolveApiUrl()

    // Get or create project
    this.projectId = await this.getOrCreateProject(this.config.projectName)

    if (this.config.debug) {
      console.log(`[braintrust] Initialized with API URL: ${this.resolvedApiUrl}`)
      console.log(`[braintrust] Project ID: ${this.projectId}`)
    }
  }

  private async resolveApiUrl(): Promise<string> {
    // Check for explicit override
    if (this.config.apiUrl) {
      return this.config.apiUrl
    }

    // Default if no API key
    if (!this.config.apiKey) {
      return "https://api.braintrust.dev"
    }

    try {
      // Login to discover API URL
      const response = await fetch(`${this.config.appUrl}/api/apikey/login`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      })

      if (!response.ok) {
        console.warn(`[braintrust] Login failed: ${response.status}`)
        return "https://api.braintrust.dev"
      }

      const data = (await response.json()) as LoginResponse

      // Filter by org name if specified
      if (this.config.orgName) {
        const org = data.org_info.find((o) => o.name === this.config.orgName)
        if (org?.api_url) {
          return org.api_url
        }
      }

      // Use first org
      if (data.org_info?.[0]?.api_url) {
        return data.org_info[0].api_url
      }
    } catch (error) {
      console.warn(`[braintrust] Failed to resolve API URL: ${error}`)
    }

    return "https://api.braintrust.dev"
  }

  private async getOrCreateProject(name: string): Promise<string> {
    const encodedName = encodeURIComponent(name)

    // Try to get existing project
    try {
      const response = await fetch(
        `${this.resolvedApiUrl}/v1/project?project_name=${encodedName}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        }
      )

      if (response.ok) {
        const data = (await response.json()) as ProjectResponse
        if (data.id) {
          return data.id
        }
      }
    } catch {
      // Continue to create
    }

    // Create project
    try {
      const response = await fetch(`${this.resolvedApiUrl}/v1/project`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      })

      if (response.ok) {
        const data = (await response.json()) as ProjectResponse
        if (data.id) {
          return data.id
        }
      }
    } catch (error) {
      console.error(`[braintrust] Failed to create project: ${error}`)
    }

    throw new Error(`Failed to get or create project: ${name}`)
  }

  /**
   * Insert a span into project logs
   */
  async insertSpan(span: SpanData): Promise<string | undefined> {
    if (!this.projectId) {
      console.error("[braintrust] Cannot insert span: project not initialized")
      return undefined
    }

    try {
      const response = await fetch(
        `${this.resolvedApiUrl}/v1/project_logs/${this.projectId}/insert`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events: [span] }),
        }
      )

      if (!response.ok) {
        const text = await response.text()
        console.error(`[braintrust] Insert failed (${response.status}): ${text}`)
        return undefined
      }

      const data = (await response.json()) as InsertResponse
      return data.row_ids?.[0]
    } catch (error) {
      console.error(`[braintrust] Failed to insert span: ${error}`)
      return undefined
    }
  }

  /**
   * Execute a BTQL query against project logs
   */
  async queryLogs(sql: string): Promise<unknown[]> {
    try {
      // Rewrite "FROM logs" to "FROM project_logs('project_id')"
      const rewrittenSql = sql.replace(
        /\bFROM\s+logs\b/gi,
        `FROM project_logs('${this.projectId}')`
      )

      const response = await fetch(`${this.resolvedApiUrl}/btql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: rewrittenSql }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Query failed (${response.status}): ${text}`)
      }

      const data = await response.json()
      return data as unknown[]
    } catch (error) {
      throw new Error(`Failed to execute query: ${error}`)
    }
  }

  /**
   * List projects in the organization
   */
  async listProjects(): Promise<ProjectResponse[]> {
    try {
      const response = await fetch(`${this.resolvedApiUrl}/v1/project`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to list projects: ${response.status}`)
      }

      const data = await response.json()
      return (data as { objects: ProjectResponse[] }).objects || []
    } catch (error) {
      throw new Error(`Failed to list projects: ${error}`)
    }
  }

  /**
   * Get the current project ID
   */
  getProjectId(): string | undefined {
    return this.projectId
  }

  /**
   * Get the resolved API URL
   */
  getApiUrl(): string | undefined {
    return this.resolvedApiUrl
  }

  /**
   * Check if client is properly initialized
   */
  isInitialized(): boolean {
    return !!this.projectId && !!this.resolvedApiUrl
  }
}
