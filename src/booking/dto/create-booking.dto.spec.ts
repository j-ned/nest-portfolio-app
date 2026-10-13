import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';

const VIDEO_REQUEST = {
  startsAt: '2026-11-04T10:00:00.000Z',
  name: 'Camille Martin',
  email: 'camille@example.com',
  format: 'video',
  message: 'Refonte de notre application Angular.',
};

const PHONE_REQUEST = {
  ...VIDEO_REQUEST,
  format: 'phone',
  phone: '+33 6 12 34 56 78',
};

const invalidProperties = async (payload: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(CreateBookingDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
};

describe('CreateBookingDto', () => {
  it('Given une demande en visio complète, When elle est validée, Then aucune erreur', async () => {
    await expect(invalidProperties(VIDEO_REQUEST)).resolves.toEqual([]);
  });

  it('Given une demande par téléphone avec numéro, When elle est validée, Then aucune erreur', async () => {
    await expect(invalidProperties(PHONE_REQUEST)).resolves.toEqual([]);
  });

  it('Given les champs facultatifs renseignés, When la demande est validée, Then entreprise et champ piège sont acceptés', async () => {
    await expect(
      invalidProperties({
        ...VIDEO_REQUEST,
        company: 'Société Exemple',
        website: '',
      }),
    ).resolves.toEqual([]);
  });

  it('Given le champ piège rempli par un robot, When la demande passe la liste blanche, Then il n’est pas rejeté comme champ inconnu', async () => {
    await expect(
      invalidProperties({ ...VIDEO_REQUEST, website: 'https://spam.test' }),
    ).resolves.toEqual([]);
  });

  it('Given un champ non déclaré, When la demande passe la liste blanche, Then il est rejeté', async () => {
    await expect(
      invalidProperties({ ...VIDEO_REQUEST, status: 'cancelled' }),
    ).resolves.toEqual(['status']);
  });

  it.each([
    ['startsAt absent', { startsAt: undefined }, 'startsAt'],
    ['startsAt au format français', { startsAt: '04/11/2026' }, 'startsAt'],
    ['startsAt en texte libre', { startsAt: 'demain 10h' }, 'startsAt'],
    [
      'startsAt à une date inexistante',
      { startsAt: '2026-02-30T10:00:00Z' },
      'startsAt',
    ],
    ['nom vide', { name: '' }, 'name'],
    ['nom composé d’espaces', { name: '   ' }, 'name'],
    ['nom de 201 caractères', { name: 'a'.repeat(201) }, 'name'],
    ['email invalide', { email: 'camille.example.com' }, 'email'],
    ['format inconnu', { format: 'visio' }, 'format'],
    ['entreprise de 201 caractères', { company: 'a'.repeat(201) }, 'company'],
    ['message absent', { message: undefined }, 'message'],
    ['message vide', { message: '' }, 'message'],
    ['message composé d’espaces', { message: ' \n\t ' }, 'message'],
    ['message de 1001 caractères', { message: 'a'.repeat(1001) }, 'message'],
    ['champ piège de 201 caractères', { website: 'a'.repeat(201) }, 'website'],
    ['champ piège non textuel', { website: 42 }, 'website'],
  ])(
    'Given %s, When la demande est validée, Then seule cette propriété est en erreur',
    async (_case, override, property) => {
      await expect(
        invalidProperties({ ...VIDEO_REQUEST, ...override }),
      ).resolves.toEqual([property]);
    },
  );

  it.each([
    ['nom de 200 caractères', { name: 'a'.repeat(200) }],
    ['message de 1000 caractères', { message: 'a'.repeat(1000) }],
    ['entreprise de 200 caractères', { company: 'a'.repeat(200) }],
    [
      'instant avec décalage horaire',
      { startsAt: '2026-11-04T11:00:00+01:00' },
    ],
  ])(
    'Given %s (borne acceptée), When la demande est validée, Then aucune erreur',
    async (_case, override) => {
      await expect(
        invalidProperties({ ...VIDEO_REQUEST, ...override }),
      ).resolves.toEqual([]);
    },
  );

  it('Given un nom et un message entourés d’espaces, When la demande est transformée, Then ils sont rognés', () => {
    const dto = plainToInstance(CreateBookingDto, {
      ...VIDEO_REQUEST,
      name: '  Camille Martin ',
      message: '\n Refonte. \t',
    });

    expect(dto.name).toBe('Camille Martin');
    expect(dto.message).toBe('Refonte.');
  });

  describe('téléphone', () => {
    it('Given le format téléphone sans numéro, When la demande est validée, Then le téléphone est requis', async () => {
      await expect(
        invalidProperties({ ...PHONE_REQUEST, phone: undefined }),
      ).resolves.toEqual(['phone']);
    });

    it.each(['+33 6 12 34 56 78', '06.12.34.56.78', '0612345678', '123456'])(
      'Given le numéro %p, When la demande par téléphone est validée, Then il est accepté',
      async (phone) => {
        await expect(
          invalidProperties({ ...PHONE_REQUEST, phone }),
        ).resolves.toEqual([]);
      },
    );

    it.each([
      '12345',
      'abc',
      '+ 33 6 12',
      '0612345678901234567890',
      '06 12 34 56 78 ; DROP',
    ])(
      'Given le numéro %p, When la demande par téléphone est validée, Then il est refusé',
      async (phone) => {
        await expect(
          invalidProperties({ ...PHONE_REQUEST, phone }),
        ).resolves.toEqual(['phone']);
      },
    );

    it.each([undefined, 'abc'])(
      'Given le format visio et le téléphone %p, When la demande est validée, Then le téléphone n’est pas contrôlé',
      async (phone) => {
        await expect(
          invalidProperties({ ...VIDEO_REQUEST, phone }),
        ).resolves.toEqual([]);
      },
    );
  });
});
