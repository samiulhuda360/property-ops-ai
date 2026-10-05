import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError, aiEnabled, chat, parseJson, setCallLogger, type CallRecord } from '../src/ai/llm'

const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
    status,
  })

describe('llm client', () => {
  beforeEach(() => {
    process.env.AI_API_KEY = 'test-key'
    process.env.AI_DRIVER = ''
    process.env.AI_CACHE_DIR = mkdtempSync(join(tmpdir(), 'ai-cache-'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    setCallLogger(null)
  })

  it('is off without a key or when AI_DRIVER=off', () => {
    expect(aiEnabled()).toBe(true)
    process.env.AI_DRIVER = 'off'
    expect(aiEnabled()).toBe(false)
    process.env.AI_DRIVER = ''
    process.env.AI_API_KEY = ''
    expect(aiEnabled()).toBe(false)
  })

  it('parses JSON from plain text, fences and surrounding prose', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJson('Result {"a":3} done')).toEqual({ a: 3 })
    expect(parseJson('no json')).toBeNull()
  })

  it('sends the schema, parses the reply, caches it and logs every call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply('{"category":"rent"}'))
    const calls: CallRecord[] = []
    setCallLogger((r) => {
      calls.push(r)
    })
    const req = { feature: 'test', system: 's', user: 'u', schema: { name: 'x', schema: { type: 'object' } } }

    const first = await chat<{ category: string }>(req)
    expect(first.json).toEqual({ category: 'rent' })
    expect(first.cached).toBe(false)
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(sent.response_format.type).toBe('json_schema')

    const second = await chat<{ category: string }>(req)
    expect(second.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.map((c) => c.cached)).toEqual([false, true])
  })

  it('retries rate limits, then gives up on a bad request', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply('', 429))
      .mockResolvedValueOnce(reply('{"ok":true}'))
    const ok = await chat({ feature: 't', system: 's', user: 'retry', schema: { name: 'x', schema: {} } })
    expect(ok.json).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockResolvedValue(reply('', 400))
    await expect(chat({ feature: 't', system: 's', user: 'bad' })).rejects.toBeInstanceOf(AiError)
  })
})
