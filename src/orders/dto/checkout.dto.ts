import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  userId!: string; // TODO: ganti jadi ambil dari auth token (req.user.id) setelah sistem auth ada
}
