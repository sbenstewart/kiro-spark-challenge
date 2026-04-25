import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileSession, SessionSummary } from './types';

interface ListDiagnostics {
  malformedCount: number;
}

export class SessionPersister {
  private workspacePath: string;
  private summaryCache = new Map<string, SessionSummary[]>();
  private lastDiagnostics = new Map<string, ListDiagnostics>();

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
    this.invalidateCache(this.workspacePath);
  }

  async load(sessionId: string): Promise<ProfileSession> {
    const filePath = this.sessionFilePath(this.workspacePath, sessionId);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ProfileSession;
  }

  async list(workspacePath: string): Promise<SessionSummary[]> {
    const cached = this.summaryCache.get(workspacePath);
    if (cached) {
      return [...cached];
    }

    const dir = this.sessionsDir(workspacePath);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      this.lastDiagnostics.set(workspacePath, { malformedCount: 0 });
      return [];
    }

    const summaries: SessionSummary[] = [];
    let malformedCount = 0;
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
          dataStatus: session.metrics.dataStatus,
        });
      } catch {
        malformedCount++;
      }
    }

    const sorted = summaries.sort((a, b) => b.startTime - a.startTime);
    this.summaryCache.set(workspacePath, sorted);
    this.lastDiagnostics.set(workspacePath, { malformedCount });
    return [...sorted];
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
    this.invalidateCache(workspacePath);
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
            const raw = await fs.readFile(path.join(dir, f), 'utf-8');
            const session = JSON.parse(raw) as ProfileSession;
            if (session.startTime < cutoff) {
              await fs.unlink(path.join(dir, f));
            }
          } catch {
            // skip malformed files
          }
        })
    );
    this.invalidateCache(workspacePath);
  }

  getLastListDiagnostics(workspacePath: string): ListDiagnostics {
    return this.lastDiagnostics.get(workspacePath) ?? { malformedCount: 0 };
  }

  private invalidateCache(workspacePath: string): void {
    this.summaryCache.delete(workspacePath);
    this.lastDiagnostics.delete(workspacePath);
  }
}
