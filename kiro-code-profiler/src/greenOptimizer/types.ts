export type PatternCategory =
  | "algorithmic-inefficiency"
  | "redundant-allocation"
  | "unnecessary-io"
  | "inefficient-loop";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DetectedPattern {
  patternId: string;
  category: PatternCategory;
  filePath: string;
  startLine: number;
  endLine: number;
  description: string;
  confidenceLevel: ConfidenceLevel;
  originalCode: string;
}

export interface SkippedFile {
  filePath: string;
  reason: string;
}

export interface AnalyzerResult {
  patterns: DetectedPattern[];
  skippedFiles: SkippedFile[];
  scannedFileCount: number;
}

export interface GreenSuggestion {
  suggestionId: string;
  patternId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  originalCode: string;
  proposedCode: string;
  estimatedEnergySavings: number | null;
  confidenceLevel: ConfidenceLevel;
  category: PatternCategory;
  description: string;
  status: "pending" | "accepted" | "rejected";
}

export interface EnergyProfile {
  patternId: string;
  beforeEstimateJoules: number;
  afterEstimateJoules: number;
  savingsJoules: number;
  savingsPercent: number;
}

export interface ImpactSummary {
  totalPatterns: number;
  totalEnergySavedJoules: number;
  totalEnergySavedKwh: number;
  totalCo2ReductionGrams: number;
  carbonIntensityFactor: number;
  region: string;
  smartphoneCharges: number;
  carMeters: number;
  acceptedCount: number;
  rejectedCount: number;
  pendingCount: number;
}
