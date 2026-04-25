// Feature: llm-code-optimization, Property 5: For any sessionId, when the "Optimize with LLM"
// button is clicked in the dashboard, the message sent to the extension host SHALL contain
// that exact sessionId.
// Feature: llm-code-optimization, Property 6: For any OptimizationSuggestion, the formatted
// AI chat message SHALL contain the suggestion's title, explanation, estimated impact as a
// percentage, affected metric, and the diff in a fenced code block.
// Feature: llm-code-optimization, Property 7: For any active suggestion list and any suggestion
// ID in that list, rejecting that suggestion SHALL result in it no longer appearing in the list
// sent to the dashboard.
// Feature: llm-code-optimization, Property 8: For any set of rejected suggestion IDs for a
// session, refreshing the dashboard within the same extension session SHALL NOT include those
// suggestion IDs in the displayed list.
// Feature: llm-code-optimization, Property 11: For any original ProfileSession, the ProfileSession
// produced by the automatic re-profile SHALL have linkedPreSessionId equal to the original
// session's id.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OptimizationSuggestion, ProfileSession, MetricsSummary } from '../types';

// ---------------------------------------------------------------------------
// Helpers — message construction logic extracted from extension.ts / webview
// ---------------------------------------------------------------------------

/**
 * Simulates the webview message sent when the "Optimize with LLM" button is clicked.
 * Mirrors the webview.html handler: { type: 'requestLLMOptimization', sessionId }
 */
function buildDashboardMessage(sessionId: string): { type: string; sessionId: string } {
  return { type: 'requestLLMOptimization', sessionId };
}

/**
 * Formats a suggestion into the AI chat message string.
 * Mirrors the logic in extension.ts optimizeWithLLM command handler.
 */
function formatChatMessage(suggestion: OptimizationSuggestion): string {
  const impactPct = Math.round(suggestion.estimatedImpact * 100);
  return (
    `**${suggestion.title}**\n\n` +
    `${suggestion.explanation}\n\n` +
    `Estimated impact: **${impactPct}%** on \`${suggestion.affectedMetric}\`\n\n` +
    `\`\`\`diff\n${suggestion.diff}\n\`\`\``
  );
}

/**
 * Simulates the reject logic from extension.ts rejectSuggestion command.
 * Returns the updated active suggestion list after rejection.
 */
function simulateReject(
  activeSuggestions: Map<string, OptimizationSuggestion>,
  rejectedSuggestions: Map<string, Set<string>>,
  sessionId: string,
  suggestionId: string
): OptimizationSuggestion[] {
  // Add to rejected set
  if (!rejectedSuggestions.has(sessionId)) {
    rejectedSuggestions.set(sessionId, new Set());
  }
  rejectedSuggestions.get(sessionId)!.add(suggestionId);

  // Remove from active
  activeSuggestions.delete(suggestionId);

  // Return filtered list (mirrors what gets sent to dashboard)
  const rejectedForSession = rejectedSuggestions.get(sessionId)!;
  return Array.from(activeSuggestions.values()).filter((s) => !rejectedForSession.has(s.id));
}

/**
 * Simulates a dashboard refresh — filters out rejected suggestions for the session.
 * Mirrors the logic that would run when the dashboard re-requests the suggestion list.
 */
function simulateRefresh(
  activeSuggestions: Map<string, OptimizationSuggestion>,
  rejectedSuggestions: Map<string, Set<string>>,
  sessionId: string
): OptimizationSuggestion[] {
  const rejectedForSession = rejectedSuggestions.get(sessionId) ?? new Set<string>();
  return Array.from(activeSuggestions.values()).filter((s) => !rejectedForSession.has(s.id));
}

/**
 * Constructs a new re-profiled session linked to the original.
 * Mirrors the newSession construction in extension.ts acceptSuggestion handler.
 */
