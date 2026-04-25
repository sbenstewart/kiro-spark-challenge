import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SessionPersister } from '../sessionPersister';
import { ProfileSession, MetricsSummary } from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'session-persister-test-'));
}

async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const metricsSummaryArb = fc.record<MetricsSummary>({
  peakRamMb: fc.float({ min: 0, max: 65536, noNaN: true }),
  avgRamMb: fc.float({ min: 0, max: 65536, noNaN: true }),
  totalDiskReadBytes: fc.integer({ min: 0 }),
  totalDiskWriteBytes: fc.integer({ min: 0 }),
  avgCpuPercent: fc.float({ min: 0, max: 100, noNaN: true }),
  totalNetworkBytesSent: fc.integer({ min: 0 }),
  totalNetworkBytesReceived: fc.integer({ min: 0 }),
  totalFsOpen: fc.integer({ min: 0 }),
  totalFsRead: fc.integer({ min: 0 }),
  totalFsWrite: fc.integer({ min: 0 }),
  totalFsClose: fc.integer({ min: 0 }),
  executionTimeMs: fc.integer({ min: 0 }),
  energyMwh: fc.float({ min: 0, max: 1e6, noNaN: true }),
  samples: fc.constant([]),
});

const profileSessionArb = fc
  .tuple(
    fc.uuid(),                                                          // id
    fc.integer({ min: 0, max: 1_700_000_000_000 }),                    // startTime
    fc.integer({ min: 0, max: 1_000_000_000 }),                        // duration
  )
  .chain(([id, startTime, duration]) =>
    fc.record<ProfileSession>({
      id: fc.constant(id),
      workspacePath: fc.string({ minLength: 1 }),
      filePath: fc.string({ minLength: 1 }),
      language: fc.constantFrom('javascript', 'typescript', 'python'),
      sessionType: fc.constantFrom('profile', 'monitor'),
      startTime: fc.constant(startTime),
      endTime: fc.constant(startTime + duration),
      exitCode: fc.integer({ min: 0, max: 255 }),
      stdout: fc.string(),
      stderr: fc.string(),
      metrics: metricsSummaryArb,
      isBaseline: fc.boolean(),
      optimizationSuggestions: fc.constant([]),
    })
  );

// ─── Property 9: Session persistence round-trip ──────────────────────────────
// Feature: kiro-code-profiler, Property 9: Session persistence round-trip
// Validates: Requirements 7.1, 7.3

