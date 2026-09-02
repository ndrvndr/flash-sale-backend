import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Param } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { RedisService } from './redis/redis.service';
import { db } from './prisma/db';

@Controller('health')
export class HealthController {
  constructor(
    private readonly redisService: RedisService,
    @InjectQueue('orders-queue') private readonly ordersQueue: Queue,
  ) { }

  @Get('redis')
  async checkRedis() {
    await this.redisService.set('ping', 'pong', 10);
    const result = await this.redisService.get('ping');
    return { redis: result === 'pong' ? 'connected' : 'error' };
  }

  @Get('test-stock/:eventId/:totalStock')
  async initTestStock(
    @Param('eventId') eventId: string,
    @Param('totalStock') totalStock: string,
  ) {
    await this.redisService.initStock(eventId, parseInt(totalStock));
    return { message: `Stock initialized: ${totalStock}` };
  }

  @Get('test-reserve/:eventId/:userId')
  async testReserve(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
  ) {
    const result = await this.redisService.tryReserveStock(eventId, userId);
    return { result };
  }

  @Get('test-queue')
  async testQueue() {
    const job = await this.ordersQueue.add('test-job', { message: 'hello from queue' });
    return { jobId: job.id, message: 'Job added to queue' };
  }

  @Get('seed-test-data')
  async seedTestData() {
    const user = await db.orm.public.User.create({
      email: `test-${Date.now()}@example.com`,
      password: 'dummy-hashed-password',
    });

    const event = await db.orm.public.Event.create({
      title: 'Test Flash Sale Event',
      totalStock: 10,
      price: '100000',
    });

    return { user, event };
  }
}
