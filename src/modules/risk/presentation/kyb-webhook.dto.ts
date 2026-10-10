import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsISO8601, IsString, Length, ValidateNested } from 'class-validator';

class KybVerificationData {
  @ApiProperty() @IsBoolean() businessVerified!: boolean;
  @ApiProperty() @IsBoolean() watchlistHit!: boolean;
}

export class KybWebhookDto {
  @ApiProperty() @IsString() @Length(1, 128) eventId!: string;

  @ApiProperty({ example: 'kyb.verification.completed' })
  @Equals('kyb.verification.completed')
  type!: string;

  @ApiProperty() @IsString() @Length(1, 100) reference!: string;

  @ApiProperty({ type: KybVerificationData })
  @ValidateNested()
  @Type(() => KybVerificationData)
  data!: KybVerificationData;

  @ApiProperty() @IsISO8601() occurredAt!: string;
}
