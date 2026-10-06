import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDto } from './update-project.dto';

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
