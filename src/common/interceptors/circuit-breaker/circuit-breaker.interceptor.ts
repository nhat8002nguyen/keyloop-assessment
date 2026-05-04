import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { catchError, tap, throwError } from "rxjs";
import type {
  CircuitBreakerOptions,
  SourceState,
} from "./circuit-breaker.state";
import { CircuitBreakerState } from "./circuit-breaker.state";
import {
  circuitBreakerStates,
  getCircuitBreakerMetricValue,
  getCircuitBreakerState,
  resetCircuitBreakerStates,
} from "./circuit-breaker-store";

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

@Injectable()
export class CircuitBreakerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CircuitBreakerInterceptor.name);

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(
    private readonly source: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    const state = this.getOrInitState();

    if (state.state === CircuitBreakerState.OPEN) {
      const elapsed = Date.now() - (state.openedAt ?? 0);
      if (elapsed >= this.resetTimeoutMs) {
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
      } else {
        this.logger.warn(`[${this.source}] Circuit OPEN — rejecting request`);
        return throwError(
          () =>
            new ServiceUnavailableException(
              `${this.source} is temporarily unavailable`,
            ),
        );
      }
    }

    return next.handle().pipe(
      tap(() => this.onSuccess()),
      catchError((err: unknown) => {
        this.onFailure();
        return throwError(() => err);
      }),
    );
  }

  static getState(source: string): CircuitBreakerState {
    return getCircuitBreakerState(source);
  }

  static getMetricValue(source: string): number {
    return getCircuitBreakerMetricValue(source);
  }

  static resetForTest(source?: string): void {
    resetCircuitBreakerStates(source);
  }

  private getOrInitState(): SourceState {
    if (!circuitBreakerStates.has(this.source)) {
      circuitBreakerStates.set(this.source, {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        openedAt: null,
      });
    }
    return circuitBreakerStates.get(this.source)!;
  }

  private onSuccess(): void {
    const state = this.getOrInitState();
    if (state.state !== CircuitBreakerState.CLOSED) {
      this.logger.log(`[${this.source}] Circuit CLOSED after successful probe`);
    }
    circuitBreakerStates.set(this.source, {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      openedAt: null,
    });
  }

  private onFailure(): void {
    const state = this.getOrInitState();
    const newCount = state.failureCount + 1;

    if (
      state.state === CircuitBreakerState.HALF_OPEN ||
      newCount >= this.failureThreshold
    ) {
      this.logger.warn(
        `[${this.source}] Circuit OPEN after ${newCount} failure(s)`,
      );
      this.transitionTo(CircuitBreakerState.OPEN);
      circuitBreakerStates.set(this.source, {
        state: CircuitBreakerState.OPEN,
        failureCount: newCount,
        openedAt: Date.now(),
      });
    } else {
      circuitBreakerStates.set(this.source, {
        ...state,
        failureCount: newCount,
      });
    }
  }

  private transitionTo(newState: CircuitBreakerState): void {
    const state = this.getOrInitState();
    circuitBreakerStates.set(this.source, {
      ...state,
      state: newState,
      openedAt:
        newState === CircuitBreakerState.OPEN ? Date.now() : state.openedAt,
    });
  }
}
