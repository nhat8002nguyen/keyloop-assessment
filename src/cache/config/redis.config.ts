import { registerAs } from "@nestjs/config";

export default registerAs("redis", () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  tlsEnabled: process.env.REDIS_TLS_ENABLED === "true",
  clusterMode: process.env.REDIS_CLUSTER_MODE === "true",
}));
