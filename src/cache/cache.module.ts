import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { ConfigModule } from "@nestjs/config";
import Redis from "ioredis";
import { CacheService } from "./cache.service";
import redisConfig from "./config/redis.config";
import { REDIS_CLIENT } from "./redis.constants";

@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (cfg: ConfigType<typeof redisConfig>) => {
        return new Redis({
          host: cfg.host,
          port: cfg.port,
          password: cfg.password,
          tls: cfg.tlsEnabled ? {} : undefined,
          maxRetriesPerRequest: 3,
        });
      },
      inject: [redisConfig.KEY],
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
