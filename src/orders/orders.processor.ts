import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Temporal } from 'temporal-polyfill';

import { MidtransService } from '../payment/midtrans.service';
import { db } from '../prisma/db';

interface CreateOrderJobData {
  bookingId: string;
  eventId: string;
  userId: string;
}

@Processor('orders-queue')
export class OrdersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrdersProcessor.name);

  constructor(private readonly midtransService: MidtransService) {
    super();
  }

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

    const event = await db.orm.public.Event.where({ id: eventId }).first();
    if (!event) {
      this.logger.error(`Event ${eventId} not found while processing order ${bookingId}`);
      return { error: 'event_not_found' };
    }

    const grossAmount = Math.round(Number(event.price));
    const now = Temporal.Now.instant();
    const expiresAt = now.add({ minutes: 5 });

    const { snapToken, paymentUrl } = await this.midtransService.createTransaction(
      bookingId,
      grossAmount,
    );

    const order = await db.orm.public.Order.create({
      id: bookingId,
      userId,
      eventId,
      status: 'PENDING',
      snapToken,
      paymentUrl,
      reservedAt: now,
      expiresAt,
    });

    this.logger.log(`Order created: id=${order.id}, paymentUrl=${paymentUrl}`);
    return { orderId: order.id, paymentUrl };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) FAILED: ${error.message}`);
    this.logger.error(error.stack);
  }
}
