import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './infrastructure/persistence/refresh-token.entity';
import { User } from './infrastructure/persistence/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  exports: [TypeOrmModule],
})
export class IdentityModule {}
