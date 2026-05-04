import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

export interface DownstreamHealth {
  name: string;
  status: "UP" | "DOWN" | "UNKNOWN";
}

export interface HealthResponse {
  status: "OK" | "DEGRADED";
  uptime: number;
  downstream: DownstreamHealth[];
}

@ApiTags("health")
@Controller("v1/health")
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: "OK",
      uptime: process.uptime(),
      downstream: [
        { name: "SALES", status: "UNKNOWN" },
        { name: "SERVICE", status: "UNKNOWN" },
      ],
    };
  }
}
