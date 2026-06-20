/**
 * Configuration loader for pi-delegate
 * Reads config.json and applies env-variable overrides
 */

import * as fs from 'fs';
import * as path from 'path';
import { DelegateConfig } from '../shared/types.js';

/**
 * Find the config file using the precedence chain:
 * 1. PI_DELEGATE_CONFIG_PATH env var (explicit path to config file)
 * 2. $PI_CONFIG_DIR/pi-delegate/config.json (if PI_CONFIG_DIR is set)
 * 3. ~/.config/pi/pi-delegate/config.json (default)
 */
function findConfigPath(): string | null {
  // Check explicit path from env
  if (process.env.PI_DELEGATE_CONFIG_PATH) {
    return process.env.PI_DELEGATE_CONFIG_PATH;
  }

  // Check PI_CONFIG_DIR
  if (process.env.PI_CONFIG_DIR) {
    const configPath = path.join(process.env.PI_CONFIG_DIR, 'pi-delegate', 'config.json');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  // Check default location
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const defaultPath = path.join(homeDir, '.config', 'pi', 'pi-delegate', 'config.json');
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  }

  return null;
}

/**
 * Load and parse the config file
 */
function loadConfigFile(configPath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Log warning but don't throw — missing file or invalid JSON just means use defaults
    if (error instanceof SyntaxError) {
      console.warn(`Warning: config.json at ${configPath} is invalid JSON, using defaults`);
    } else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Warning: could not read config.json at ${configPath}, using defaults`);
    }
    return {};
  }
}

/**
 * Validate that a value is a positive integer
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Load configuration from config.json with env-variable overrides
 */
export function loadConfig(): DelegateConfig {
  // Start with defaults
  const config: DelegateConfig = {
    maxDepth: 2,
  };

  // Load config file if it exists
  const configPath = findConfigPath();
  if (configPath) {
    const fileConfig = loadConfigFile(configPath);

    // Apply file config values, with validation
    if (isPositiveInteger(fileConfig.maxDepth)) {
      config.maxDepth = fileConfig.maxDepth;
    }

    if (typeof fileConfig.piBinaryPath === 'string') {
      config.piBinaryPath = fileConfig.piBinaryPath;
    }

    if (isPositiveInteger(fileConfig.runTimeoutMs)) {
      config.runTimeoutMs = fileConfig.runTimeoutMs;
    }

    if (isPositiveInteger(fileConfig.maxInFlightChildren)) {
      config.maxInFlightChildren = fileConfig.maxInFlightChildren;
    }

    if (typeof fileConfig.sandboxCommand === 'string') {
      config.sandboxCommand = fileConfig.sandboxCommand;
    }

    if (typeof fileConfig.childCwd === 'string') {
      config.childCwd = fileConfig.childCwd;
    }
  }

  // Apply env-variable overrides (highest precedence)
  if (process.env.PI_DELEGATE_MAX_DEPTH) {
    const envMaxDepth = parseInt(process.env.PI_DELEGATE_MAX_DEPTH, 10);
    if (!isNaN(envMaxDepth) && envMaxDepth > 0) {
      config.maxDepth = envMaxDepth;
    }
  }

  if (process.env.PI_DELEGATE_BINARY_PATH) {
    config.piBinaryPath = process.env.PI_DELEGATE_BINARY_PATH;
  }

  if (process.env.PI_DELEGATE_RUN_TIMEOUT_MS) {
    const parsed = parseInt(process.env.PI_DELEGATE_RUN_TIMEOUT_MS, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.runTimeoutMs = parsed;
    }
  }

  if (process.env.PI_DELEGATE_CHILD_CWD) {
    config.childCwd = process.env.PI_DELEGATE_CHILD_CWD;
  }

  return config;
}
