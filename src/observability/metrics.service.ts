import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import * as client from "prom-client";
import { getCircuitBreakerMetricValue } from "../common/interceptors/circuit-breaker/circuit-breaker-store";

const MS_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000,
];

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  readonly register: client.Registry;

  private readonly aggregateRequestDurationMs: client.Histogram<string>;
  private readonly downstreamRequestDurationMs: client.Histogram<string>;
  private readonly downstreamErrorTotal: client.Counter<string>;
  private readonly partialSuccessTotal: client.Counter<string>;
  private readonly documentsReturnedTotal: client.Counter<string>;
  private readonly circuitBreakerState: client.Gauge<string>;

  private circuitSyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.register = new client.Registry();
    client.collectDefaultMetrics({ register: this.register });

    this.aggregateRequestDurationMs = new client.Histogram({
      name: "aggregate_request_duration_ms",
      help: "End-to-end BFF HTTP request duration in milliseconds",
      labelNames: ["status"],
      buckets: MS_BUCKETS,
      registers: [this.register],
    });

    this.downstreamRequestDurationMs = new client.Histogram({
      name: "downstream_request_duration_ms",
      help: "Downstream Sales/Service API call duration in milliseconds",
      labelNames: ["source", "status"],
      buckets: MS_BUCKETS,
      registers: [this.register],
    });

    this.downstreamErrorTotal = new client.Counter({
      name: "downstream_error_total",
      help: "Downstream call failures (timeouts, HTTP errors, etc.)",
      labelNames: ["source", "error_type"],
      registers: [this.register],
    });

    this.partialSuccessTotal = new client.Counter({
      name: "partial_success_total",
      help: "Responses served when exactly one upstream source failed",
      labelNames: ["failed_source"],
      registers: [this.register],
    });

    this.documentsReturnedTotal = new client.Counter({
      name: "documents_returned_total",
      help: "Documents returned to the client per upstream source",
      labelNames: ["source"],
      registers: [this.register],
    });

    this.circuitBreakerState = new client.Gauge({
      name: "circuit_breaker_state",
      help: "Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN",
      labelNames: ["source"],
      registers: [this.register],
    });
  }

  onModuleInit(): void {
    this.syncCircuitBreakerGauges();
    this.circuitSyncTimer = setInterval(
      () => this.syncCircuitBreakerGauges(),
      2000,
    );
  }

  onModuleDestroy(): void {
    if (this.circuitSyncTimer) {
      clearInterval(this.circuitSyncTimer);
      this.circuitSyncTimer = null;
    }
  }

  recordAggregateRequestDurationMs(
    statusFamily: string,
    durationMs: number,
  ): void {
    this.aggregateRequestDurationMs.observe(
      { status: statusFamily },
      durationMs,
    );
  }

  recordDownstreamRequest(
    source: "SALES" | "SERVICE",
    status: "success" | "error",
    durationMs: number,
  ): void {
    this.downstreamRequestDurationMs.observe({ source, status }, durationMs);
  }

  recordDownstreamError(source: "SALES" | "SERVICE", errorType: string): void {
    this.downstreamErrorTotal.inc({ source, error_type: errorType });
  }

  recordPartialSuccess(failedSource: "SALES" | "SERVICE"): void {
    this.partialSuccessTotal.inc({ failed_source: failedSource });
  }

  recordDocumentsReturned(source: "SALES" | "SERVICE", count: number): void {
    if (count > 0) {
      this.documentsReturnedTotal.inc({ source }, count);
    }
  }

  async metrics(): Promise<string> {
    return this.register.metrics();
  }

  contentType(): string {
    return this.register.contentType;
  }

  private syncCircuitBreakerGauges(): void {
    for (const source of ["SALES", "SERVICE"] as const) {
      this.circuitBreakerState
        .labels(source)
        .set(getCircuitBreakerMetricValue(source));
    }
  }
}
