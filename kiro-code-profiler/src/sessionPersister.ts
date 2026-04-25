import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileSession, SessionSummary } from './types';

export class SessionPersister {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  private sessionsDir(workspacePath: string): string {
    return path.join(workspacePath, '.kiro', 'profiler', 'sessions');
  }

  private sessionFilePath(workspacePath: string, sessionId: string): string {
    return path.join(this.sessionsDir(workspacePath), `${sessionId}.json`);
  }

  async save(session: ProfileSession): Promise<void> {
    const dir = this.sessionsDir(this.workspacePath);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.sessionFilePath(this.workspacePath, session.id);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<ProfileSession> {
    const filePath = this.sessionFilePath(this.workspacePath, sessionId);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ProfileSession;
  }

  async list(workspacePath: string): Promise<SessionSummary[]> {
    const dir = this.sessionsDir(workspacePath);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const summaries: SessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const session = JSON.parse(raw) as ProfileSession;
        summaries.push({
          id: session.id,
          filePath: session.filePath,
          sessionType: session.sessionType,
          startTime: session.startTime,
          endTime: session.endTime,
          peakRamMb: session.metrics.peakRamMb,
          avgCpuPercent: session.metrics.avgCpuPercent,
          executionTimeMs: session.metrics.executionTimeMs,
          isBaseline: session.isBaseline,
        });
      } catch {
        // skip malformed files
      }
    }

    return summaries.sort((a, b) => b.startTime - a.startTime);
  }

  async clear(workspacePath: string): Promise<void> {
    const dir = this.sessionsDir(workspacePath);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return;
    }

    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined))
    );
  }

  async purgeExpired(workspacePath: string, retentionDays: number): Promise<void> {
    const dir = this.sessionsDir(workspacePath);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return;
    }

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          try {
            const stats = await fs.stat(path.join(dir, f)); if (stats.mtimeMs < cutoff) { await fs.unlink(path.join(dir, f)); }
            const session = JSON.parse(raw) as ProfileSession;
            if (session.startTime < cutoff) {
              await fs.unlink(path.join(dir, f));
            }
          } catch {
            // skip malformed files
          }
        })
    );
  }
}
