/**
 * Doctor subcommand for pi-delegate (Task 24)
 *
 * Provides health checks for:
 * - pi binary resolution
 * - config validity
 * - parent provider file existence
 * - delegate provider file existence
 * - runTimeoutMs sanity
 */

import * as fs from 'fs/promises';
import { resolvePiBinary } from './spawn.js';
import { loadConfig } from './config.js';

interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

export async function runDoctor(): Promise<string> {
  const checks: DoctorCheck[] = [];
  const config = loadConfig();

  // Check 1: pi binary resolution
  try {
    const binary = await resolvePiBinary(config);
    checks.push({ name: 'pi binary', passed: true, message: `found at ${binary}` });
  } catch (err) {
    checks.push({ name: 'pi binary', passed: false, message: String(err) });
  }

  // Check 2: config validity
  checks.push({
    name: 'config',
    passed: true,
    message: config.piBinaryPath
      ? `piBinaryPath = ${config.piBinaryPath}`
      : `using PATH resolution; maxDepth = ${config.maxDepth}`,
  });

  // Check 3: parent provider file exists
  try {
    await fs.access(new URL('../parent/index.ts', import.meta.url).pathname);
    checks.push({ name: 'parent provider', passed: true, message: `found` });
  } catch {
    checks.push({ name: 'parent provider', passed: false, message: 'not found — check extension installation' });
  }

  // Check 4: delegate provider file exists
  try {
    await fs.access(new URL('../delegate-provider/index.ts', import.meta.url).pathname);
    checks.push({ name: 'delegate provider', passed: true, message: `found` });
  } catch {
    checks.push({ name: 'delegate provider', passed: false, message: 'not found — check extension installation' });
  }

  // Check 5: runTimeoutMs sanity
  if (config.runTimeoutMs !== undefined && config.runTimeoutMs < 5000) {
    checks.push({ name: 'runTimeoutMs', passed: false, message: `${config.runTimeoutMs}ms is very short (< 5000ms)` });
  } else {
    checks.push({
      name: 'runTimeoutMs',
      passed: true,
      message: config.runTimeoutMs ? `${config.runTimeoutMs}ms` : 'no timeout configured',
    });
  }

  const allPassed = checks.every(c => c.passed);
  const lines = [
    `pi-delegate doctor — ${allPassed ? 'all checks passed' : 'some checks failed'}`,
    '',
    ...checks.map(c => `${c.passed ? '✓' : '✗'} ${c.name}: ${c.message}`),
  ];
  return lines.join('\n');
}
