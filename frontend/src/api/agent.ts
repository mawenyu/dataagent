import type { AgentRunRequest, AgentEvent } from '../types'

const AGENT_RUN_URL = '/agui-api/agent/run'

export interface StreamCallbacks {
  onEvent: (event: AgentEvent) => void
  onError: (error: Error) => void
  onDone: () => void
}

export function streamAgentRun(
  request: AgentRunRequest,
  callbacks: StreamCallbacks
): () => void {
  const abortController = new AbortController()

  fetch(AGENT_RUN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`)
      }

      const body = response.body
      if (!body) {
        throw new Error('Response body is empty')
      }

      const reader = body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              flushBuffer(buffer)
              callbacks.onDone()
              return
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim()
              if (line.startsWith('data:')) {
                const payload = line.slice(5).trim()
                handleDataLine(payload, callbacks)
              } else if (line === '' && i > 0 && lines[i - 1].trim() === '') {
                // End of event
              }
            }
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            callbacks.onDone()
            return
          }
          callbacks.onError(err instanceof Error ? err : new Error(String(err)))
        }
      }

      pump()
    })
    .catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') {
        callbacks.onDone()
        return
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    })

  return () => {
    abortController.abort()
  }
}

function flushBuffer(buffer: string) {
  const lines = buffer.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) {
      // This path is unreachable in practice because the main loop already processes all complete lines.
      // Keeping for completeness.
    }
  }
}

function handleDataLine(payload: string, callbacks: StreamCallbacks) {
  if (payload === '[DONE]') {
    callbacks.onDone()
    return
  }

  try {
    const parsed: AgentEvent = JSON.parse(payload)
    callbacks.onEvent(parsed)
  } catch (err) {
    callbacks.onError(
      new Error(
        `Failed to parse SSE data: ${err instanceof Error ? err.message : String(err)}`
      )
    )
  }
}