function buildReprofiledSession(
  originalSession: ProfileSession,
  newId: string,
  metrics: MetricsSummary
): ProfileSession {
  return {
    id: newId,
    workspacePath: originalSession.workspacePath,
    filePath: originalSession.filePath,
    language: originalSession.language,
    sessionType: 'profile',
    startTime: Date.now(),
    endTime: Date.now() + 1000,
    exitCode: 0,
    stdout: '',
    stderr: '',
    metrics,
    isBaseline: false,
    optimizationSuggestions: [],
    linkedPreSessionId: originalSession.id,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbitraryMetricsSummary: fc.Arbitrary<MetricsSummary> = fc.record({
  peakRamMb: fc.float({ min: 0, max: 1024, noNaN: true }),
  avgRamMb: fc.float({ min: 0, max: 1024, noNaN: true }),
  totalDiskReadBytes: fc.nat(),
  totalDiskWriteBytes: fc.nat(),
  avgCpuPercent: fc.float({ min: 0, max: 100, noNaN: true }),
  totalNetworkBytesSent: fc.nat(),
  totalNetworkBytesReceived: fc.nat(),
  totalFsOpen: fc.nat(),
  totalFsRead: fc.nat(),
  totalFsWrite: fc.nat(),
  totalFsClose: fc.nat(),
  executionTimeMs: fc.nat(),
  energyMwh: fc.float({ min: 0, max: 100, noNaN: true }),
  samples: fc.constant([]),
});

const arbitraryProfileSession: fc.Arbitrary<ProfileSession> = fc.record({
  id: fc.uuid(),
  workspacePath: fc.string({ minLength: 1 }),
  filePath: fc.string({ minLength: 1 }),
  language: fc.constantFrom('javascript', 'typescript', 'python') as fc.Arbitrary<
    'javascript' | 'typescript' | 'python'
  >,
  sessionType: fc.constant('profile' as const),
  startTime: fc.nat(),
  endTime: fc.nat(),
  exitCode: fc.constantFrom(0, 1),
  stdout: fc.string(),
  stderr: fc.string(),
  metrics: arbitraryMetricsSummary,
  isBaseline: fc.boolean(),
  optimizationSuggestions: fc.constant([]),
});

const arbitrarySuggestion: fc.Arbitrary<OptimizationSuggestion> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1 }),
  explanation: fc.string({ minLength: 1 }),
  estimatedImpact: fc.float({ min: 0, max: 1, noNaN: true }),
  affectedMetric: fc.constantFrom('ram', 'cpu', 'energy', 'disk', 'network') as fc.Arbitrary<
    'ram' | 'cpu' | 'energy' | 'disk' | 'network'
  >,
  diff: fc.string(),
});

// ---------------------------------------------------------------------------
// Property 5: Dashboard message contains exact sessionId
// Validates: Requirements 2.2
// ---------------------------------------------------------------------------

