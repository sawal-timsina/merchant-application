import { instanceToPlain } from 'class-transformer';
import { MerchantApplication } from '../../modules/applications/infrastructure/persistence/merchant-application.entity';
import { RefreshToken } from '../../modules/identity/infrastructure/persistence/refresh-token.entity';
import { User } from '../../modules/identity/infrastructure/persistence/user.entity';

// ClassSerializerInterceptor serializes with instanceToPlain: these secrets must never survive it.
describe('entity serialization backstop', () => {
  it.each([
    [User, 'passwordHash'],
    [MerchantApplication, 'taxIdEncrypted'],
    [RefreshToken, 'tokenHash'],
  ] as const)('%p drops %s', (Entity, field) => {
    const entity = Object.assign(new Entity(), { id: 'id-1', [field]: 'secret' });
    expect(instanceToPlain(entity)).toEqual({ id: 'id-1' });
  });
});