describe('Property 9: Session persistence round-trip', () => {
  let tmpDir: string;
  let persister: SessionPersister;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    persister = new SessionPersister(tmpDir);
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it('save() then load() produces a deeply equal ProfileSession', async () => {
    await fc.assert(
      fc.asyncProperty(profileSessionArb, async (session) => {
        await persister.save(session);
        const loaded = await persister.load(session.id);
        expect(loaded).toEqual(session);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 10: Session history ordering ───────────────────────────────────
// Feature: kiro-code-profiler, Property 10: Session history ordering
// Validates: Requirements 7.2

describe('Property 10: Session history ordering', () => {
  let tmpDir: string;
  let persister: SessionPersister;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    persister = new SessionPersister(tmpDir);
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it('list() returns sessions ordered by startTime descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(profileSessionArb, { minLength: 1, maxLength: 20 }),
        async (sessions) => {
          // Use a fresh temp dir per run to avoid cross-run contamination
          const runDir = await makeTempDir();
          const runPersister = new SessionPersister(runDir);
          try {
            // Deduplicate by id to avoid overwriting
            const unique = Array.from(new Map(sessions.map((s) => [s.id, s])).values());
            for (const s of unique) {
              await runPersister.save(s);
            }
            const summaries = await runPersister.list(runDir);
            for (let i = 1; i < summaries.length; i++) {
              expect(summaries[i - 1].startTime).toBeGreaterThanOrEqual(summaries[i].startTime);
            }
          } finally {
            await removeTempDir(runDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('list() reports malformed session files without dropping valid summaries', async () => {
    const validSession: ProfileSession = {
      id: 'valid-session',
      workspacePath: tmpDir,
      filePath: '/tmp/example.ts',
      language: 'typescript',
      sessionType: 'profile',
      startTime: 100,
      endTime: 200,
      exitCode: 0,
      stdout: '',
      stderr: '',
      metrics: {
        peakRamMb: 10,
        avgRamMb: 5,
        totalDiskReadBytes: 0,
        totalDiskWriteBytes: 0,
        avgCpuPercent: 1,
        totalNetworkBytesSent: 0,
        totalNetworkBytesReceived: 0,
        totalFsOpen: 0,
        totalFsRead: 0,
        totalFsWrite: 0,
        totalFsClose: 0,
        executionTimeMs: 100,
        energyMwh: 0,
        samples: [],
        dataStatus: 'empty',
      },
      isBaseline: false,
      optimizationSuggestions: [],
    };

    await persister.save(validSession);

    const sessionsDir = path.join(tmpDir, '.kiro', 'profiler', 'sessions');
    await fs.writeFile(path.join(sessionsDir, 'broken.json'), '{not valid json', 'utf8');

    const summaries = await persister.list(tmpDir);
    const diagnostics = persister.getLastListDiagnostics(tmpDir);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe(validSession.id);
    expect(summaries[0].dataStatus).toBe('empty');
    expect(diagnostics.malformedCount).toBe(1);
  });
});

// ─── Property 11: Session retention policy ───────────────────────────────────
// Feature: kiro-code-profiler, Property 11: Session retention policy
// Validates: Requirements 7.4

describe('Property 11: Session retention policy', () => {
  let tmpDir: string;
  let persister: SessionPersister;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    persister = new SessionPersister(tmpDir);
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it('purgeExpired() keeps sessions within retentionDays and removes older ones', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 30 }),  // retentionDays (>=2 so we have clear margin)
        fc.array(
          // offset in whole days from the boundary, positive = older (expired), negative = newer (kept)
          // Avoid 0 to stay away from the exact boundary
          fc.oneof(
            fc.integer({ min: 1, max: 30 }),   // expired: retentionDays + offset days ago
            fc.integer({ min: -29, max: -1 }), // kept: retentionDays + offset days ago (offset negative => newer)
          ),
          { minLength: 1, maxLength: 10 }
        ),
        async (retentionDays, offsets) => {
          const runDir = await makeTempDir();
          const runPersister = new SessionPersister(runDir);
          try {
            const now = Date.now();
            const msPerDay = 24 * 60 * 60 * 1000;
            // Add a 1-hour safety margin so clock drift during the test can't flip the result
            const safetyMs = 60 * 60 * 1000;

            // Build sessions clearly inside or outside the retention window
            const sessions: ProfileSession[] = offsets.map((offset, i) => {
              // daysAgo = retentionDays + offset
              // offset > 0 => older than retention => expired
              // offset < 0 => newer than retention => kept
              const daysAgo = retentionDays + offset;
              const startTime = now - daysAgo * msPerDay;
              return {
                id: `session-${i}-${offset}`,
                workspacePath: runDir,
                filePath: '/test/file.ts',
                language: 'typescript' as const,
                sessionType: 'profile' as const,
                startTime,
                endTime: startTime + 1000,
                exitCode: 0,
                stdout: '',
                stderr: '',
                metrics: {
                  peakRamMb: 0, avgRamMb: 0, totalDiskReadBytes: 0,
                  totalDiskWriteBytes: 0, avgCpuPercent: 0,
                  totalNetworkBytesSent: 0, totalNetworkBytesReceived: 0,
                  totalFsOpen: 0, totalFsRead: 0, totalFsWrite: 0, totalFsClose: 0,
                  executionTimeMs: 1000, energyMwh: 0, samples: [],
                },
                isBaseline: false,
                optimizationSuggestions: [],
              };
            });

            for (const s of sessions) {
              await runPersister.save(s);
            }

            await runPersister.purgeExpired(runDir, retentionDays);

            const remaining = await runPersister.list(runDir);
            const remainingIds = new Set(remaining.map((s) => s.id));

            // cutoff used by purgeExpired: Date.now() - retentionDays * msPerDay
            // We use a conservative bound: if startTime is more than safetyMs past the cutoff
            // it is definitely expired; if it is more than safetyMs before the cutoff it is
            // definitely kept. Sessions within safetyMs of the boundary are skipped.
            const cutoffApprox = now - retentionDays * msPerDay;

            for (const s of sessions) {
              if (s.startTime < cutoffApprox - safetyMs) {
                // Clearly expired
                expect(remainingIds.has(s.id)).toBe(false);
              } else if (s.startTime > cutoffApprox + safetyMs) {
                // Clearly within retention
                expect(remainingIds.has(s.id)).toBe(true);
              }
              // Sessions within safetyMs of the boundary are not checked
            }
          } finally {
            await removeTempDir(runDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 12: Clear removes all sessions ─────────────────────────────────
// Feature: kiro-code-profiler, Property 12: Clear removes all sessions
// Validates: Requirements 7.5

describe('Property 12: Clear removes all sessions', () => {
  let tmpDir: string;
  let persister: SessionPersister;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    persister = new SessionPersister(tmpDir);
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it('after clear(), list() returns an empty array', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(profileSessionArb, { minLength: 0, maxLength: 15 }),
        async (sessions) => {
          const runDir = await makeTempDir();
          const runPersister = new SessionPersister(runDir);
          try {
            const unique = Array.from(new Map(sessions.map((s) => [s.id, s])).values());
            for (const s of unique) {
              await runPersister.save(s);
            }
            await runPersister.clear(runDir);
            const remaining = await runPersister.list(runDir);
            expect(remaining).toEqual([]);
          } finally {
            await removeTempDir(runDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Unit tests (6.6) ────────────────────────────────────────────────────────

describe('SessionPersister unit tests', () => {
  let tmpDir: string;
  let persister: SessionPersister;

  const makeSession = (overrides: Partial<ProfileSession> = {}): ProfileSession => ({
    id: 'test-session-1',
    workspacePath: '/workspace',
    filePath: '/workspace/src/index.ts',
    language: 'typescript',
    sessionType: 'profile',
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_005_000,
    exitCode: 0,
    stdout: 'Hello, world!',
    stderr: '',
    metrics: {
      peakRamMb: 128.5,
      avgRamMb: 100.0,
      totalDiskReadBytes: 4096,
      totalDiskWriteBytes: 2048,
      avgCpuPercent: 42.0,
      totalNetworkBytesSent: 512,
      totalNetworkBytesReceived: 1024,
      totalFsOpen: 3,
      totalFsRead: 10,
      totalFsWrite: 5,
      totalFsClose: 3,
      executionTimeMs: 5000,
      energyMwh: 0.001,
      samples: [],
    },
    isBaseline: false,
    optimizationSuggestions: [],
    ...overrides,
  });

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    persister = new SessionPersister(tmpDir);
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  describe('serialization / deserialization round-trip', () => {
    it('saves and loads a session with all fields intact', async () => {
      const session = makeSession();
      await persister.save(session);
      const loaded = await persister.load(session.id);
      expect(loaded).toEqual(session);
    });

    it('preserves numeric precision for float metrics', async () => {
      const session = makeSession({ id: 'float-test' });
      session.metrics.peakRamMb = 128.123456789;
      session.metrics.avgCpuPercent = 99.999;
      await persister.save(session);
      const loaded = await persister.load(session.id);
      expect(loaded.metrics.peakRamMb).toBeCloseTo(128.123456789, 5);
      expect(loaded.metrics.avgCpuPercent).toBeCloseTo(99.999, 3);
    });

    it('preserves string fields including stdout/stderr', async () => {
      const session = makeSession({
        id: 'string-test',
        stdout: 'line1\nline2\nline3',
        stderr: 'error: something went wrong',
      });
      await persister.save(session);
      const loaded = await persister.load(session.id);
      expect(loaded.stdout).toBe('line1\nline2\nline3');
      expect(loaded.stderr).toBe('error: something went wrong');
    });

    it('throws when loading a non-existent session', async () => {
      await expect(persister.load('does-not-exist')).rejects.toThrow();
    });
  });

  describe('list() ordering', () => {
    it('returns sessions sorted by startTime descending', async () => {
      const s1 = makeSession({ id: 'a', startTime: 1000, endTime: 2000 });
      const s2 = makeSession({ id: 'b', startTime: 3000, endTime: 4000 });
      const s3 = makeSession({ id: 'c', startTime: 2000, endTime: 3000 });

      // Save in arbitrary order
      await persister.save(s1);
      await persister.save(s3);
      await persister.save(s2);

      const summaries = await persister.list(tmpDir);
      expect(summaries.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    });

    it('returns empty array when no sessions exist', async () => {
      const summaries = await persister.list(tmpDir);
      expect(summaries).toEqual([]);
    });

    it('returns correct summary fields', async () => {
      const session = makeSession();
      await persister.save(session);
      const summaries = await persister.list(tmpDir);
      expect(summaries).toHaveLength(1);
      const s = summaries[0];
      expect(s.id).toBe(session.id);
      expect(s.filePath).toBe(session.filePath);
      expect(s.sessionType).toBe(session.sessionType);
      expect(s.startTime).toBe(session.startTime);
      expect(s.endTime).toBe(session.endTime);
      expect(s.peakRamMb).toBe(session.metrics.peakRamMb);
      expect(s.avgCpuPercent).toBe(session.metrics.avgCpuPercent);
      expect(s.executionTimeMs).toBe(session.metrics.executionTimeMs);
      expect(s.isBaseline).toBe(session.isBaseline);
    });
  });

  describe('purgeExpired()', () => {
    it('removes sessions older than retentionDays', async () => {
      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;

      const old = makeSession({ id: 'old', startTime: now - 10 * msPerDay, endTime: now - 10 * msPerDay + 1000 });
      const recent = makeSession({ id: 'recent', startTime: now - 2 * msPerDay, endTime: now - 2 * msPerDay + 1000 });

      await persister.save(old);
      await persister.save(recent);

      await persister.purgeExpired(tmpDir, 5);

      const remaining = await persister.list(tmpDir);
      const ids = remaining.map((s) => s.id);
      expect(ids).not.toContain('old');
      expect(ids).toContain('recent');
    });

    it('keeps all sessions when none are expired', async () => {
      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;

      const s1 = makeSession({ id: 's1', startTime: now - 1 * msPerDay, endTime: now - 1 * msPerDay + 1000 });
      const s2 = makeSession({ id: 's2', startTime: now - 2 * msPerDay, endTime: now - 2 * msPerDay + 1000 });

      await persister.save(s1);
      await persister.save(s2);

      await persister.purgeExpired(tmpDir, 30);

      const remaining = await persister.list(tmpDir);
      expect(remaining).toHaveLength(2);
    });

    it('removes all sessions when all are expired', async () => {
      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;

      const s1 = makeSession({ id: 'e1', startTime: now - 20 * msPerDay, endTime: now - 20 * msPerDay + 1000 });
      const s2 = makeSession({ id: 'e2', startTime: now - 15 * msPerDay, endTime: now - 15 * msPerDay + 1000 });

      await persister.save(s1);
      await persister.save(s2);

      await persister.purgeExpired(tmpDir, 7);

      const remaining = await persister.list(tmpDir);
      expect(remaining).toHaveLength(0);
    });

    it('is a no-op when sessions directory does not exist', async () => {
      const emptyDir = await makeTempDir();
      try {
        await expect(persister.purgeExpired(emptyDir, 7)).resolves.toBeUndefined();
      } finally {
        await removeTempDir(emptyDir);
      }
    });
  });
});
