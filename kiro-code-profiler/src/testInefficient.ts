// This file contains intentionally inefficient code for testing the Green Code Optimizer

// 1. O(n²) nested loop — should use a Set
function findCommonItems(listA: number[], listB: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < listA.length; i++) {
    for (let j = 0; j < listB.length; j++) {
      if (listA[i] === listB[j]) {
        result.push(listA[i]);
      }
    }
  }
  return result;
}

// 2. Redundant object allocation inside loop
function processItems(items: string[]) {
  for (let i = 0; i < items.length; i++) {
    const config = { retries: 3, timeout: 5000, verbose: true };
    console.log(config.retries, items[i]);
  }
}

// 3. Synchronous file read inside loop with same file
import * as fs from "fs";
function loadConfigRepeatedly(count: number) {
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const data = fs.readFileSync("config.json", "utf-8");
    results.push(data);
  }
  return results;
}

// 4. String concatenation in loop instead of array join
function buildReport(entries: string[]): string {
  let report = "";
  for (let i = 0; i < entries.length; i++) {
    report = report + entries[i] + "\n";
  }
  return report;
}

// 5. forEach that could be for-of
function printAll(items: number[]) {
  items.forEach(function(item) {
    console.log(item * 2);
  });
}

// 6. Unnecessary re-computation inside loop
function calculateTotals(prices: number[], taxRate: number) {
  const totals: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const tax = taxRate / 100;
    totals.push(prices[i] * (1 + tax));
  }
  return totals;
}

export { findCommonItems, processItems, loadConfigRepeatedly, buildReport, printAll, calculateTotals };
