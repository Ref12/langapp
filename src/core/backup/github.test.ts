import { describe, expect, it } from 'vitest'
import { BackupError, StaleBackupError } from './backend'
import { GitHubBackend, gitBlobSha, MAX_PUBLISH_ATTEMPTS } from './github'

// A small in-memory GitHub: blobs, trees, commits and one branch ref, with hooks to move the ref mid-publish.
function fakeGitHub(options: { empty?: boolean; failPatches?: number } = {}) {
  const blobs = new Map<string, string>()
  const trees = new Map<string, Map<string, string>>()
  const commits = new Map<string, { tree: string; parents: string[]; message: string; date: string }>()
  let head: string | undefined
  let counter = 0
  const log: string[] = []
  const state = { patchFailures: options.failPatches ?? 0 }
  const makeTree = (entries: Map<string, string>) => { const sha = `tree${++counter}`; trees.set(sha, entries); return sha }
  const makeCommit = (tree: string, parents: string[], message: string) => { const sha = `commit${++counter}`; commits.set(sha, { tree, parents, message, date: `2026-10-19T10:00:${String(counter).padStart(2, '0')}Z` }); return sha }
  if (!options.empty) head = makeCommit(makeTree(new Map([['README.md', 'seed']])), [], 'seed')
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  const requests: { method: string; path: string; headers: Headers; body?: { message?: string; tree?: { path: string; sha: string | null }[]; [key: string]: unknown } }[] = []

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace('/repos/me/backups', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method, path, headers: new Headers(init?.headers), body })
    log.push(`${method} ${path}`)
    let match: RegExpExecArray | null
    if (method === 'GET' && path === '/git/ref/heads/main') return head ? json({ object: { sha: head } }) : json({ message: 'Git Repository is empty.' }, 409)
    if (method === 'PUT' && path === '/contents/README.md') {
      head = makeCommit(makeTree(new Map([['README.md', 'seed']])), [], body.message)
      return json({}, 201)
    }
    if ((match = /^\/git\/commits\/(.+)$/.exec(path)) && method === 'GET') return json({ tree: { sha: commits.get(match[1])!.tree } })
    if ((match = /^\/git\/trees\/(.+)$/.exec(path)) && method === 'GET') {
      return json({ truncated: false, tree: [...trees.get(match[1])!].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) })
    }
    if (method === 'POST' && path === '/git/blobs') { const sha = await gitBlobSha(body.content); blobs.set(sha, body.content); return json({ sha }, 201) }
    if ((match = /^\/git\/blobs\/(.+)$/.exec(path)) && method === 'GET') return json({ content: btoa(unescape(encodeURIComponent(blobs.get(match[1]) ?? 'seed'))), encoding: 'base64' })
    if (method === 'POST' && path === '/git/trees') {
      const base = [...trees.entries()].find(([sha]) => sha === body.base_tree)![1]
      const merged = new Map(base)
      for (const item of body.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (item.sha === null) merged.delete(item.path)
        else if (item.content !== undefined) { const sha = await gitBlobSha(item.content); blobs.set(sha, item.content); merged.set(item.path, sha) }
        else merged.set(item.path, item.sha!)
      }
      return json({ sha: makeTree(merged) }, 201)
    }
    if (method === 'POST' && path === '/git/commits') return json({ sha: makeCommit(body.tree, body.parents, body.message) }, 201)
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (state.patchFailures > 0) {
        state.patchFailures--
        // Another device committed first.
        const other = new Map(trees.get(commits.get(head!)!.tree)!)
        other.set('other-device.txt', 'x')
        head = makeCommit(makeTree(other), [head!], 'other device')
      }
      if (!commits.get(body.sha)!.parents.includes(head!)) return json({ message: 'Update is not a fast forward' }, 422)
      head = body.sha
      return json({ object: { sha: head } })
    }
    if (method === 'GET' && path === '/commits') {
      const list: string[] = []
      for (let sha: string | undefined = head; sha; sha = commits.get(sha)!.parents[0]) list.push(sha)
      return json(list.map(sha => ({ sha, commit: { message: commits.get(sha)!.message, committer: { date: commits.get(sha)!.date } } })))
    }
    if (method === 'GET' && path === '/contents/profiles/p1/profile.yaml') return new Response('id: p1\nname: "Main"\n')
    return json({ message: 'unexpected ' + method + ' ' + path }, 500)
  }) as typeof fetch
  return { fetcher, log, requests, blobs, headCommit: () => head!, commits, trees, count: (prefix: string) => log.filter(line => line.startsWith(prefix)).length }
}

