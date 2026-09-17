// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const available = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0
const script = resolve('scripts', 'Test-StructuredOutput.ps1')
const key = 'synthetic-probe-key-not-a-real-credential'
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((done, reject) => {
      server.close(error => error ? reject(error) : done())
      server.closeAllConnections()
    })
  }
})

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return `http://127.0.0.1:${address.port}`
}

function run(url: string, extra: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Url', url, '-Model', 'test-model', ...extra], {
      env: { ...process.env, OPENAI_API_KEY: key, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: 'localhost,127.0.0.1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => done({ code, stdout, stderr }))
  })
}

describe.skipIf(!available)('PowerShell structured-output probe', () => {
  it.each(['responses', 'chat-completions'])('sends exactly one %s schema-only challenge and validates the completed output', async apiType => {
    const requests: { path: string | undefined; body: Record<string, unknown> }[] = []
    const base = await listen((request, response) => {
      let raw = ''
      request.on('data', chunk => { raw += String(chunk) })
      request.on('end', () => {
        const body = JSON.parse(raw)
        requests.push({ path: request.url, body })
        expect(request.headers.authorization).toBe(`Bearer ${key}`)
        const format = apiType === 'responses' ? body.text.format : body.response_format.json_schema
        const proof = format.schema.properties.proof.enum[0]
        expect(JSON.stringify(body.input ?? body.messages)).not.toContain(proof)
        expect(format.strict).toBe(true)
        expect(body.store).toBe(false)
        expect(body.stream).toBe(false)
        const text = JSON.stringify({ proof, count: 7, status: 'schema_applied' })
        const envelope = apiType === 'responses'
          ? { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] }
          : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(envelope))
      })
    })
    const result = await run(`${base}/v1`, ['-ApiType', apiType])
    expect(result.stderr).toBe('')
    expect(result.code, result.stdout).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'pass', apiType, requestAccepted: true, schemaConformant: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe(`/v1/${apiType === 'responses' ? 'responses' : 'chat/completions'}`)
    expect(result.stdout).not.toContain(key)
  })

  it.each([
    'UNSTRUCTURED', '{"proof":"ignored","count":7,"status":"schema_applied"}',
    '[]', '{"proof":"ignored","count":"7","status":"schema_applied","extra":true}',
  ])('does not confuse HTTP success with schema compliance (case %#)', async text => {
    const base = await listen((_request, response) => response.end(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }],
    })))
    const result = await run(`${base}/chat/completions`)
    expect(result.code, result.stdout + result.stderr).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      apiType: 'chat-completions', result: 'nonconforming', requestAccepted: true, schemaConformant: false,
    })
  })

  it.each(['wrong-type', 'wrong-enum', 'extra-field', 'missing-field', 'duplicate-field'])(
    'checks the rest of the schema even when the random proof matches (%s)', async violation => {
      const base = await listen((request, response) => {
        let raw = ''
        request.on('data', chunk => { raw += String(chunk) })
        request.on('end', () => {
          const proof = JSON.parse(raw).text.format.schema.properties.proof.enum[0]
          const value: Record<string, unknown> = { proof, count: 7, status: 'schema_applied' }
          if (violation === 'wrong-type') value.count = '7'
          if (violation === 'wrong-enum') value.status = 'SCHEMA_APPLIED'
          if (violation === 'extra-field') value.extra = true
          if (violation === 'missing-field') delete value.status
          const text = violation === 'duplicate-field'
            ? `{"proof":"${proof}","proof":"${proof}","count":7,"status":"schema_applied"}`
            : JSON.stringify(value)
          response.end(JSON.stringify({
            status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
          }))
        })
      })
      const result = await run(base)
      expect(result.code, result.stdout + result.stderr).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({ result: 'nonconforming', schemaConformant: false })
    },
  )

  it.each([401, 429, 400, 503])('keeps HTTP %s failures inconclusive and redacts response details', async status => {
    const base = await listen((_request, response) => {
      response.writeHead(status)
      response.end(`Private service details including ${key}`)
    })
    const result = await run(base)
    expect(result.code).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'inconclusive', httpStatus: status, schemaConformant: null })
    expect(result.stdout + result.stderr).not.toContain(key)
  })

  it.each([
    { status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: key }] }] },
    { unexpected: key },
  ])('reports incomplete, refused, or invalid API responses as inconclusive (case %#)', async envelope => {
    const base = await listen((_request, response) => response.end(JSON.stringify(envelope)))
    const result = await run(base)
    expect(result.code).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ result: 'inconclusive', schemaConformant: null })
    expect(result.stdout + result.stderr).not.toContain(key)
  })

  it('never follows redirects or sends credentials to their target', async () => {
    let followed = false
    const target = await listen((_request, response) => { followed = true; response.end() })
    const base = await listen((_request, response) => {
      response.writeHead(307, { Location: target })
      response.end()
    })
    const result = await run(base)
    expect(result.code).toBe(2)
    expect(followed).toBe(false)
    expect(JSON.parse(result.stdout).detail).toContain('redirect')
  })

  it('rejects conflicting protocols before sending a request', async () => {
    let called = false
    const base = await listen((_request, response) => { called = true; response.end() })
    const result = await run(`${base}/responses`, ['-ApiType', 'chat-completions'])
    expect(result.code).toBe(2)
    expect(called).toBe(false)
    expect(JSON.parse(result.stdout).detail).toContain('conflicts')
  })

  it('bounds stalled response-body reads and oversized responses', async () => {
    const stalled = await listen((_request, response) => { response.writeHead(200); response.write('{"status":') })
    const timeout = await run(stalled, ['-TimeoutSeconds', '1'])
    expect(timeout.code).toBe(2)
    expect(JSON.parse(timeout.stdout).detail).toContain('timed out')
    const large = await listen((_request, response) => {
      response.writeHead(200, { 'Content-Length': 256 * 1024 + 1 })
      response.end()
    })
    const oversized = await run(large)
    expect(oversized.code).toBe(2)
    expect(JSON.parse(oversized.stdout).detail).toContain('safety limit')
  })
})
