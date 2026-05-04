export interface IMessageQueueService {
  publish(topic: string, payload: Record<string, unknown>): Promise<void>;
  onModuleDestroy?(): Promise<void>;
}
