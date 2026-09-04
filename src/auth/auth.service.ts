import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { db } from '../prisma/db';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async register(email: string, password: string) {
    const existing = await db.orm.public.User.where({ email }).first();
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await db.orm.public.User.create({
      email,
      password: hashedPassword,
    });

    return this.buildAuthResponse(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await db.orm.public.User.where({ email }).first();
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user.id, user.email);
  }

  private buildAuthResponse(userId: string, email: string) {
    const accessToken = this.jwtService.sign({ sub: userId, email });
    return {
      accessToken,
      user: { id: userId, email },
    };
  }
}
