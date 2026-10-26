import { ContactController } from './contact.controller';

const HOUR_MS = 3_600_000;

describe('ContactController', () => {
  it('Given la route publique d’envoi, When sa limite est lue, Then 3 messages par heure et par IP', () => {
    const handler = Object.getOwnPropertyDescriptor(
      ContactController.prototype,
      'create',
    )!.value as object;

    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(HOUR_MS);
  });
});
