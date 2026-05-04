export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export const CIRCUIT_BREAKER_METRIC_VALUE: Record<CircuitBreakerState, number> =
  {
    [CircuitBreakerState.CLOSED]: 0,
    [CircuitBreakerState.OPEN]: 1,
    [CircuitBreakerState.HALF_OPEN]: 2,
  };

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before attempting HALF_OPEN. Default: 30000 */
  resetTimeoutMs?: number;
}

export interface SourceState {
  state: CircuitBreakerState;
  failureCount: number;
  openedAt: number | null;
}
