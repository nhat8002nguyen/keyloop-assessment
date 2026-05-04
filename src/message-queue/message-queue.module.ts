import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import kafkaConfig from "../config/kafka.config";
import { KafkaMessageQueueService } from "./providers/kafka/kafka-message-queue.service";
import { MESSAGE_QUEUE } from "./message-queue.token";

@Module({
  imports: [ConfigModule.forFeature(kafkaConfig)],
  providers: [
    KafkaMessageQueueService,
    {
      provide: MESSAGE_QUEUE,
      useExisting: KafkaMessageQueueService,
    },
  ],
  exports: [MESSAGE_QUEUE],
})
export class MessageQueueModule {}
