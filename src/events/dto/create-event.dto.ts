import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, Matches, Min } from "class-validator";

export class CreateEventDto {
  @ApiProperty({ example: "Concert Flash Sale 2026" })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  totalStock!: number;

  @ApiProperty({ example: "150000", description: "Price in IDR, as a string" })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: "price must be a valid decimal number as a string",
  })
  price!: string;
}
