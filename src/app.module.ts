import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";
import { OrdersModule } from "./orders/orders.module";
import { RedisModule } from "./redis/redis.module";

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
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
