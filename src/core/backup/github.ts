import { BackupError, StaleBackupError, type BackupBackend, type BackupProfileInfo, type BackupVersion, type CallTrace, type DeltaResult, type PublishResult, type RemoteState } from './backend'

export interface GitHubTarget {
  owner: string
  repo: string
  token: string
  branch?: string
}

type Fetch = typeof fetch
const API = 'https://api.github.com'
export const MAX_PUBLISH_ATTEMPTS = 4

/** Git blob id of text, so unchanged files can be skipped without uploading. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const header = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(header.length + body.length)
  all.set(header); all.set(body, header.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string }

export class GitHubBackend implements BackupBackend {
  private readonly branch: string
  constructor(private readonly target: GitHubTarget, private readonly request: Fetch = (...args) => fetch(...args), private readonly retryDelayMs = 400) {
    this.branch = target.branch || 'main'
  }

  /** Round trips since the last publishDelta began. */
  private traces: CallTrace[] = []

  private async call<T>(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<{ status: number; data: T }> {
    let response: Response
    const began = performance.now()
    try {
      response = await this.request(`${API}/repos/${this.target.owner}/${this.target.repo}${path}`, {
        method,
        headers: {
          Accept: accept, Authorization: `Bearer ${this.target.token}`, 'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new BackupError('Could not reach GitHub. Check your connection.')
    }
    this.traces.push({ method, path: path.replace(/[0-9a-f]{40}/g, '<sha>').replace(/\?.*$/, ''), status: response.status, ms: Math.round(performance.now() - began) })
    if (!response.ok) {
      let detail = ''
      try { detail = String(((await response.json()) as { message?: unknown }).message ?? '') } catch { /* no body */ }
      if (response.status === 401) throw new BackupError('GitHub rejected the token (401). Check that it is valid and not expired.', 401)
      if (response.status === 403) throw new BackupError(`GitHub refused the request (403). ${detail}`.trim(), 403)
      if (response.status === 404) throw new BackupError('GitHub could not find the repository or branch (404). Check owner, repo and token access.', 404)
      throw new BackupError(`GitHub request failed (${response.status}). ${detail}`.trim(), response.status)
    }
    const data = accept.includes('raw') ? await response.text() : response.status === 204 ? undefined : await response.json()
    return { status: response.status, data: data as T }
  }

  private async headCommit(): Promise<string | undefined> {
    try {
      const { data } = await this.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${this.branch}`)
      return data.object.sha
    } catch (error) {
      // An empty repository has no refs (409/404): the first publish initializes it.
      if (error instanceof BackupError && (error.status === 404 || error.status === 409)) return undefined
      throw error
    }
  }

  private async treeOf(commitSha: string): Promise<{ sha: string; entries: TreeEntry[] }> {
    const { data: commit } = await this.call<{ tree: { sha: string } }>('GET', `/git/commits/${commitSha}`)
    const { data } = await this.call<{ tree: TreeEntry[]; truncated?: boolean }>('GET', `/git/trees/${commit.tree.sha}?recursive=1`)
    if (data.truncated) throw new BackupError('The backup repository is too large to list. Use a dedicated repository.')
    return { sha: commit.tree.sha, entries: data.tree }
  }

  async listProfiles(): Promise<BackupProfileInfo[]> {
    const head = await this.headCommit()
    if (!head) return []
    const { entries } = await this.treeOf(head)
    const ids = [...new Set(entries.filter(entry => entry.type === 'blob' && /^profiles\/[^/]+\//.test(entry.path)).map(entry => entry.path.split('/')[1]))]
    return Promise.all(ids.map(async id => {
      try {
        const { data } = await this.call<string>('GET', `/contents/profiles/${id}/profile.yaml?ref=${encodeURIComponent(this.branch)}`, undefined, 'application/vnd.github.raw+json')
        const name = /^name:\s*(.+)$/m.exec(data)?.[1]?.trim().replace(/^["']|["']$/g, '')
        return { id, ...(name ? { name } : {}) }
      } catch { return { id } }
    }))
  }

  async listVersions(profileId: string, limit = 30): Promise<BackupVersion[]> {
    const { data } = await this.call<{ sha: string; commit: { message: string; committer: { date: string } } }[]>(
      'GET', `/commits?sha=${encodeURIComponent(this.branch)}&path=profiles/${profileId}&per_page=${limit}`)
    return data.map(item => ({ id: item.sha, date: item.commit.committer.date, message: item.commit.message.split('\n')[0] }))
  }

  async readFiles(profileId: string, version?: string): Promise<Map<string, string>> {
    const commit = version ?? await this.headCommit()
    if (!commit) throw new BackupError('The backup repository is empty.')
    const prefix = `profiles/${profileId}/`
    const { entries } = await this.treeOf(commit)
    const files = new Map<string, string>()
    const wanted = entries.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix))
    const queue = [...wanted]
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const { data } = await this.call<{ content: string }>('GET', `/git/blobs/${entry.sha}`)
        files.set(entry.path.slice(prefix.length), decodeBase64(data.content))
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    return files
  }

  async publish(profileId: string, files: Map<string, string>, message: string): Promise<PublishResult> {
    const prefix = `profiles/${profileId}/`
    const blobs = new Map<string, string>() // content sha -> uploaded blob sha, kept across retries
    let lastConflict: unknown
    for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * attempt))
      let head = await this.headCommit()
      if (!head) head = await this.initialize()
      const { sha: baseTree, entries } = await this.treeOf(head)
      const remote = new Map(entries.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix)).map(entry => [entry.path, entry.sha]))
      const changes: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
      for (const [path, text] of files) {
        const full = prefix + path
        const local = await gitBlobSha(text)
        if (remote.get(full) === local) continue
        let uploaded = blobs.get(local)
        if (!uploaded) {
          const { data } = await this.call<{ sha: string }>('POST', '/git/blobs', { content: text, encoding: 'utf-8' })
          uploaded = data.sha
          blobs.set(local, uploaded)
        }
        changes.push({ path: full, mode: '100644', type: 'blob', sha: uploaded })
      }
      let removed = 0
      for (const path of remote.keys()) {
        if (!files.has(path.slice(prefix.length))) { changes.push({ path, mode: '100644', type: 'blob', sha: null }); removed++ }
      }
      if (!changes.length) return { changed: 0, removed: 0 }
      const { data: tree } = await this.call<{ sha: string }>('POST', '/git/trees', { base_tree: baseTree, tree: changes })
      const { data: commit } = await this.call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [head] })
      try {
        await this.call('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false })
        return { version: commit.sha, changed: changes.length - removed, removed }
      } catch (error) {
        // 422: the branch moved since we read it (another device or tab). Re-read and rebuild on the new head.
        if (error instanceof BackupError && (error.status === 422 || error.status === 409)) { lastConflict = error; continue }
        throw error
      }
    }
    throw new BackupError(`The backup branch kept changing (${lastConflict instanceof Error ? lastConflict.message : 'conflict'}). Try again.`, 409)
  }

  async publishDelta(profileId: string, files: Map<string, string>, keep: Set<string>, message: string, known?: RemoteState): Promise<DeltaResult> {
    this.traces = []
    const prefix = `profiles/${profileId}/`
    const hashes = new Map<string, string>()
    await Promise.all([...files].map(async ([path, text]) => { hashes.set(path, await gitBlobSha(text)) }))
    let lastConflict: unknown
    for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * attempt))
      let head = await this.headCommit()
      if (!head) head = await this.initialize()
      let remote: RemoteState
      if (known && known.head === head) remote = known
      else {
        const { sha, entries } = await this.treeOf(head)
        remote = { head, tree: sha, files: Object.fromEntries(entries.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix)).map(entry => [entry.path.slice(prefix.length), entry.sha])) }
      }
      for (const path of keep) if (!(path in remote.files)) throw new StaleBackupError(`The backup repository no longer has ${path}.`)
      const changes: { path: string; mode: '100644'; type: 'blob'; content?: string; sha?: null }[] = []
      const next = { ...remote.files }
      for (const [path, text] of files) {
        if (remote.files[path] === hashes.get(path)) continue
        changes.push({ path: prefix + path, mode: '100644', type: 'blob', content: text })
        next[path] = hashes.get(path)!
      }
      let removed = 0
      for (const path of Object.keys(remote.files)) {
        if (!files.has(path) && !keep.has(path)) { changes.push({ path: prefix + path, mode: '100644', type: 'blob', sha: null }); delete next[path]; removed++ }
      }
      if (!changes.length) return { changed: 0, removed: 0, remote, calls: this.traces }
      const { data: tree } = await this.call<{ sha: string }>('POST', '/git/trees', { base_tree: remote.tree, tree: changes })
      const { data: commit } = await this.call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [head] })
      try {
        await this.call('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false })
        return { version: commit.sha, changed: changes.length - removed, removed, remote: { head: commit.sha, tree: tree.sha, files: next }, calls: this.traces }
      } catch (error) {
        if (error instanceof BackupError && (error.status === 422 || error.status === 409)) { lastConflict = error; known = undefined; continue }
        throw error
      }
    }
    throw new BackupError(`The backup branch kept changing (${lastConflict instanceof Error ? lastConflict.message : 'conflict'}). Try again.`, 409)
  }

  /** The Git Data API needs one commit to exist; the contents API creates it in an empty repository. */
  private async initialize(): Promise<string> {
    await this.call('PUT', '/contents/README.md', { message: 'Initialize backup repository', content: btoa('# Language app profile backups\n'), branch: this.branch })
    const head = await this.headCommit()
    if (!head) throw new BackupError('The backup repository could not be initialized.')
    return head
  }
}
