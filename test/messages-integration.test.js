/**
 * Integration tests for POST /v1/messages — real server end-to-end.
 *
 * Starts the actual ModelRelay server on a fixed port (7777) to ensure
 * the server's internal loopback (localhost:${port}) works correctly.
 *
 * A mock OpenAI server is used as the backend.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { runServer } from '../lib/server.js'
import { loadConfig } from '../lib/config.js'

const TEST_PORT = 7777
const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 30_000

// ─── Mock OpenAI-compatible server ───

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = req.url || '/'
      const pathname = reqUrl.split('?')[0]

      if (req.method === 'GET' && pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          object: 'list',
          data: [{ id: 'auto-fastest', object: 'model' }],
        }))
        return
      }

      if (req.method === 'POST' && pathname === '/v1/chat/completions') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            const id = 'chatcmpl-mock-' + Date.now()
            const ts = Math.floor(Date.now() / 1000)

            if (parsed.stream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              })
              const events = [
                { id, object: 'chat.completion.chunk', created: ts, model: 'auto-fastest', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
                { id, object: 'chat.completion.chunk', created: ts, model: 'auto-fastest', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
                { id, object: 'chat.completion.chunk', created: ts, model: 'auto-fastest', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
              ]
              for (const ev of events) {
                res.write(`data: ${JSON.stringify(ev)}\n\n`)
              }
              res.write('data: [DONE]\n\n')
              res.end()
            } else {
              const responseText = parsed.messages?.length > 0
                ? 'Hello! I am a mock model providing a comprehensive response.'
                : 'Hello!'
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                id,
                object: 'chat.completion',
                created: ts,
                model: 'auto-fastest',
                choices: [{
                  index: 0,
                  message: { role: 'assistant', content: responseText },
                  finish_reason: 'stop',
                }],
                usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
              }))
            }
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end('Not found')
    })

    server.listen(0, () => resolve(server))
  })
}

function getServerPort(server) {
  return server.address().port
}

async function waitForModelUp(baseUrl, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/models`)
      if (res.ok) {
        const data = await res.json()
        const upModel = data.models?.find(m => m.status === 'up')
        if (upModel) return upModel
      }
    } catch { /* server not ready */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  const res = await fetch(`${baseUrl}/api/models`)
  const data = res.ok ? await res.json() : { models: [] }
  const statuses = data.models?.map(m => `${m.modelId} | ${m.providerKey} | ${m.status}`) || []
  throw new Error(`Timed out waiting for model to be up. Statuses: [${statuses.join(', ')}]`)
}

async function waitForServerReady(baseUrl, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/v1/models`)
      if (res.ok) return
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`)
}

// ─── Tests ───

