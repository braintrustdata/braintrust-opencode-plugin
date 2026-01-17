/**
 * Clock interface for abstracting time
 *
 * This allows injecting a test clock for deterministic testing
 */

/**
 * Interface for getting the current time
 */
export interface Clock {
  /** Get the current timestamp in milliseconds */
  now(): number
}

/**
 * Real wall clock implementation using Date.now()
 */
export class WallClock implements Clock {
  now(): number {
    return Date.now()
  }
}

/**
 * Test clock that allows setting and advancing time manually
 */
export class TestClock implements Clock {
  private currentTime: number

  constructor(initialTime: number = 1000000000000) {
    this.currentTime = initialTime
  }

  now(): number {
    return this.currentTime
  }

  /**
   * Set the current time to a specific value
   */
  set(time: number): void {
    this.currentTime = time
  }

  /**
   * Advance the clock by a number of milliseconds
   */
  advance(ms: number): void {
    this.currentTime += ms
  }

  /**
   * Advance by 1ms (convenience for getting unique timestamps)
   */
  tick(): void {
    this.advance(1)
  }
}

/** Default wall clock instance */
export const wallClock = new WallClock()
