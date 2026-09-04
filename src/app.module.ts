import { BullModule } from '@nestjs/bullmq';
import { Module } from "@nestjs/common";
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from "./app.controller";
import { HealthController } from "./health.controller";
import { OrdersModule } from './orders/orders.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    RedisModule,
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL,
      },
    }),
    OrdersModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AppController,
    HealthController,
  ],
  providers: [],
})
export class AppModule {}
