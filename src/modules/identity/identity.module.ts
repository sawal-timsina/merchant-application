import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordHasher } from './application/password-hasher';
import { RefreshToken } from './infrastructure/persistence/refresh-token.entity';
import { User } from './infrastructure/persistence/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  providers: [PasswordHasher],
  exports: [TypeOrmModule, PasswordHasher],
})
export class IdentityModule {}
