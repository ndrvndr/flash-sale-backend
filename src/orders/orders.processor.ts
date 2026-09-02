import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

@Processor('orders-queue')
export class OrdersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrdersProcessor.name);

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing job ${job.id} with data: ${JSON.stringify(job.data)}`);

    // Logic lengkap (simpan ke Postgres, generate payment link, dll) ditambahkan di Fase 7

    return { processed: true };
  }
}
