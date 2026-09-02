import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set');
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string | number, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<any> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  private decrementStockScript = readFileSync(
    join(__dirname, 'scripts', 'decrement-stock.lua'),
    'utf-8',
  );

  async tryReserveStock(
    eventId: string,
    userId: string,
    ttlSeconds: number = 300,
  ): Promise<'ok' | 'sold_out' | 'not_found'> {
    const stockKey = `stock:event_${eventId}`;
    const reservationKey = `reservation:event_${eventId}:user_${userId}`;

    const result = await this.client.eval(
      this.decrementStockScript,
      2, // jumlah KEYS
      stockKey,
      reservationKey,
      ttlSeconds,
    );

    if (result === -1) return 'not_found';
    if (result === 0) return 'sold_out';
    return 'ok';
  }

  async initStock(eventId: string, totalStock: number): Promise<void> {
    await this.client.set(`stock:event_${eventId}`, totalStock);
  }
}
