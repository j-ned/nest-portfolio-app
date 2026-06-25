import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

const base = { title: 'T', category: 'Web', description: 'D' };

describe('CreateProjectDto — techChoices / architectureDecisions', () => {
  it('accepte des listes valides', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...base,
      techChoices: [{ techno: 'NestJS', why: 'modulaire' }],
      architectureDecisions: [{ decision: 'hexagonale', rationale: 'testable' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepte l’absence des deux champs (optionnels)', async () => {
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
