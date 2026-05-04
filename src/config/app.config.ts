import { registerAs } from "@nestjs/config";

export default registerAs("app", () => ({
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  globalTimeoutMs: Number(process.env.GLOBAL_TIMEOUT_MS) || 5000,
}));
