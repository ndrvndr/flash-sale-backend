import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

@Processor('orders-queue')
export class OrdersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrdersProcessor.name);

  async process(job: Job): Promise<any> {
    if (job.name === 'create-order') {
      const { bookingId, eventId, userId } = job.data;
      this.logger.log(`Creating order: booking=${bookingId}, event=${eventId}, user=${userId}`);
      // TODO Fase 7: simpan ke Postgres via Prisma, generate payment link
    }

    return { processed: true };
  }
}
