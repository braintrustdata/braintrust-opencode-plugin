/**
 * Shared synthesis of an LLM span from streamed deltas (opencode 1.14.x).
 *
 * Used when `message.updated` is not delivered to plugins, so the existing
 * LLM-span path never fires. The fallback accumulates `message.part.delta`
 * payloads into a per-message buffer; on `session.idle` we synthesize one
 * LLM span per turn from the accumulated text.
 *
 * Both event-processor.ts (test-driving EventProcessor) and tracing.ts
 * (production hooks) need this logic — extracted here so they can't drift.
 */

import type { SpanData } from "./client"
import { msToSeconds } from "./clock"

/**
 * Structural type matching the fields the helper reads. Both SessionState
 * shapes (in event-processor.ts and tracing.ts) satisfy this — no nominal
 * import needed.
 */
export interface DeltaSynthesizableState {
  currentTurnSpanId?: string
  effectiveRootSpanId: string
  systemPrompt?: string
  currentInput?: string
  currentTurnStartTime?: number
  currentProviderID?: string
  currentModelID?: string
  deltaAccumulatedOutput: Map<string, string>
}

export function joinAccumulatedDeltas(state: DeltaSynthesizableState): string {
  return Array.from(state.deltaAccumulatedOutput.values()).join("")
}

/**
 * Build a synthesized LLM span for the current turn, or return `undefined`
 * if there's nothing to synthesize (no accumulated text, or no turn span to
 * attach to). Tokens are intentionally omitted (not zeroed) so the Braintrust
 * dashboard doesn't render misleading "0 tokens" — that information is
 * unrecoverable from the delta stream.
 */
export function buildSynthesizedLlmSpan(
  state: DeltaSynthesizableState,
  endSeconds: number,
): SpanData | undefined {
  const accumulated = joinAccumulatedDeltas(state)
  if (!accumulated) return undefined
  if (!state.currentTurnSpanId) return undefined

  const providerID = state.currentProviderID ?? "unknown"
  const modelID = state.currentModelID ?? "unknown"
  const modelName = `${providerID}/${modelID}`

  const llmInput: Array<Record<string, unknown>> = []
  if (state.systemPrompt) llmInput.push({ role: "system", content: state.systemPrompt })
  if (state.currentInput) llmInput.push({ role: "user", content: state.currentInput })

  const id = crypto.randomUUID()
  return {
    id,
    span_id: id,
    root_span_id: state.effectiveRootSpanId,
    span_parents: [state.currentTurnSpanId],
    input: llmInput.length > 0 ? llmInput : undefined,
    output: [{ role: "assistant", content: accumulated }],
    metrics: {
      start:
        state.currentTurnStartTime !== undefined
          ? msToSeconds(state.currentTurnStartTime)
          : undefined,
      end: endSeconds,
    },
    metadata: {
      model: modelID,
      provider: providerID,
      synthesized_from: "session.idle",
    },
    span_attributes: {
      name: modelName,
      type: "llm",
    },
  }
}
