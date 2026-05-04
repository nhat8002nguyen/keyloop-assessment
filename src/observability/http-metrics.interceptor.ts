import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { MetricsService } from "./metrics.service";

function statusFamily(code: number): string {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  return "2xx";
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (req.path === "/metrics" || req.url?.startsWith("/metrics")) {
      return next.handle();
    }

    const start = Date.now();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      finalize(() => {
        const code = res.statusCode || 500;
        const durationMs = Date.now() - start;
        this.metrics.recordAggregateRequestDurationMs(
          statusFamily(code),
          durationMs,
        );
      }),
    );
  }
}
