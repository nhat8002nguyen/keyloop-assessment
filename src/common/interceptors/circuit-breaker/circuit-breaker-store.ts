import {
  CircuitBreakerState,
  CIRCUIT_BREAKER_METRIC_VALUE,
  type SourceState,
} from "./circuit-breaker.state";

export const circuitBreakerStates = new Map<string, SourceState>();

export function getCircuitBreakerState(source: string): CircuitBreakerState {
  return circuitBreakerStates.get(source)?.state ?? CircuitBreakerState.CLOSED;
}

export function getCircuitBreakerMetricValue(source: string): number {
  return CIRCUIT_BREAKER_METRIC_VALUE[getCircuitBreakerState(source)];
}

export function resetCircuitBreakerStates(source?: string): void {
  if (source) {
    circuitBreakerStates.delete(source);
  } else {
    circuitBreakerStates.clear();
  }
}
