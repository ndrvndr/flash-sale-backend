import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { PrismaService } from "./prisma.service";

import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { RedisModule } from './redis/redis.module';
import { HealthController } from "./health.controller";

@Module({
  imports: [RedisModule],
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
