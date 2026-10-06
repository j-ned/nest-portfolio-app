import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDto } from './update-project.dto';
import { PROJECT_FACT_MAX, PROJECT_PITCH_MAX } from '../project-editorial';

const base = { title: 'T', category: 'Web', description: 'D' };

describe('CreateProjectDto - techChoices / architectureDecisions', () => {
  it('accepte des listes valides', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...base,
      techChoices: [{ techno: 'NestJS', why: 'modulaire' }],
      architectureDecisions: [
        { decision: 'hexagonale', rationale: 'testable' },
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("accepte l'absence des deux champs (optionnels)", async () => {
    const dto = plainToInstance(CreateProjectDto, { ...base });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejette un techChoice sans "why"', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...base,
      techChoices: [{ techno: 'NestJS' }],
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejette une architectureDecision sans "decision"', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...base,
      architectureDecisions: [{ rationale: 'testable' }],
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('CreateProjectDto - kind (ADR-0008)', () => {
  it.each(['production', 'demo', 'script'])(
    'Given kind "%s", When validated, Then it is accepted',
    async (kind) => {
      const dto = plainToInstance(CreateProjectDto, { ...base, kind });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('Given no kind, When validated, Then it is accepted (the column default applies)', async () => {
    const dto = plainToInstance(CreateProjectDto, { ...base });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([['foo'], [null], [''], [42]])(
    'Given kind %p, When validated, Then kind is rejected',
    async (kind) => {
      const dto = plainToInstance(CreateProjectDto, { ...base, kind });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('kind');
    },
  );
});

describe('UpdateProjectDto - kind (ADR-0008)', () => {
  it('Given kind "script", When validated, Then it is accepted', async () => {
    const dto = plainToInstance(UpdateProjectDto, { kind: 'script' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('Given an empty patch, When validated, Then it is accepted', async () => {
    const dto = plainToInstance(UpdateProjectDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([['foo'], [null]])(
    'Given kind %p, When validated, Then kind is rejected (NOT NULL column, no 500)',
    async (kind) => {
      const dto = plainToInstance(UpdateProjectDto, { kind });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('kind');
    },
  );

  it('Given title null, When validated, Then title is rejected instead of reaching the NOT NULL column', async () => {
    const dto = plainToInstance(UpdateProjectDto, { title: null });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('title');
  });

  it('Given image null and liveUrl null, When validated, Then the existing null semantics still hold', async () => {
    const dto = plainToInstance(UpdateProjectDto, {
      image: null,
      liveUrl: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});

/** Même ValidationPipe que main.ts : conversion implicite, @Transform et liste blanche compris. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const throughPipe = <T>(
  metatype: new () => T,
  body: Record<string, unknown>,
): Promise<T> => pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

/** Contraintes class-validator remontées par le 400, à plat (`isString`, `maxLength`, ...). */
const rejectionOf = async (
  metatype: new () => unknown,
  body: Record<string, unknown>,
): Promise<string> => {
  const error: unknown = await throughPipe(metatype, body).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return JSON.stringify((error as BadRequestException).getResponse());
};

const EDITORIAL_FIELDS = [
  ['pitch', PROJECT_PITCH_MAX],
  ['highlight', PROJECT_FACT_MAX],
  ['scope', PROJECT_FACT_MAX],
] as const;

describe('CreateProjectDto - editorial fields (ADR-0010)', () => {
  it('Given the bounds, When read, Then they are 160 for the pitch and 80 for the facts', () => {
    expect(PROJECT_PITCH_MAX).toBe(160);
    expect(PROJECT_FACT_MAX).toBe(80);
  });

  it('Given the three fields, When created, Then they reach the service trimmed', async () => {
    const dto = await throughPipe(CreateProjectDto, {
      ...base,
      pitch: '  Une phrase qui dit à quoi sert le projet.  ',
      highlight: 'Chiffrement de bout en bout côté client',
      scope: ' Conception, développement, déploiement ',
    });
    expect(dto).toMatchObject({
      pitch: 'Une phrase qui dit à quoi sert le projet.',
      highlight: 'Chiffrement de bout en bout côté client',
      scope: 'Conception, développement, déploiement',
    });
  });

  // Les champs de classe ES2023 existent sur l'instance à `undefined` : c'est Drizzle qui
  // ignore `undefined` (colonne NULL à l'insert, clé hors du SET d'un UPDATE).
  it('Given none of the three fields, When created, Then they stay undefined (the column is NULL)', async () => {
    const dto = await throughPipe(CreateProjectDto, { ...base });
    expect(dto.pitch).toBeUndefined();
    expect(dto.highlight).toBeUndefined();
    expect(dto.scope).toBeUndefined();
  });

  describe.each(EDITORIAL_FIELDS)('%s (max %i)', (field, max) => {
    it(`Given exactly ${max} characters, When created, Then it is accepted`, async () => {
      const dto = await throughPipe(CreateProjectDto, {
        ...base,
        [field]: 'a'.repeat(max),
      });
      expect(dto[field]).toHaveLength(max);
    });

    it(`Given ${max} characters surrounded by spaces, When created, Then the bound applies after trim`, async () => {
      const dto = await throughPipe(CreateProjectDto, {
        ...base,
        [field]: `  ${'a'.repeat(max)}  `,
      });
      expect(dto[field]).toBe('a'.repeat(max));
    });

    it(`Given ${max + 1} characters, When created, Then the request is rejected on maxLength`, async () => {
      const response = await rejectionOf(CreateProjectDto, {
        ...base,
        [field]: 'a'.repeat(max + 1),
      });
      expect(response).toContain(
        `${field} must be shorter than or equal to ${max} characters`,
      );
    });

    it.each([[null], [''], ['   ']])(
      'Given %p, When created, Then it is accepted as null',
      async (value) => {
        const dto = await throughPipe(CreateProjectDto, {
          ...base,
          [field]: value,
        });
        expect(dto[field]).toBeNull();
      },
    );

    it.each([[42], [true], [['x']], [{ text: 'x' }]])(
      'Given the non-string %p, When created, Then the request is rejected on isString',
      async (value) => {
        const response = await rejectionOf(CreateProjectDto, {
          ...base,
          [field]: value,
        });
        expect(response).toContain(`${field} must be a string`);
      },
    );
  });
});

describe('UpdateProjectDto - editorial fields (ADR-0010, inherited through PartialType)', () => {
  describe.each(EDITORIAL_FIELDS)('%s (max %i)', (field, max) => {
    it.each([[null], [''], ['   ']])(
      'Given %p, When patched, Then it is accepted as null (the value is cleared)',
      async (value) => {
        const dto = await throughPipe(UpdateProjectDto, { [field]: value });
        expect(dto[field]).toBeNull();
      },
    );

    it('Given a padded value, When patched, Then it reaches the service trimmed', async () => {
      const dto = await throughPipe(UpdateProjectDto, { [field]: '  x  ' });
      expect(dto[field]).toBe('x');
    });

    it(`Given exactly ${max} characters, When patched, Then it is accepted`, async () => {
      const dto = await throughPipe(UpdateProjectDto, {
        [field]: 'a'.repeat(max),
      });
      expect(dto[field]).toHaveLength(max);
    });

    it(`Given ${max + 1} characters, When patched, Then the request is rejected on maxLength`, async () => {
      const response = await rejectionOf(UpdateProjectDto, {
        [field]: 'a'.repeat(max + 1),
      });
      expect(response).toContain(
        `${field} must be shorter than or equal to ${max} characters`,
      );
    });

    it('Given a number, When patched, Then the request is rejected on isString', async () => {
      const response = await rejectionOf(UpdateProjectDto, { [field]: 42 });
      expect(response).toContain(`${field} must be a string`);
    });

    it('Given the field is absent, When patched, Then it stays undefined (left out of the SET)', async () => {
      const dto = await throughPipe(UpdateProjectDto, { featured: true });
      expect(dto[field]).toBeUndefined();
    });
  });

  it.each(['title', 'category', 'description'] as const)(
    'Given null on the editorial fields, When %s is patched to null, Then it is still rejected (skipNullProperties: false)',
    async (required) => {
      const response = await rejectionOf(UpdateProjectDto, {
        pitch: null,
        [required]: null,
      });
      expect(response).toContain(`${required} must be a string`);
      expect(response).not.toContain('pitch');
    },
  );
});
