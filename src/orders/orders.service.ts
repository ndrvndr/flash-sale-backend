import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
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
}
