import { Controller, Get } from '@nestjs/common';
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
}
