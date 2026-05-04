import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import type { Producer, SASLOptions } from "kafkajs";
import { Kafka, logLevel } from "kafkajs";
import type { IMessageQueueService } from "../../message-queue.interface";
import kafkaConfig from "../../../config/kafka.config";

@Injectable()
export class KafkaMessageQueueService
  implements IMessageQueueService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KafkaMessageQueueService.name);
  private producer: Producer;

  constructor(
    @Inject(kafkaConfig.KEY)
    private readonly cfg: ConfigType<typeof kafkaConfig>,
  ) {
    const sasl = this.buildSasl(cfg.saslMechanism, cfg.username, cfg.password);

    const kafka = new Kafka({
      clientId: "aggregate-service",
      brokers: cfg.brokers,
      ssl: cfg.sslEnabled,
      sasl,
      logLevel: logLevel.WARN,
    });

    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log("Kafka producer connected");
  }

  async publish(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.send(topic, payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private async send(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(payload) }],
    });
  }

  private async disconnect(): Promise<void> {
    await this.producer.disconnect();
    this.logger.log("Kafka producer disconnected");
  }

  private buildSasl(
    mechanism: string,
    username: string,
    password: string,
  ): SASLOptions | undefined {
    if (!username || !password || !mechanism) return undefined;
    const creds = { username, password };
    if (mechanism === "plain") return { mechanism: "plain", ...creds };
    if (mechanism === "scram-sha-256")
      return { mechanism: "scram-sha-256", ...creds };
    if (mechanism === "scram-sha-512")
      return { mechanism: "scram-sha-512", ...creds };
    return undefined;
  }
}
