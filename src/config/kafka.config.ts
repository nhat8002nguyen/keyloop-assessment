import { registerAs } from "@nestjs/config";

export default registerAs("kafka", () => ({
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  username: process.env.KAFKA_USERNAME || "",
  password: process.env.KAFKA_PASSWORD || "",
  sslEnabled: process.env.KAFKA_SSL_ENABLED === "true",
  saslMechanism: process.env.KAFKA_SASL_MECHANISM || "",
}));
