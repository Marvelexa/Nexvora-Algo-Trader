/**
 * E2E Test Suite Assertion & Reporting Utilities
 * Delta Exchange India Autonomous Trading System
 */

export interface TestCase {
  id: string;
  name: string;
  featureId: number;
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  run: () => Promise<void> | void;
}

export interface TestResult {
  id: string;
  name: string;
  featureId: number;
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestSuiteSummary {
  tier: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

export class Assert {
  public static isTrue(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(`Assertion Failed: ${message} (expected true, got ${condition})`);
    }
  }

  public static isFalse(condition: boolean, message: string): void {
    if (condition) {
      throw new Error(`Assertion Failed: ${message} (expected false, got ${condition})`);
    }
  }

  public static equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
      throw new Error(`Assertion Failed: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
    }
  }

  public static notEqual<T>(actual: T, unexpected: T, message: string): void {
    if (actual === unexpected) {
      throw new Error(`Assertion Failed: ${message} (did not expect: ${JSON.stringify(unexpected)})`);
    }
  }

  public static isPositive(val: number, message: string): void {
    if (typeof val !== 'number' || isNaN(val) || val <= 0) {
      throw new Error(`Assertion Failed: ${message} (expected positive number > 0, got: ${val})`);
    }
  }

  public static isNonNegative(val: number, message: string): void {
    if (typeof val !== 'number' || isNaN(val) || val < 0) {
      throw new Error(`Assertion Failed: ${message} (expected non-negative number >= 0, got: ${val})`);
    }
  }

  public static inRange(val: number, min: number, max: number, message: string): void {
    if (val < min || val > max) {
      throw new Error(`Assertion Failed: ${message} (expected value between ${min} and ${max}, got: ${val})`);
    }
  }

  public static isStrictOrdering(lower: number, mid: number, upper: number, message: string): void {
    if (!(lower < mid && mid < upper)) {
      throw new Error(`Assertion Failed: ${message} (expected ${lower} < ${mid} < ${upper})`);
    }
  }

  public static async throwsAsync(fn: () => Promise<any>, message: string, expectedPattern?: RegExp): Promise<void> {
    let threw = false;
    let actualErr: any = null;
    try {
      await fn();
    } catch (err: any) {
      threw = true;
      actualErr = err;
    }
    if (!threw) {
      throw new Error(`Assertion Failed: ${message} (expected function to throw error)`);
    }
    if (expectedPattern && actualErr) {
      const errMsg = actualErr.message || String(actualErr);
      if (!expectedPattern.test(errMsg)) {
        throw new Error(`Assertion Failed: Error thrown did not match pattern ${expectedPattern}. Got: "${errMsg}"`);
      }
    }
  }

  public static throws(fn: () => any, message: string, expectedPattern?: RegExp): void {
    let threw = false;
    let actualErr: any = null;
    try {
      fn();
    } catch (err: any) {
      threw = true;
      actualErr = err;
    }
    if (!threw) {
      throw new Error(`Assertion Failed: ${message} (expected function to throw error)`);
    }
    if (expectedPattern && actualErr) {
      const errMsg = actualErr.message || String(actualErr);
      if (!expectedPattern.test(errMsg)) {
        throw new Error(`Assertion Failed: Error thrown did not match pattern ${expectedPattern}. Got: "${errMsg}"`);
      }
    }
  }

  public static deepEqual(actual: any, expected: any, message: string): void {
    const actStr = JSON.stringify(actual);
    const expStr = JSON.stringify(expected);
    if (actStr !== expStr) {
      throw new Error(`Assertion Failed: ${message}\nExpected: ${expStr}\nActual:   ${actStr}`);
    }
  }

  public static includes(str: string, substr: string, message: string): void {
    if (!str || !str.includes(substr)) {
      throw new Error(`Assertion Failed: ${message} (expected "${str}" to include "${substr}")`);
    }
  }

  public static notIncludes(str: string, substr: string, message: string): void {
    if (str && str.includes(substr)) {
      throw new Error(`Assertion Failed: ${message} (did not expect "${str}" to include "${substr}")`);
    }
  }
}
