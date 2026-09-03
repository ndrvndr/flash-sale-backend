import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Temporal } from 'temporal-polyfill';

import { db } from '../prisma/db';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OrdersExpiryService {
  private readonly logger = new Logger(OrdersExpiryService.name);

  constructor(private readonly redisService: RedisService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredOrders() {
    const now = Temporal.Now.instant();

    const expiredOrders = await db.orm.public.Order
      .where({ status: 'PENDING' })
      .where((o) => o.expiresAt.lt(now))
      .all();

    if (expiredOrders.length === 0) {
      return;
    }

    this.logger.log(`Found ${expiredOrders.length} expired order(s), processing...`);

    for (const order of expiredOrders) {
      await db.orm.public.Order
        .where({ id: order.id })
        .update({ status: 'EXPIRED' });

      // Kembalikan stok ke Redis
      await this.redisService.client.incr(`stock:event_${order.eventId}`);

      // Hapus reservation key
      await this.redisService.del(`reservation:event_${order.eventId}:user_${order.userId}`);

      this.logger.log(`Order ${order.id} expired, stock released for event ${order.eventId}`);
    }
  }
}
