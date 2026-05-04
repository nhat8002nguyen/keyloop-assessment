import { createWriteStream, existsSync, mkdirSync } from "fs";
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import Joi from "joi";
import pino, { type DestinationStream, type LevelWithSilent } from "pino";
import appConfig from "./config/app.config";
import databaseConfig from "./config/database.config";
import kafkaConfig from "./config/kafka.config";
import { CacheModule } from "./cache/cache.module";
import { CommonModule } from "./common/common.module";
import { DatabaseModule } from "./database/database.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthModule } from "./health/health.module";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { ObservabilityModule } from "./observability/observability.module";

function resolveLogLevel(config: ConfigService): string {
  const explicit = config.get<string>("LOG_LEVEL");
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const nodeEnv = config.get<string>("NODE_ENV") ?? "development";
  if (nodeEnv === "test") return "silent";
  if (nodeEnv === "production") return "info";
  return "debug";
}

function createLogDestinationStream(
  config: ConfigService,
): DestinationStream | undefined {
  const logToFile = config.get<boolean>("LOG_TO_FILE") ?? false;
  if (!logToFile) {
    return undefined;
  }
  if (!existsSync("logs")) mkdirSync("logs", { recursive: true });
  const fileStream = createWriteStream("logs/aggregate.jsonl", { flags: "a" });
  const level = resolveLogLevel(config) as LevelWithSilent;
  return pino.multistream([
    { level, stream: process.stdout },
    { level: "info", stream: fileStream },
  ]);
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
      load: [appConfig, databaseConfig, kafkaConfig],
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string()
          .valid("development", "production", "test")
          .default("development"),
        GLOBAL_TIMEOUT_MS: Joi.number().default(5000),
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_DATABASE: Joi.string().required(),
        DB_SSL: Joi.boolean().default(false),
        REDIS_HOST: Joi.string().default("localhost"),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().allow("").optional(),
        REDIS_TLS_ENABLED: Joi.boolean().default(false),
        REDIS_CLUSTER_MODE: Joi.boolean().default(false),
        KAFKA_BROKERS: Joi.string().default("localhost:9092"),
        KAFKA_USERNAME: Joi.string().allow("").optional(),
        KAFKA_PASSWORD: Joi.string().allow("").optional(),
        KAFKA_SSL_ENABLED: Joi.boolean().default(false),
        KAFKA_SASL_MECHANISM: Joi.string().allow("").optional(),
        LOG_LEVEL: Joi.string().optional(),
        LOG_TO_FILE: Joi.boolean().default(false),
        // HMAC for doc_exp + doc_sig on object-storage / CDN URLs (edge must share secret to verify).
        DOCUMENT_ASSET_SIGNING_SECRET: Joi.string()
          .min(16)
          .empty("")
          .default("dev-document-asset-signing-secret"),
        DOCUMENT_ASSET_SIGNING_TTL_SEC: Joi.number()
          .integer()
          .min(60)
          .max(604800)
          .default(3600),
      }),
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const level = resolveLogLevel(config);
        const stream = createLogDestinationStream(config);
        return {
          pinoHttp: {
            level,
            ...(stream ? { stream } : {}),
            customProps: (req: {
              headers: Record<string, string | string[] | undefined>;
            }) => ({
              context: "HTTP",
              correlationId: req.headers["x-correlation-id"],
            }),
            autoLogging: {
              ignore: (req: { url?: string }) =>
                req.url === "/metrics" ||
                req.url?.startsWith("/metrics") === true,
            },
          },
        };
      },
    }),
    ObservabilityModule,
    DatabaseModule,
    CacheModule,
    CommonModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
