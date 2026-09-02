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

    // reserveResult === 'ok' -> lanjut push ke queue
    const bookingId = randomUUID();

    await this.ordersQueue.add('create-order', {
      bookingId,
      eventId,
      userId,
    });

    return {
      bookingId,
      status: 'PENDING',
      message: 'Checkout berhasil, pesanan sedang diproses',
    };
  }

  async handlePaymentWebhook(bookingId: string, status: string, signature: string) {
    // Mock signature verification — nanti diganti verifikasi asli dari Midtrans/Stripe di Fase 8-lanjutan
    const MOCK_SECRET = 'mock-webhook-secret';
    if (signature !== MOCK_SECRET) {
      throw new BadRequestException('Invalid signature');
    }

    const order = await db.orm.public.Order.where({ id: bookingId }).first();

    if (!order) {
      throw new BadRequestException(`Order ${bookingId} not found`);
    }

    // Idempotency check — kalau sudah PAID, jangan proses ulang
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

      // Hapus reservation key di Redis — stok resmi terjual, tidak perlu dikembalikan
      await this.redisService.del(`reservation:event_${order.eventId}:user_${order.userId}`);

      // TODO Fase berikutnya: trigger job generate PDF e-ticket / kirim email

      return { message: 'Payment confirmed', order: updatedOrder };
    }

    if (status === 'failure') {
      const updatedOrder = await db.orm.public.Order
        .where({ id: bookingId })
        .update({ status: 'FAILED' });

      // Kembalikan stok karena pembayaran gagal
      await this.redisService.client.incr(`stock:event_${order.eventId}`);
      await this.redisService.del(`reservation:event_${order.eventId}:user_${order.userId}`);

      return { message: 'Payment failed, stock released', order: updatedOrder };
    }

    throw new BadRequestException('Unknown status');
  }
}