const backend = (fake: ReturnType<typeof fakeGitHub>) => new GitHubBackend({ owner: 'me', repo: 'backups', token: 'secret-token' }, fake.fetcher, 0)
const files = (extra: Record<string, string> = {}) => new Map(Object.entries({ 'settings.yaml': 'a: 1\n', 'checkpoint.yaml': 'b: 2\n', 'journal/2026-10.yaml': '- {t: 2026-10-19T00:00:00.000Z, op: add}\n', ...extra }))

describe('incremental publish', () => {
  const none = new Set<string>()
  it('sends only changed files in one tree, commit and ref update (4 round trips with a warm cache), none when nothing changed', async () => {
    const fake = fakeGitHub()
    const b = backend(fake)
    const first = await b.publishDelta('p1', files({ 'journal/000000001-000000001.yaml': 'e1\n' }), none, 'one')
    expect(first.calls.map(call => call.method + ' ' + call.path.replace(/(commits|trees)\/.*$/, '$1/_'))).toEqual(['GET /git/ref/heads/main', 'GET /git/commits/_', 'GET /git/trees/_', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main'])
    expect(fake.count('POST /git/blobs')).toBe(0) // content travels inside the tree
    fake.log.length = 0
    const next = files({ 'journal/000000001-000000001.yaml': 'e1\n', 'journal/000000002-000000002.yaml': 'e2\n' })
    const second = await b.publishDelta('p1', next, none, 'two', first.remote)
    expect(second).toMatchObject({ changed: 1, removed: 0 })
    expect(fake.log).toEqual(['GET /git/ref/heads/main', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main'])
    fake.log.length = 0
    const same = await b.publishDelta('p1', next, none, 'three', second.remote)
    expect(same).toMatchObject({ changed: 0, removed: 0 })
    expect(fake.log).toEqual(['GET /git/ref/heads/main'])
  })

  it('keeps named files without sending them, removes the rest, and re-reads the tree when the branch moved', async () => {
    const fake = fakeGitHub()
    const b = backend(fake)
    const first = await b.publishDelta('p1', files({ 'journal/a.yaml': 'old\n' }), none, 'one')
    const second = await b.publishDelta('p1', new Map([['settings.yaml', 'a: 1\n']]), new Set(['journal/a.yaml']), 'keep', first.remote)
    const tree = fake.trees.get(fake.commits.get(second.version ?? fake.headCommit())!.tree)!
    expect(tree.has('profiles/p1/journal/a.yaml')).toBe(true)
    expect(tree.has('profiles/p1/checkpoint.yaml')).toBe(false)
    // Another device committed: the remembered tree is not trusted.
    const stale = { ...second.remote, head: 'not-the-head' }
    fake.log.length = 0
    await b.publishDelta('p1', new Map([['settings.yaml', 'a: 2\n']]), new Set(['journal/a.yaml']), 'moved', stale)
    expect(fake.log.some(line => line.startsWith('GET /git/trees/'))).toBe(true)
  })

  it('reports a kept file that is missing so the caller can start a full backup', async () => {
    const fake = fakeGitHub()
    await expect(backend(fake).publishDelta('p1', files(), new Set(['journal/gone.yaml']), 'x')).rejects.toBeInstanceOf(StaleBackupError)
  })

  it('records every round trip without the token', async () => {
    const fake = fakeGitHub()
    const result = await backend(fake).publishDelta('p1', files(), none, 'x')
    expect(result.calls.every(call => call.status >= 200 && call.ms >= 0)).toBe(true)
    expect(JSON.stringify(result.calls)).not.toContain('secret-token')
  })
})

describe('GitHub backend', () => {
  it('writes every changed file as one commit through the Git Data API, with the token in the Authorization header', async () => {
    const fake = fakeGitHub()
    const result = await backend(fake).publish('p1', files(), 'Backup one')
    expect(result.changed).toBe(3)
    expect(fake.count('POST /git/blobs')).toBe(3)
    expect(fake.count('POST /git/trees')).toBe(1)
    expect(fake.count('POST /git/commits')).toBe(1)
    expect(fake.count('PATCH /git/refs/heads/main')).toBe(1)
    expect(fake.requests[0].headers.get('Authorization')).toBe('Bearer secret-token')
    expect(fake.headCommit()).toBe(result.version)
    const tree = fake.trees.get(fake.commits.get(result.version!)!.tree)!
    expect([...tree.keys()].sort()).toEqual(['README.md', 'profiles/p1/checkpoint.yaml', 'profiles/p1/journal/2026-10.yaml', 'profiles/p1/settings.yaml'])
    expect(fake.commits.get(result.version!)!.message).toBe('Backup one')
  })

  it('skips unchanged files, deletes removed ones, and makes no commit when nothing changed', async () => {
    const fake = fakeGitHub()
    const b = backend(fake)
    await b.publish('p1', files({ 'library/x.yaml': 'x: 1\n' }), 'one')
    const commitsBefore = fake.count('POST /git/commits')
    const blobsBefore = fake.count('POST /git/blobs')
    expect(await b.publish('p1', files({ 'library/x.yaml': 'x: 1\n' }), 'again')).toEqual({ changed: 0, removed: 0 })
    expect(fake.count('POST /git/commits')).toBe(commitsBefore)
    const second = await b.publish('p1', files({ 'checkpoint.yaml': 'b: 3\n' }), 'two')
    expect(fake.count('POST /git/blobs')).toBe(blobsBefore + 1)
    expect(second).toMatchObject({ changed: 1, removed: 1 })
    expect([...fake.trees.get(fake.commits.get(second.version!)!.tree)!.keys()]).not.toContain('profiles/p1/library/x.yaml')
  })

  it('retries on top of the new head when the branch moved (conflict), keeping the other device\'s files', async () => {
    const fake = fakeGitHub({ failPatches: 1 })
    const result = await backend(fake).publish('p1', files(), 'racing')
    expect(fake.count('PATCH /git/refs/heads/main')).toBe(2) // rejected once (not a fast-forward), then accepted
    const tree = fake.trees.get(fake.commits.get(fake.headCommit())!.tree)!
    expect(tree.has('other-device.txt')).toBe(true)
    expect(tree.has('profiles/p1/settings.yaml')).toBe(true)
    expect(result.version).toBe(fake.headCommit())
    expect(fake.count('POST /git/blobs')).toBe(3) // blobs are uploaded once and reused on retry
  })

  it('gives up with a clear error after repeated conflicts', async () => {
    const fake = fakeGitHub({ failPatches: 99 })
    await expect(backend(fake).publish('p1', files(), 'x')).rejects.toThrow(/kept changing/)
    expect(fake.count('PATCH /git/refs/heads/main')).toBe(MAX_PUBLISH_ATTEMPTS)
  })

  it('initializes an empty repository before the first backup', async () => {
    const fake = fakeGitHub({ empty: true })
    const result = await backend(fake).publish('p1', files(), 'first')
    expect(fake.count('PUT /contents/README.md')).toBe(1)
    expect(result.version).toBe(fake.headCommit())
    expect(await backend(fake).listProfiles()).toEqual([{ id: 'p1', name: 'Main' }])
  })

  it('lists profiles and versions and reads a version back', async () => {
    const fake = fakeGitHub()
    const b = backend(fake)
    const first = await b.publish('p1', files(), 'first backup')
    await b.publish('p1', files({ 'checkpoint.yaml': 'b: 9\n' }), 'second backup')
    expect(await b.listProfiles()).toEqual([{ id: 'p1', name: 'Main' }])
    const versions = await b.listVersions('p1')
    expect(versions.map(version => version.message).slice(0, 2)).toEqual(['second backup', 'first backup'])
    const old = await b.readFiles('p1', first.version)
    expect(old.get('checkpoint.yaml')).toBe('b: 2\n')
    expect(Object.fromEntries(await b.readFiles('p1'))).toMatchObject({ 'checkpoint.yaml': 'b: 9\n', 'settings.yaml': 'a: 1\n' })
  })

  it('reports authentication and reachability problems in plain words', async () => {
    const denied = new GitHubBackend({ owner: 'me', repo: 'backups', token: 'bad' }, (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as typeof fetch, 0)
    await expect(denied.publish('p1', files(), 'x')).rejects.toThrow(/token/)
    const offline = new GitHubBackend({ owner: 'me', repo: 'backups', token: 't' }, (async () => { throw new TypeError('fetch failed') }) as typeof fetch, 0)
    await expect(offline.publish('p1', files(), 'x')).rejects.toBeInstanceOf(BackupError)
  })
})
