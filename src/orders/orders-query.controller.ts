import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OrdersService } from "./orders.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string };
}

@ApiTags("Orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrdersQueryController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(":id")
  async getOrder(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.ordersService.getOrderById(id, req.user.id);
  }
}
