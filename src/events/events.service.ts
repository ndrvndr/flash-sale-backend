import { Injectable, Logger } from "@nestjs/common";

import { db } from "../prisma/db";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly redisService: RedisService) {}

  async listEvents() {
    return db.orm.public.Event.select(
      "id",
      "title",
      "totalStock",
      "price",
      "reservedStock",
    ).all();
  }

  async createEvent(title: string, totalStock: number, price: string) {
    const event = await db.orm.public.Event.create({
      title,
      totalStock,
      price,
    });

    // Set initial stock in Redis so checkout works immediately after creation
    await this.redisService.initStock(event.id, totalStock);
    this.logger.log(`Event created: id=${event.id}, stock=${totalStock}`);

    return event;
  }
}
