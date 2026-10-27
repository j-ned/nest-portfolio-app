import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { WORKSHOP_GUIDE_OPERATIONS } from '../workshop-guide-content';
import { WORKSHOP_GUIDE_LIMITS } from '../workshop-guide-limits';
import { WORKSHOP_GUIDE_SEED } from '../workshop-guide.seed';
import {
  anEntry,
  aWorkshopGuideContent,
} from '../workshop-guide-test-builders';
import { UpdateWorkshopGuideDto } from './update-workshop-guide.dto';

/** Corps modifiable : copie profonde du builder neutre + version. */
const aBody = (): Record<string, unknown> & {
  entries: Record<string, unknown>[];
} => ({
  ...(structuredClone(aWorkshopGuideContent()) as unknown as Record<
    string,
    unknown
  >),
  entries: structuredClone(
    aWorkshopGuideContent().entries,
  ) as unknown as Record<string, unknown>[],
  version: 1,
});

/** Corps valide dont la première ligne a `field` remplacé (ou retiré si `undefined`). */
const withEntryField = (field: string, value: unknown) => {
  const body = aBody();
  if (value === undefined) delete body.entries[0][field];
  else body.entries[0][field] = value;
  return body;
};

/** `chemin:contrainte` de chaque erreur, chemins imbriqués compris (`entries.0.material:maxLength`). */
function violations(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    return [
      ...Object.keys(e.constraints ?? {}).map((c) => `${path}:${c}`),
      ...violations(e.children ?? [], path),
    ];
  });
}

