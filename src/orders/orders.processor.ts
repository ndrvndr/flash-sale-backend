import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { Temporal } from 'temporal-polyfill';

import { db } from '../prisma/db';

interface CreateOrderJobData {
  bookingId: string;
  eventId: string;
  userId: string;
}

@Processor('orders-queue')
export class OrdersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrdersProcessor.name);

  async process(job: Job): Promise<any> {
    if (job.name === 'create-order') {
      return this.handleCreateOrder(job.data as CreateOrderJobData);
    }
    this.logger.warn(`Unknown job name: ${job.name}`);
    return { processed: false };
  }

  private async handleCreateOrder(data: CreateOrderJobData) {
    const { bookingId, eventId, userId } = data;
    this.logger.log(`Creating order: booking=${bookingId}, event=${eventId}, user=${userId}`);

    const mockSnapToken = randomUUID();
    const mockPaymentUrl = `https://mock-payment.local/pay/${mockSnapToken}`;
    const now = Temporal.Now.instant();
    const expiresAt = now.add({ minutes: 5 });

    const order = await db.orm.public.Order.create({
      id: bookingId,
      userId,
      eventId,
      status: 'PENDING',
      snapToken: mockSnapToken,
      paymentUrl: mockPaymentUrl,
      reservedAt: now,
      expiresAt,
    });

    this.logger.log(`Order created in DB: id=${order.id}, paymentUrl=${mockPaymentUrl}, expiresAt=${expiresAt.toString()}`);
    return { orderId: order.id, paymentUrl: mockPaymentUrl };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) FAILED: ${error.message}`);
  }
}
