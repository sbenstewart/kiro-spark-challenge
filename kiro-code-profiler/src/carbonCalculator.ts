import { CarbonImpact } from './types';

// EPA eGRID 2022 US average: 386g CO₂/kWh
const CO2_G_PER_KWH = 386;
// US average retail electricity: $0.12/kWh
const USD_PER_KWH = 0.12;
// Projection baseline for annual estimates
const RUNS_PER_DAY = 100;
const DAYS_PER_YEAR = 365;
// Average passenger car: 120g CO₂/km
const CAR_CO2_G_PER_KM = 120;
// Netflix streaming: ~0.3 kWh/hr → 116g CO₂/hr
const NETFLIX_CO2_G_PER_HOUR = 116;

/**
 * Converts an energy measurement (mWh) into real-world carbon impact data.
 * Uses EPA eGRID 2022 US average grid intensity and 100 runs/day projection.
 *
 * Conversion chain: mWh → kWh → CO₂ grams → real-world equivalents
 *   1 kWh = 1,000,000 mWh  (milli = 10⁻³, kilo = 10³, so ratio = 10⁶)
 */
export function calculateCarbonImpact(energyMwh: number): CarbonImpact {
  const energyKwh = energyMwh / 1_000_000;

  const co2GramsPerRun = energyKwh * CO2_G_PER_KWH;
  const annualRuns = RUNS_PER_DAY * DAYS_PER_YEAR;
  const annualCo2Grams = co2GramsPerRun * annualRuns;

  const annualKwh = energyKwh * annualRuns;
  const annualCostUsdCents = annualKwh * USD_PER_KWH * 100;

  const annualDrivingMeters = (annualCo2Grams / CAR_CO2_G_PER_KM) * 1000;
  const annualNetflixMinutes = (annualCo2Grams / NETFLIX_CO2_G_PER_HOUR) * 60;

  return {
    co2MicrogramsPerRun: co2GramsPerRun * 1_000_000,
    annualCo2Grams,
    annualCostUsdCents,
    annualDrivingMeters,
    annualNetflixMinutes,
  };
}