/** Mêmes options que la ValidationPipe globale (app.setup.ts). */
async function violationsOf(body: object): Promise<string[]> {
  const dto = plainToInstance(UpdateWorkshopGuideDto, body, {
    enableImplicitConversion: true,
  });
  return violations(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
}

const L = WORKSHOP_GUIDE_LIMITS;
const text = (length: number) => 'a'.repeat(length);

describe('UpdateWorkshopGuideDto (spec 035)', () => {
  it.each([
    [
      'the seed (disabled, no entry)',
      () => ({ ...WORKSHOP_GUIDE_SEED, version: 1 }),
    ],
    ['the neutral builder', aBody],
    ['version 0 (no document yet)', () => ({ ...aBody(), version: 0 })],
    [
      `${L.entries} entries`,
      () => ({
        ...aBody(),
        entries: Array.from({ length: L.entries }, () => ({ ...anEntry() })),
      }),
    ],
  ])('Given %s, When validated, Then it is accepted', async (_label, body) => {
    expect(await violationsOf(body())).toEqual([]);
  });

  it(`Given ${L.entries + 1} entries, When validated, Then the list is too long`, async () => {
    const body = {
      ...aBody(),
      entries: Array.from({ length: L.entries + 1 }, () => ({ ...anEntry() })),
    };

    expect(await violationsOf(body)).toContain('entries:arrayMaxSize');
  });

  it.each([
    ['missing', undefined, 'entries:isArray'],
    ['an object', { 0: anEntry() }, 'entries:isArray'],
  ])(
    'Given entries %s, When validated, Then it is refused',
    async (_l, entries, v) => {
      const body = aBody() as Record<string, unknown>;
      if (entries === undefined) delete body.entries;
      else body.entries = entries;

      expect(await violationsOf(body)).toContain(v);
    },
  );

  describe.each([
    ['material', L.material],
    ['insert', L.insert],
  ])('entries.0.%s', (field, max) => {
    it(`Given exactly ${max} characters, When validated, Then it is accepted`, async () => {
      expect(await violationsOf(withEntryField(field, text(max)))).toEqual([]);
    });

    it.each([
      ['too long', text(max + 1), 'maxLength'],
      ['empty', '', 'isNotBlank'],
      ['blank', '   ', 'isNotBlank'],
      ['HTML markup', '<b>x</b>', 'noMarkup'],
      ['missing', undefined, 'isString'],
    ])(
      'Given %s, When validated, Then it is refused',
      async (_l, value, constraint) => {
        expect(await violationsOf(withEntryField(field, value))).toContain(
          `entries.0.${field}:${constraint}`,
        );
      },
    );
  });

  describe('entries.0.note (optional)', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['blank', '   '],
      [`exactly ${L.note} characters`, text(L.note)],
    ])('Given %s, When validated, Then it is accepted', async (_l, value) => {
      expect(await violationsOf(withEntryField('note', value))).toEqual([]);
    });

    it.each([
      ['too long', text(L.note + 1), 'maxLength'],
      ['HTML markup', '<script>', 'noMarkup'],
      ['a number', 3, 'isString'],
    ])(
      'Given %s, When validated, Then it is refused',
      async (_l, value, constraint) => {
        expect(await violationsOf(withEntryField('note', value))).toContain(
          `entries.0.note:${constraint}`,
        );
      },
    );
  });

  describe('entries.0.operation (closed list)', () => {
    it.each(WORKSHOP_GUIDE_OPERATIONS)(
      'Given %s, When validated, Then it is accepted',
      async (operation) => {
        expect(
          await violationsOf(withEntryField('operation', operation)),
        ).toEqual([]);
      },
    );

    it.each([['milling'], ['External-Roughing'], [''], [undefined]])(
      'Given %p, When validated, Then it is refused',
      async (operation) => {
        expect(
          await violationsOf(withEntryField('operation', operation)),
        ).toContain('entries.0.operation:isIn');
      },
    );
  });

  describe('entries.0.noseRadius (mm)', () => {
    it.each([[0.01], [0.4], [0.8], [1.2], [L.noseRadius]])(
      'Given %p, When validated, Then it is accepted',
      async (radius) => {
        expect(
          await violationsOf(withEntryField('noseRadius', radius)),
        ).toEqual([]);
      },
    );

    it.each([
      [0, 'isPositive'],
      [-0.4, 'isPositive'],
      [10.01, 'max'],
      [0.125, 'isNumber'],
      ['abc', 'isNumber'],
      [undefined, 'isNumber'],
    ])(
      'Given %p, When validated, Then %s fails',
      async (radius, constraint) => {
        expect(
          await violationsOf(withEntryField('noseRadius', radius)),
        ).toContain(`entries.0.noseRadius:${constraint}`);
      },
    );
  });

  it('Given an unknown key on an entry, When validated, Then it is refused', async () => {
    expect(await violationsOf(withEntryField('id', 'x'))).toContain(
      'entries.0.id:whitelistValidation',
    );
  });

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['1', 1],
    ['missing', undefined],
  ])(
    'Given enabled as %s, When validated, Then it is refused (never coerced)',
    async (_l, enabled) => {
      const body = aBody();
      if (enabled === undefined) delete body.enabled;
      else body.enabled = enabled;

      expect(await violationsOf(body)).toContain('enabled:isBoolean');
    },
  );

  it.each([
    ['true', true],
    ['false', false],
    ['missing (admin before spec 036)', undefined],
  ])(
    'Given decoderEnabled %s, When validated, Then it is accepted',
    async (_l, decoderEnabled) => {
      const body = aBody();
      if (decoderEnabled === undefined) delete body.decoderEnabled;
      else body.decoderEnabled = decoderEnabled;

      expect(await violationsOf(body)).toEqual([]);
    },
  );

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['1', 1],
    ['null', null],
  ])(
    'Given decoderEnabled as %s, When validated, Then it is refused (never coerced)',
    async (_l, decoderEnabled) => {
      expect(await violationsOf({ ...aBody(), decoderEnabled })).toContain(
        'decoderEnabled:isBoolean',
      );
    },
  );

  it.each([
    ['missing', undefined, 'version:isInt'],
    ['negative', -1, 'version:min'],
    ['decimal', 1.5, 'version:isInt'],
  ])(
    'Given version %s, When validated, Then it is refused',
    async (_l, version, v) => {
      const body = aBody();
      if (version === undefined) delete body.version;
      else body.version = version;

      expect(await violationsOf(body)).toContain(v);
    },
  );
});