describe('POST /v1/messages — server integration', () => {
  let mockServer
  let server
  let port
  let baseUrl

  before(async () => {
    // 1. Start mock OpenAI server on a random port
    mockServer = await startMockServer()
    const mockPort = getServerPort(mockServer)

    // 2. Start ModelRelay on fixed port 7777 (so the server's `port` param remains 7777)
    const config = loadConfig()
    server = await runServer(config, TEST_PORT)
    port = getServerPort(server)
    baseUrl = `http://localhost:${port}`

    // 3. Wait for server to accept requests
    await waitForServerReady(baseUrl)

    // 4. Register the mock as openai-compatible endpoint via API
    const registerRes = await fetch(
      `${baseUrl}/api/openai-compatible/endpoints`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'mock-test',
          name: 'Mock Test Provider',
          baseUrl: `http://localhost:${mockPort}`,
          modelId: 'auto-fastest',
          apiKey: 'mock-key',
          enabled: true,
          discoverModels: false,
        }),
      }
    )
    const registerBody = await registerRes.text()
    assert.ok(
      registerRes.ok,
      `Failed to register mock: ${registerRes.status} - ${registerBody}`
    )

    // 5. Wait for health check to mark the model as 'up'
    await waitForModelUp(baseUrl)
  })

  after(async () => {
    try {
      await fetch(
        `${baseUrl}/api/openai-compatible/endpoints/mock-test`,
        { method: 'DELETE' }
      )
    } catch { /* ignore */ }
    if (server) server.close()
    if (mockServer) mockServer.close()
  })

  /* --- Non-streaming --- */

  it('returns 200 with correct Anthropic structure (non-streaming)', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hello in one word' }],
      }),
    })

    assert.equal(res.status, 200)
    assert.ok(res.headers.get('content-type').includes('application/json'))

    const body = await res.json()
    assert.equal(body.type, 'message')
    assert.equal(body.role, 'assistant')
    assert.ok(typeof body.id === 'string' && body.id.startsWith('msg_'))
    assert.ok(Array.isArray(body.content))
    assert.ok(body.content.length > 0)
    assert.equal(body.content[0].type, 'text')
    assert.ok(typeof body.content[0].text === 'string')
    assert.ok(body.content[0].text.length > 0)
    assert.ok(typeof body.stop_reason === 'string')
    assert.ok(body.usage && typeof body.usage.input_tokens === 'number')
    assert.ok(body.usage && typeof body.usage.output_tokens === 'number')
  })

  it('returns correct model name in response', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    })
    const body = await res.json()
    assert.ok(typeof body.model === 'string' && body.model.length > 0)
    assert.equal(body.stop_reason, 'end_turn')
  })

  it('includes stop_reason end_turn for normal completion', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    })
    const body = await res.json()
    assert.equal(body.stop_reason, 'end_turn')
    assert.equal(body.content[0].type, 'text')
  })

  /* --- Streaming --- */

  it('streams correct Anthropic SSE event sequence', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        stream: true,
        messages: [{ role: 'user', content: 'Say hello in one word' }],
      }),
    })

    assert.equal(res.status, 200)
    assert.ok(res.headers.get('content-type').includes('text/event-stream'))

    const raw = await res.text()
    const events = raw
      .split('\n\n')
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const dataLine = block.split('\n').find(l => l.startsWith('data: '))
        if (!dataLine) return null
        try { return JSON.parse(dataLine.slice(6)) }
        catch { return null }
      })
      .filter(Boolean)

    assert.ok(events.length >= 4, `Expected at least 4 events, got ${events.length}`)

    assert.equal(events[0].type, 'message_start')
    assert.ok(events[0].message)
    assert.ok(events[0].message.id)
    assert.ok(Array.isArray(events[0].message.content))

    const startEvents = events.filter(e => e.type === 'content_block_start')
    assert.ok(startEvents.length >= 1)
    assert.equal(startEvents[0].content_block.type, 'text')

    assert.ok(events.some(e => e.type === 'content_block_delta'))
    assert.ok(events.some(e => e.type === 'content_block_stop'))

    const lastTwo = events.slice(-2)
    assert.equal(lastTwo[0].type, 'message_delta')
    assert.equal(lastTwo[0].delta?.stop_reason, 'end_turn')
    assert.equal(lastTwo[1].type, 'message_stop')
  })

  it('streaming events follow correct ordering', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        stream: true,
        messages: [{ role: 'user', content: 'Count 1 2 3' }],
      }),
    })

    const raw = await res.text()
    const eventTypes = raw
      .split('\n\n')
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const dataLine = block.split('\n').find(l => l.startsWith('data: '))
        if (!dataLine) return null
        try { return JSON.parse(dataLine.slice(6)).type }
        catch { return null }
      })
      .filter(Boolean)

    const validOrder = [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]
    let idx = 0
    for (const eventType of eventTypes) {
      if (idx < validOrder.length - 1 && eventType === validOrder[idx + 1]) {
        idx++
      }
      if (idx >= 2 && idx <= 3 && eventType === 'content_block_delta') {
        continue
      }
      assert.equal(eventType, validOrder[idx], `Expected ${validOrder[idx]} but got ${eventType}`)
    }

    assert.equal(eventTypes[eventTypes.length - 1], 'message_stop')
    assert.equal(eventTypes[eventTypes.length - 2], 'message_delta')
  })

  /* --- Other endpoints --- */

  it('GET /v1/models returns Anthropic model list', async () => {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { 'anthropic-version': '2023-06-01' },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.data))
    assert.ok(body.data.some(m => m.id.startsWith('claude')))
  })

  it('POST /v1/messages/count_tokens returns stub', async () => {
    const res = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).input_tokens, 0)
  })

  /* --- Edge cases --- */

  it('returns 400 for missing model field', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    assert.equal(res.status, 400)
  })

  it('returns 400 for empty messages array', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [],
      }),
    })
    assert.equal(res.status, 400)
  })

  it('ignores unknown query parameters', async () => {
    const res = await fetch(`${baseUrl}/v1/messages?beta=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    assert.equal(res.status, 200)
  })

  it('returns Content-Type application/json for non-streaming', async () => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    assert.ok(res.headers.get('content-type').includes('application/json'))
  })
})
