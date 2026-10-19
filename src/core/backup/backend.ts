// Storage backend for profile backups. The format (file layout and content) is
// independent of it, so another backend (e.g. Azure append blobs for journal
// segments and block blobs for everything else) can be added without changing files.

export interface BackupVersion {
  id: string
  date: string
  message: string
}

export interface BackupProfileInfo {
  id: string
  name?: string
}

export interface PublishResult {
  /** Undefined when nothing differed from the stored backup. */
  version?: string
  changed: number
  removed: number
}

export interface BackupBackend {
  /** Profile ids stored in the backup, with names when readable. */
  listProfiles(): Promise<BackupProfileInfo[]>
  /** Newest first. */
  listVersions(profileId: string, limit?: number): Promise<BackupVersion[]>
  /** Every file of the profile (paths relative to the profile folder) at a version, or the latest. */
  readFiles(profileId: string, version?: string): Promise<Map<string, string>>
  /** Makes the stored profile equal to `files` as one atomic version; unchanged files are not rewritten. */
  publish(profileId: string, files: Map<string, string>, message: string): Promise<PublishResult>
}

export class BackupError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BackupError'
  }
}
