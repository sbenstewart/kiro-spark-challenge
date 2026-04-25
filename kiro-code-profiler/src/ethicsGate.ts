import { CarbonGateResult } from './types';
import { calculateCarbonImpact } from './carbonCalculator';

/**
 * Ethics Logic Gate — Environmental Accountability.
 *
 * Checks whether a profiled run's projected annual CO₂ output exceeds
 * the configured budget. If it does, the gate blocks and surfaces a
 * clear, actionable message so the developer cannot ignore the impact.
 *
 * Satisfies the Kiro Spark Challenge "Ethics: Inclusion Guardrail" requirement:
 * a piece of code that stops the process if a rule is violated.
 */
export class CarbonEthicsGate {
  check(energyMwh: number, budgetGramsPerYear: number): CarbonGateResult {
    const impact = calculateCarbonImpact(energyMwh);
    const co2GramsAnnual = impact.annualCo2Grams;
    const blocked = budgetGramsPerYear > 0 && co2GramsAnnual > budgetGramsPerYear;

    const message = blocked
      ? `Carbon budget exceeded: this run projects ${co2GramsAnnual.toFixed(1)}g CO₂/year ` +
        `(budget: ${budgetGramsPerYear}g). ` +
        `Optimize your code to reduce energy usage before re-running.`
      : `Carbon within budget: ${co2GramsAnnual.toFixed(1)}g CO₂/year (budget: ${budgetGramsPerYear}g).`;

    return { blocked, co2GramsAnnual, budgetGramsAnnual: budgetGramsPerYear, message };
  }
}
