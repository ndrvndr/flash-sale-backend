import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  userId!: string; // TODO: Change this to retrieve the ID from the auth token (req.user.id) once the authentication system is in place.
}
