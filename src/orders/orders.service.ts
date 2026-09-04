import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

import { db } from '../prisma/db';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly redisService: RedisService,
    @InjectQueue('orders-queue') private readonly ordersQueue: Queue,
  ) {}

  async checkout(eventId: string, userId: string) {
    const reserveResult = await this.redisService.tryReserveStock(eventId, userId);

    if (reserveResult === 'not_found') {
      throw new NotFoundException(`Event ${eventId} not found`);
    }

    if (reserveResult === 'sold_out') {
      throw new ConflictException('Stok habis');
    }

    // reserveResult === 'ok' -> proceed to push to the queue
    const bookingId = randomUUID();

    await this.ordersQueue.add('create-order', {
      bookingId,
      eventId,
      userId,
    });

    return {
      bookingId,
      status: 'PENDING',
      message: 'Checkout successful, order is being processed.',
    };
  }

  async handlePaymentWebhook(bookingId: string, status: string, signature: string) {
    // Mock signature verification — it will later be replaced with actual verification from Midtrans/Stripe.
    const MOCK_SECRET = 'mock-webhook-secret';
    if (signature !== MOCK_SECRET) {
      throw new BadRequestException('Invalid signature');
    }

    const order = await db.orm.public.Order.where({ id: bookingId }).first();

    if (!order) {
      throw new BadRequestException(`Order ${bookingId} not found`);
    }

    // Idempotency check — if it has already been paid, do not process it again.
    if (order.status === 'PAID') {
      return { message: 'Order already processed', order };
    }

    if (status === 'success') {
      const updatedOrder = await db.orm.public.Order
        .where({ id: bookingId })
        .update({
          status: 'PAID',
          paymentGatewayRef: `mock-ref-${Date.now()}`,
        });

      // Delete the reservation key in Redis — the stock is officially sold; no need to return it.
      await this.redisService.del(`reservation:event_${order.eventId}:user_${order.userId}`);

      // TODO: trigger job to generate PDF e-ticket / send email

      return { message: 'Payment confirmed', order: updatedOrder };
    }

    if (status === 'failure') {
      const updatedOrder = await db.orm.public.Order
        .where({ id: bookingId })
        .update({ status: 'FAILED' });

      // Return stock due to failed payment
      await this.redisService.client.incr(`stock:event_${order.eventId}`);
      await this.redisService.del(`reservation:event_${order.eventId}:user_${order.userId}`);

      return { message: 'Payment failed, stock released', order: updatedOrder };
    }

    throw new BadRequestException('Unknown status');
  }
}
