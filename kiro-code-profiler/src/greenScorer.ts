import { GreenGrade, GreenScore } from './types';

// Energy thresholds in mWh (lower = greener)
// Calibrated against: 15W TDP CPU running at 50% load
//   1s → 2.08mWh, 5s → 10.4mWh, 30s → 62.5mWh, 5min → 625mWh
const THRESHOLDS: Array<{ max: number; grade: GreenGrade; score: number }> = [
  { max: 0.1,   grade: 'A++', score: 100 },
  { max: 1,     grade: 'A+',  score: 90  },
  { max: 5,     grade: 'A',   score: 80  },
  { max: 20,    grade: 'B',   score: 65  },
  { max: 100,   grade: 'C',   score: 45  },
  { max: 500,   grade: 'D',   score: 25  },
  { max: Infinity, grade: 'F', score: 10 },
];

const GRADE_COLORS: Record<GreenGrade, string> = {
  'A++': '#00c853',
  'A+':  '#43a047',
  'A':   '#7cb342',
  'B':   '#c6cc13',
  'C':   '#ffa000',
  'D':   '#e64a19',
  'F':   '#b71c1c',
};

export function computeGreenScore(energyMwh: number): GreenScore {
  const tier = THRESHOLDS.find(t => energyMwh < t.max) ?? THRESHOLDS[THRESHOLDS.length - 1];

  // Interpolate score within the tier band for a smoother number
  const tierIdx = THRESHOLDS.indexOf(tier);
  let score = tier.score;
  if (tierIdx > 0) {
    const lower = THRESHOLDS[tierIdx - 1].max;
    const ratio = 1 - (energyMwh - lower) / (tier.max - lower);
    const prevScore = THRESHOLDS[tierIdx - 1].score;
    score = Math.round(tier.score + ratio * (prevScore - tier.score));
  }

  return { grade: tier.grade, score: Math.max(0, Math.min(100, score)), energyMwh };
}

export function gradeColor(grade: GreenGrade): string {
  return GRADE_COLORS[grade];
}