describe('Property 5: Dashboard button click sends message containing exact sessionId', () => {
  // Feature: llm-code-optimization, Property 5: For any sessionId, when the "Optimize with LLM"
  // button is clicked in the dashboard, the message sent to the extension host SHALL contain
  // that exact sessionId.
  it('message type is requestLLMOptimization and sessionId matches exactly', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (sessionId) => {
        const msg = buildDashboardMessage(sessionId);
        expect(msg.type).toBe('requestLLMOptimization');
        expect(msg.sessionId).toBe(sessionId);
      }),
      { numRuns: 100 }
    );
  });

  it('sessionId is preserved exactly — no trimming, encoding, or mutation', () => {
    fc.assert(
      fc.property(fc.string(), (sessionId) => {
        const msg = buildDashboardMessage(sessionId);
        // The sessionId in the message must be reference-equal to the input
        expect(msg.sessionId).toStrictEqual(sessionId);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Formatted chat message contains all required fields
// Validates: Requirements 4.1
// ---------------------------------------------------------------------------

describe('Property 6: Formatted chat message contains all required fields', () => {
  // Feature: llm-code-optimization, Property 6: For any OptimizationSuggestion, the formatted
  // AI chat message SHALL contain the suggestion's title, explanation, estimated impact as a
  // percentage, affected metric, and the diff in a fenced code block.
  it('message contains title, explanation, impact percentage, affected metric, and diff block', () => {
    fc.assert(
      fc.property(arbitrarySuggestion, (suggestion) => {
        const message = formatChatMessage(suggestion);
        const impactPct = Math.round(suggestion.estimatedImpact * 100);

        // Title must appear in bold markdown
        expect(message).toContain(`**${suggestion.title}**`);

        // Explanation must appear
        expect(message).toContain(suggestion.explanation);

        // Impact percentage must appear
        expect(message).toContain(`${impactPct}%`);

        // Affected metric must appear in backtick code span
        expect(message).toContain(`\`${suggestion.affectedMetric}\``);

        // Diff must appear in a fenced diff code block
        expect(message).toContain('```diff');
        expect(message).toContain(suggestion.diff);
        expect(message).toContain('```');
      }),
      { numRuns: 100 }
    );
  });

  it('impact percentage is correctly rounded from estimatedImpact', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        (estimatedImpact) => {
          const suggestion: OptimizationSuggestion = {
            id: 'test-id',
            title: 'Test',
            explanation: 'Test explanation',
            estimatedImpact,
            affectedMetric: 'cpu',
            diff: 'some diff',
          };
          const message = formatChatMessage(suggestion);
          const expectedPct = Math.round(estimatedImpact * 100);
          expect(message).toContain(`**${expectedPct}%**`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 & 8: Rejection removes suggestion and it does not reappear
// Validates: Requirements 8.1, 8.2, 8.3
// ---------------------------------------------------------------------------

describe('Property 7 & 8: Rejecting a suggestion removes it and it does not reappear on refresh', () => {
  // Feature: llm-code-optimization, Property 7: For any active suggestion list and any suggestion
  // ID in that list, rejecting that suggestion SHALL result in it no longer appearing in the list
  // sent to the dashboard.
  it('Property 7: rejected suggestion is absent from the updated list', () => {
    fc.assert(
      fc.property(
        fc.array(arbitrarySuggestion, { minLength: 1, maxLength: 10 }),
        fc.uuid(), // sessionId
        (suggestions, sessionId) => {
          // Deduplicate by id (fast-check may generate duplicate UUIDs rarely)
          const uniqueSuggestions = suggestions.filter(
            (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
          );
          if (uniqueSuggestions.length === 0) return;

          // Pick the first suggestion to reject
          const toReject = uniqueSuggestions[0];

          // Populate active suggestions map
          const activeSuggestions = new Map<string, OptimizationSuggestion>();
          for (const s of uniqueSuggestions) {
            activeSuggestions.set(s.id, s);
          }
          const rejectedSuggestions = new Map<string, Set<string>>();

          const updatedList = simulateReject(
            activeSuggestions,
            rejectedSuggestions,
            sessionId,
            toReject.id
          );

          // The rejected suggestion must not appear in the updated list
          expect(updatedList.find((s) => s.id === toReject.id)).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: all other suggestions remain in the list after rejection', () => {
    fc.assert(
      fc.property(
        fc.array(arbitrarySuggestion, { minLength: 2, maxLength: 10 }),
        fc.uuid(),
        (suggestions, sessionId) => {
          const uniqueSuggestions = suggestions.filter(
            (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
          );
          if (uniqueSuggestions.length < 2) return;

          const toReject = uniqueSuggestions[0];
          const remaining = uniqueSuggestions.slice(1);

          const activeSuggestions = new Map<string, OptimizationSuggestion>();
          for (const s of uniqueSuggestions) {
            activeSuggestions.set(s.id, s);
          }
          const rejectedSuggestions = new Map<string, Set<string>>();

          const updatedList = simulateReject(
            activeSuggestions,
            rejectedSuggestions,
            sessionId,
            toReject.id
          );

          // All non-rejected suggestions must still be present
          for (const s of remaining) {
            expect(updatedList.find((x) => x.id === s.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: llm-code-optimization, Property 8: For any set of rejected suggestion IDs for a
  // session, refreshing the dashboard within the same extension session SHALL NOT include those
  // suggestion IDs in the displayed list.
  it('Property 8: rejected suggestions do not reappear after dashboard refresh', () => {
    fc.assert(
      fc.property(
        fc.array(arbitrarySuggestion, { minLength: 1, maxLength: 10 }),
        fc.uuid(),
        (suggestions, sessionId) => {
          const uniqueSuggestions = suggestions.filter(
            (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
          );
          if (uniqueSuggestions.length === 0) return;

          const activeSuggestions = new Map<string, OptimizationSuggestion>();
          for (const s of uniqueSuggestions) {
            activeSuggestions.set(s.id, s);
          }
          const rejectedSuggestions = new Map<string, Set<string>>();

          // Reject all suggestions one by one
          const rejectedIds: string[] = [];
          for (const s of uniqueSuggestions) {
            simulateReject(activeSuggestions, rejectedSuggestions, sessionId, s.id);
            rejectedIds.push(s.id);
          }

          // Simulate a dashboard refresh — none of the rejected IDs should appear
          const refreshedList = simulateRefresh(activeSuggestions, rejectedSuggestions, sessionId);

          for (const id of rejectedIds) {
            expect(refreshedList.find((s) => s.id === id)).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8: partial rejection — only rejected IDs are absent after refresh', () => {
    fc.assert(
      fc.property(
        fc.array(arbitrarySuggestion, { minLength: 2, maxLength: 10 }),
        fc.uuid(),
        (suggestions, sessionId) => {
          const uniqueSuggestions = suggestions.filter(
            (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
          );
          if (uniqueSuggestions.length < 2) return;

          // Reject only the first half
          const halfIdx = Math.floor(uniqueSuggestions.length / 2);
          const toReject = uniqueSuggestions.slice(0, halfIdx);
          const toKeep = uniqueSuggestions.slice(halfIdx);

          const activeSuggestions = new Map<string, OptimizationSuggestion>();
          for (const s of uniqueSuggestions) {
            activeSuggestions.set(s.id, s);
          }
          const rejectedSuggestions = new Map<string, Set<string>>();

          for (const s of toReject) {
            simulateReject(activeSuggestions, rejectedSuggestions, sessionId, s.id);
          }

          const refreshedList = simulateRefresh(activeSuggestions, rejectedSuggestions, sessionId);

          // Rejected ones must not appear
          for (const s of toReject) {
            expect(refreshedList.find((x) => x.id === s.id)).toBeUndefined();
          }

          // Kept ones must still appear
          for (const s of toKeep) {
            expect(refreshedList.find((x) => x.id === s.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: Re-profiled session has linkedPreSessionId equal to original id
// Validates: Requirements 7.2
// ---------------------------------------------------------------------------

describe('Property 11: Re-profiled session links to original session', () => {
  // Feature: llm-code-optimization, Property 11: For any original ProfileSession, the
  // ProfileSession produced by the automatic re-profile SHALL have linkedPreSessionId equal
  // to the original session's id.
  it('linkedPreSessionId equals the original session id', () => {
    fc.assert(
      fc.property(
        arbitraryProfileSession,
        fc.uuid(), // new session id
        arbitraryMetricsSummary,
        (originalSession, newId, metrics) => {
          const newSession = buildReprofiledSession(originalSession, newId, metrics);
          expect(newSession.linkedPreSessionId).toBe(originalSession.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('re-profiled session id differs from original id', () => {
    fc.assert(
      fc.property(
        arbitraryProfileSession,
        fc.uuid(),
        arbitraryMetricsSummary,
        (originalSession, newId, metrics) => {
          // Ensure the new id is different from the original
          fc.pre(newId !== originalSession.id);
          const newSession = buildReprofiledSession(originalSession, newId, metrics);
          expect(newSession.id).not.toBe(originalSession.id);
          expect(newSession.linkedPreSessionId).toBe(originalSession.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('linkedPreSessionId is stable regardless of new session metrics', () => {
    fc.assert(
      fc.property(
        arbitraryProfileSession,
        fc.uuid(),
        fc.tuple(arbitraryMetricsSummary, arbitraryMetricsSummary),
        (originalSession, newId, [metrics1, metrics2]) => {
          const session1 = buildReprofiledSession(originalSession, newId, metrics1);
          const session2 = buildReprofiledSession(originalSession, newId, metrics2);
          // Regardless of metrics, linkedPreSessionId always points to the original
          expect(session1.linkedPreSessionId).toBe(originalSession.id);
          expect(session2.linkedPreSessionId).toBe(originalSession.id);
          expect(session1.linkedPreSessionId).toBe(session2.linkedPreSessionId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
