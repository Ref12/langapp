import { gitBlobSha } from './github'

// A small in-memory GitHub: blobs, trees, commits and one branch ref, with hooks to move the ref mid-publish.
export function fakeGitHub(options: { empty?: boolean; failPatches?: number } = {}) {
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
    if (method === 'GET' && /^\/contents\/(lab\/)?profiles\/p1\/profile.yaml$/.test(path)) return new Response('id: p1\nname: "Main"\n')
    return json({ message: 'unexpected ' + method + ' ' + path }, 500)
  }) as typeof fetch
  return { fetcher, log, requests, blobs, headCommit: () => head!, commits, trees, count: (prefix: string) => log.filter(line => line.startsWith(prefix)).length }
}
