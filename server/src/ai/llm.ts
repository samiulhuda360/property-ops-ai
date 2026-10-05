// One client for any OpenAI-compatible chat API (Google Gemini by default).
// - Structured output: pass a JSON schema and get parsed JSON back.
// - Retries on 429 and 5xx with backoff; a hard timeout per attempt.
// - A disk cache keyed by the full request, so evaluations are repeatable and cost nothing to re-run.
// - Every call is reported to an optional logger (the server stores them in the AiCall table).
// With no API key, or AI_DRIVER=off, aiEnabled() is false and features fall back to their rules.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
export const DEFAULT_MODEL = 'gemini-flash-lite-latest'
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

export interface JsonSchema {
  name: string
  schema: Record<string, unknown>
}

export interface ChatRequest {
  feature: string
  system: string
  user: string
  schema?: JsonSchema
  temperature?: number
  maxTokens?: number
}

export interface ChatResult<T = unknown> {
  text: string
  json: T | null
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  cached: boolean
}

export interface CallRecord {
  feature: string
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  cached: boolean
  error: string | null
}

export class AiError extends Error {}

type Logger = (record: CallRecord) => void | Promise<void>
let logger: Logger | null = null

/** Register a function that receives every call (the server writes them to the AiCall table). */
export function setCallLogger(fn: Logger | null): void {
  logger = fn
}

export function aiConfig() {
  return {
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    driver: (process.env.AI_DRIVER || '').toLowerCase(),
    cacheDir: process.env.AI_CACHE_DIR || join(process.cwd(), '.cache', 'ai'),
    useCache: (process.env.AI_CACHE || 'on').toLowerCase() !== 'off',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30_000),
  }
}

/** True when a model can be called: a key is set and AI_DRIVER isn't "off". */
export function aiEnabled(): boolean {
  const c = aiConfig()
  return c.driver !== 'off' && c.apiKey.length > 0
}

/** Pulls a JSON object out of a reply: the whole text, a ```json fence, or the outermost {...}. */
export function parseJson<T = unknown>(text: string): T | null {
  const attempts = [text.trim()]
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) attempts.push(fence[1].trim())
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1))
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // try the next form
    }
  }
  return null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function chat<T = unknown>(req: ChatRequest): Promise<ChatResult<T>> {
  const c = aiConfig()
  if (!aiEnabled()) throw new AiError('AI is off: set AI_API_KEY (and leave AI_DRIVER unset) to call a model.')

  const body: Record<string, unknown> = {
    model: c.model,
    temperature: req.temperature ?? 0,
    max_tokens: req.maxTokens ?? 1500,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  }
  if (req.schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: req.schema.name, schema: req.schema.schema } }
  }

  const key = createHash('sha256').update(JSON.stringify({ url: c.baseUrl, body })).digest('hex')
  const cacheFile = join(c.cacheDir, `${key}.json`)
  if (c.useCache && existsSync(cacheFile)) {
    const hit = JSON.parse(readFileSync(cacheFile, 'utf8'))
    const result: ChatResult<T> = { ...hit, json: req.schema ? parseJson<T>(hit.text) : null, cached: true }
    await report(req.feature, result, null)
    return result
  }

  const started = Date.now()
  let lastError = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), c.timeoutMs)
    try {
      const res = await fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const text = data.choices?.[0]?.message?.content ?? ''
        const result: ChatResult<T> = {
          text,
          json: req.schema ? parseJson<T>(text) : null,
          model: c.model,
          latencyMs: Date.now() - started,
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
          cached: false,
        }
        if (c.useCache) {
          mkdirSync(c.cacheDir, { recursive: true })
          const { json: _json, cached: _cached, ...stored } = result
          writeFileSync(cacheFile, JSON.stringify(stored))
        }
        await report(req.feature, result, null)
        return result
      }
      lastError = `HTTP ${res.status}`
      if (!RETRY_STATUS.has(res.status)) break
    } catch (e) {
      lastError = e instanceof Error ? e.name : 'network error'
    } finally {
      clearTimeout(timer)
    }
    await sleep(Math.min(30_000, 2000 * 2 ** attempt))
  }

  const failed: ChatResult<T> = {
    text: '',
    json: null,
    model: c.model,
    latencyMs: Date.now() - started,
    inputTokens: null,
    outputTokens: null,
    cached: false,
  }
  await report(req.feature, failed, lastError)
  throw new AiError(`Model call failed: ${lastError}`)
}

async function report(feature: string, r: ChatResult<unknown>, error: string | null): Promise<void> {
  if (!logger) return
  try {
    await logger({
      feature,
      model: r.model,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cached: r.cached,
      error,
    })
  } catch {
    // logging must never break a feature
  }
}
