import { BullModule } from '@nestjs/bullmq';
import { Module } from "@nestjs/common";

import { AppController } from "./app.controller";
import { HealthController } from "./health.controller";
import { OrdersModule } from './orders/orders.module';
import { PrismaService } from "./prisma.service";
import { RedisModule } from './redis/redis.module';
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [
    RedisModule,
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL,
      },
    }),
    OrdersModule,
  ],
  controllers: [
    AppController,
    UsersController,
    HealthController,
  ],
  providers: [
    PrismaService,
    UsersService
  ],
})
export class AppModule {}
