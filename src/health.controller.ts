import { Controller, Get, Param } from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly redisService: RedisService) {}

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
}
