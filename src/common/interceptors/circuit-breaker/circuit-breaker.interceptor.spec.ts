import { ExecutionContext, ServiceUnavailableException } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { CircuitBreakerInterceptor } from "./circuit-breaker.interceptor";
import { CircuitBreakerState } from "./circuit-breaker.state";

const makeContext = (): ExecutionContext => ({}) as ExecutionContext;

const makeCallHandler = (
  outcome: "success" | "error" = "success",
  error?: Error,
) => ({
  handle: jest.fn(() =>
    outcome === "success"
      ? of({ data: "ok" })
      : throwError(() => error ?? new Error("downstream error")),
  ),
});

describe("CircuitBreakerInterceptor", () => {
  beforeEach(() => {
    CircuitBreakerInterceptor.resetForTest();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    CircuitBreakerInterceptor.resetForTest();
  });

  describe("CLOSED state (initial)", () => {
    it("starts in CLOSED state", () => {
      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.CLOSED,
      );
    });

    it("passes request through to next.handle() when CLOSED", (done) => {
      const interceptor = new CircuitBreakerInterceptor("SALES");
      const handler = makeCallHandler("success");

      interceptor.intercept(makeContext(), handler).subscribe({
        next: () => {
          expect(handler.handle).toHaveBeenCalledTimes(1);
          done();
        },
        error: done,
      });
    });

    it("does not change state on single failure", (done) => {
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 5,
      });
      const handler = makeCallHandler("error");

      interceptor.intercept(makeContext(), handler).subscribe({
        error: () => {
          expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
            CircuitBreakerState.CLOSED,
          );
          done();
        },
      });
    });
  });

  describe("CLOSED → OPEN transition", () => {
    it("opens circuit after failureThreshold consecutive failures", async () => {
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
      });

      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(makeContext(), makeCallHandler("error"))
            .subscribe({ error: () => resolve() });
        });
      }

      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.OPEN,
      );
    });
  });

  describe("OPEN state", () => {
    const openCircuit = async (source: string, threshold = 3) => {
      const interceptor = new CircuitBreakerInterceptor(source, {
        failureThreshold: threshold,
      });
      for (let i = 0; i < threshold; i++) {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(makeContext(), makeCallHandler("error"))
            .subscribe({ error: () => resolve() });
        });
      }
      return interceptor;
    };

    it("throws ServiceUnavailableException immediately when OPEN", async () => {
      await openCircuit("SALES");
      const interceptor = new CircuitBreakerInterceptor("SALES");
      const handler = makeCallHandler("success");

      await expect(
        new Promise((resolve, reject) => {
          interceptor
            .intercept(makeContext(), handler)
            .subscribe({ next: resolve, error: reject });
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("does NOT call next.handle() when OPEN", async () => {
      await openCircuit("SALES");
      const interceptor = new CircuitBreakerInterceptor("SALES");
      const handler = makeCallHandler("success");

      await new Promise<void>((resolve) => {
        interceptor
          .intercept(makeContext(), handler)
          .subscribe({ error: () => resolve() });
      });

      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("tracks state independently per source (SALES does not affect SERVICE)", async () => {
      await openCircuit("SALES");
      expect(CircuitBreakerInterceptor.getState("SERVICE")).toBe(
        CircuitBreakerState.CLOSED,
      );
    });
  });

  describe("OPEN → HALF_OPEN transition", () => {
    it("transitions to HALF_OPEN after resetTimeoutMs", async () => {
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
        resetTimeoutMs: 5000,
      });

      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(makeContext(), makeCallHandler("error"))
            .subscribe({ error: () => resolve() });
        });
      }

      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.OPEN,
      );

      jest.advanceTimersByTime(5001);

      const checkInterceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
        resetTimeoutMs: 5000,
      });
      await new Promise<void>((resolve, reject) => {
        checkInterceptor
          .intercept(makeContext(), makeCallHandler("success"))
          .subscribe({ next: () => resolve(), error: reject });
      });

      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.CLOSED,
      );
    });
  });

  describe("HALF_OPEN state", () => {
    const halfOpenCircuit = async (source: string) => {
      const interceptor = new CircuitBreakerInterceptor(source, {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(makeContext(), makeCallHandler("error"))
            .subscribe({ error: () => resolve() });
        });
      }
      jest.advanceTimersByTime(1001);
      return interceptor;
    };

    it("allows a probe request through when HALF_OPEN", async () => {
      await halfOpenCircuit("SALES");
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
      const handler = makeCallHandler("success");

      await new Promise<void>((resolve, reject) => {
        interceptor
          .intercept(makeContext(), handler)
          .subscribe({ next: () => resolve(), error: reject });
      });

      expect(handler.handle).toHaveBeenCalledTimes(1);
    });

    it("transitions back to CLOSED on success in HALF_OPEN", async () => {
      await halfOpenCircuit("SALES");
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });

      await new Promise<void>((resolve, reject) => {
        interceptor
          .intercept(makeContext(), makeCallHandler("success"))
          .subscribe({ next: () => resolve(), error: reject });
      });

      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.CLOSED,
      );
    });

    it("transitions back to OPEN on failure in HALF_OPEN", async () => {
      await halfOpenCircuit("SALES");
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });

      await new Promise<void>((resolve) => {
        interceptor
          .intercept(makeContext(), makeCallHandler("error"))
          .subscribe({ error: () => resolve() });
      });

      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.OPEN,
      );
    });
  });

  describe("circuit_breaker_state metric", () => {
    it("returns metric value 0 for CLOSED", () => {
      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.CLOSED,
      );
    });

    it("returns metric value 1 for OPEN after threshold failures", async () => {
      const interceptor = new CircuitBreakerInterceptor("SALES", {
        failureThreshold: 2,
      });
      for (let i = 0; i < 2; i++) {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(makeContext(), makeCallHandler("error"))
            .subscribe({ error: () => resolve() });
        });
      }
      expect(CircuitBreakerInterceptor.getState("SALES")).toBe(
        CircuitBreakerState.OPEN,
      );
    });
  });
});
