import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../core/http/pagination';
import { UserRole } from '../domain/user-role';

/** Roles an ADMIN may create through the API. Admins are provisioned out of band (seed). */
export const CREATABLE_ROLES = [UserRole.SALES, UserRole.REVIEWER] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

export class CreateUserDto {
  @ApiProperty({ example: 'new.reviewer@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'Riley Reviewer' })
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @ApiProperty({ enum: CREATABLE_ROLES })
  @IsIn(CREATABLE_ROLES)
  role!: CreatableRole;

  @ApiProperty({ description: 'Initial password (12–256 chars), shared with the user out of band' })
  @IsString()
  @Length(12, 256)
  password!: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'false deactivates (and revokes refresh tokens), true reactivates' })
  @IsBoolean()
  isActive!: boolean;
}

export class ListUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;
}

export class UserResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
