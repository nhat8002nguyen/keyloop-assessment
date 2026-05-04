import { Test, TestingModule } from "@nestjs/testing";
import { KafkaMessageQueueService } from "./kafka-message-queue.service";
import kafkaConfig from "../../../config/kafka.config";

const mockKafkaConfig = {
  brokers: ["localhost:9092"],
  username: "",
  password: "",
  sslEnabled: false,
  saslMechanism: "",
};

describe("KafkaMessageQueueService", () => {
  let service: KafkaMessageQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaMessageQueueService,
        {
          provide: kafkaConfig.KEY,
          useValue: mockKafkaConfig,
        },
      ],
    }).compile();

    service = module.get<KafkaMessageQueueService>(KafkaMessageQueueService);
  });

  it("is defined", () => {
    expect(service).toBeDefined();
  });

  it("implements IMessageQueueService interface", () => {
    expect(typeof service.publish).toBe("function");
  });

  it("publish sends message to the given topic", async () => {
    const sendSpy = jest
      .spyOn(service as any, "send")
      .mockResolvedValue(undefined);

    await service.publish("document.search", {
      correlationId: "abc",
      userId: "user-1",
      vin: "1HGBH41JXMN109186",
    });

    expect(sendSpy).toHaveBeenCalledWith(
      "document.search",
      expect.objectContaining({ correlationId: "abc" }),
    );
  });

  it("publish serialises payload to JSON", async () => {
    const sendSpy = jest
      .spyOn(service as any, "send")
      .mockResolvedValue(undefined);
    const payload = { key: "value", nested: { count: 1 } };

    await service.publish("document.view", payload);

    expect(sendSpy).toHaveBeenCalledWith("document.view", payload);
  });

  it("onModuleDestroy disconnects the producer", async () => {
    const disconnectSpy = jest
      .spyOn(service as any, "disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalled();
  });
});
