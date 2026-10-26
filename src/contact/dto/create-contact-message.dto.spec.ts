import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContactMessageDto } from './create-contact-message.dto';

const MESSAGE = {
  name: 'Camille Martin',
  email: 'camille@example.com',
  subject: 'Une question',
  message: 'Bonjour, une question sur ton simulateur.',
};

const invalidProperties = async (payload: Record<string, unknown>) => {
  const errors = await validate(
    plainToInstance(CreateContactMessageDto, payload),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map((error) => error.property);
};

describe('CreateContactMessageDto', () => {
  it.each([
    ['sans champ piège', MESSAGE],
    ['avec champ piège vide', { ...MESSAGE, website: '' }],
    ['avec champ piège rempli', { ...MESSAGE, website: 'https://spam.test' }],
  ])(
    'Given un message %s, When il est validé, Then aucune erreur',
    async (_label, payload) => {
      await expect(invalidProperties(payload)).resolves.toEqual([]);
    },
  );

  it.each([
    ['champ piège de 201 caractères', { website: 'a'.repeat(201) }],
    ['champ piège non textuel', { website: 42 }],
  ])(
    'Given un %s, When il est validé, Then website est rejeté',
    async (_label, override) => {
      await expect(
        invalidProperties({ ...MESSAGE, ...override }),
      ).resolves.toEqual(['website']);
    },
  );
});
