import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import type { ProfileContent } from '../profile-content';
import { PROFILE_LIMITS } from '../profile-limits';
import { PROFILE_SEED } from '../profile.seed';
import { aProfileContent } from '../profile-test-builders';
import { UpdateProfileDto } from './update-profile.dto';

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;
type Body = DeepMutable<ProfileContent> & { version?: number };

/** Vue non typée d'un objet du corps, pour y écrire des valeurs invalides. */
const loose = (o: object) => o as Record<string, unknown>;

/** Corps valide modifiable : copie profonde du builder neutre + version. */
const aBody = (): Body => ({
  ...(structuredClone(aProfileContent()) as DeepMutable<ProfileContent>),
  version: 1,
});

/** `chemin:contrainte` de chaque erreur, chemins imbriqués compris (`highlights.0.id:isUuid`). */
function violations(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    return [
      ...Object.keys(e.constraints ?? {}).map((c) => `${path}:${c}`),
      ...violations(e.children ?? [], path),
    ];
  });
}

/** Mêmes options que la ValidationPipe globale (main.ts). Tout payload, seed en lecture seule compris. */
async function violationsOf(body: object): Promise<string[]> {
  const dto = plainToInstance(UpdateProfileDto, body, {
    enableImplicitConversion: true,
  });
  return violations(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
}

const L = PROFILE_LIMITS;
const text = (length: number) => 'a'.repeat(length);
const uuid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const titled = (n: number) => ({ id: uuid(n), title: 'T', description: 'D' });

describe('UpdateProfileDto (spec 021, A3)', () => {
  it.each([
    ['the initial seed', () => ({ ...PROFILE_SEED, version: 1 })],
    ['the neutral builder', aBody],
  ])('Given %s, When validated, Then it is accepted', async (_label, body) => {
    expect(await violationsOf(body())).toEqual([]);
  });

  /** Chaque champ texte : [chemin, borne, écriture de la valeur]. */
  const TEXT_FIELDS: readonly [string, number, (b: Body, v: string) => void][] =
    [
      ['biography.title', L.biography.title, (b, v) => (b.biography.title = v)],
      [
        'biography.summary',
        L.biography.summary,
        (b, v) => (b.biography.summary = v),
      ],
      [
        'biography.leadEmphasis',
        L.biography.leadEmphasis,
        (b, v) => (b.biography.leadEmphasis = v),
      ],
      [
        'biography.paragraphs',
        L.biography.paragraph,
        (b, v) => (b.biography.paragraphs[1] = v),
      ],
      [
        'highlights.0.title',
        L.highlight.title,
        (b, v) => (b.highlights[0].title = v),
      ],
      [
        'highlights.0.description',
        L.highlight.description,
        (b, v) => (b.highlights[0].description = v),
      ],
      ['workSummary', L.sectionSummary, (b, v) => (b.workSummary = v)],
      ['whatIDo.0.title', L.whatIDo.title, (b, v) => (b.whatIDo[0].title = v)],
      [
        'whatIDo.0.description',
        L.whatIDo.description,
        (b, v) => (b.whatIDo[0].description = v),
      ],
      [
        'technologies.0.name',
        L.technology.name,
        (b, v) => (b.technologies[0].name = v),
      ],
      [
        'technologies.0.category',
        L.technology.category,
        (b, v) => (b.technologies[0].category = v),
      ],
      ['diplomasSummary', L.sectionSummary, (b, v) => (b.diplomasSummary = v)],
      [
        'diplomas.0.title',
        L.diploma.title,
        (b, v) => (b.diplomas[0].title = v),
      ],
      [
        'diplomas.0.provider',
        L.diploma.provider,
        (b, v) => (b.diplomas[0].provider = v),
      ],
      [
        'diplomas.0.level',
        L.diploma.level,
        (b, v) => (b.diplomas[0].level = v),
      ],
      [
        'diplomas.0.shortDescription',
        L.diploma.shortDescription,
        (b, v) => (b.diplomas[0].shortDescription = v),
      ],
      [
        'diplomas.0.skills',
        L.diploma.skill,
        (b, v) => (b.diplomas[0].skills[0] = v),
      ],
      [
        'motivation.title',
        L.motivation.title,
        (b, v) => (b.motivation.title = v),
      ],
      [
        'motivation.statement',
        L.motivation.statement,
        (b, v) => (b.motivation.statement = v),
      ],
      [
        'motivation.description',
        L.motivation.description,
        (b, v) => (b.motivation.description = v),
      ],
    ];

  describe.each(TEXT_FIELDS)('%s (max %d)', (path, max, write) => {
    it('Given exactly the limit, Then it is accepted', async () => {
      const body = aBody();
      write(body, text(max));
      expect(await violationsOf(body)).toEqual([]);
    });

    it.each([
      ['one character over the limit', text(max + 1), 'maxLength'],
      ['an empty string', '', 'isNotBlank'],
      ['only spaces', '   ', 'isNotBlank'],
      ['an HTML tag', 'Texte <script>alert(1)</script>', 'noMarkup'],
      ['a closing tag', 'Texte</p>', 'noMarkup'],
    ])('Given %s, Then it is rejected', async (_label, value, constraint) => {
      const body = aBody();
      write(body, value);
      expect(await violationsOf(body)).toContain(`${path}:${constraint}`);
    });
  });

  it.each([
    ['a lone "<" between words', 'a < b et c > d'],
    ['an arrow', 'Angular -> NestJS'],
  ])(
    'Given %s in a text, Then it is accepted (not markup)',
    async (_l, value) => {
      const body = aBody();
      body.biography.summary = value;
      expect(await violationsOf(body)).toEqual([]);
    },
  );

  /** Chaque liste : [chemin, maximum, élément valide n°i, écriture de la liste]. */
  const LISTS: readonly [
    string,
    number,
    (i: number) => unknown,
    (b: Body, items: unknown[]) => void,
  ][] = [
    [
      'biography.paragraphs',
      L.biography.paragraphs,
      (i) => `Paragraphe ${i}`,
      (b, items) => (b.biography.paragraphs = items as string[]),
    ],
    [
      'highlights',
      L.highlight.items,
      titled,
      (b, items) => (b.highlights = items as Body['highlights']),
    ],
    [
      'whatIDo',
      L.whatIDo.items,
      titled,
      (b, items) => (b.whatIDo = items as Body['whatIDo']),
    ],
    [
      'technologies',
      L.technology.items,
      (i) => ({ id: uuid(i), name: 'N', category: 'C', icon: 'angular' }),
      (b, items) => (b.technologies = items as Body['technologies']),
    ],
    [
      'diplomas',
      L.diploma.items,
      (i) => ({
        id: uuid(i),
        title: 'T',
        provider: 'P',
        level: 'L',
        shortDescription: 'D',
        skills: ['S'],
      }),
      (b, items) => (b.diplomas = items as Body['diplomas']),
    ],
    [
      'diplomas.0.skills',
      L.diploma.skills,
      (i) => `Compétence ${i}`,
      (b, items) => (b.diplomas[0].skills = items as string[]),
    ],
  ];

  describe.each(LISTS)('list %s (1 to %d)', (path, max, item, write) => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => item(i));

    it.each([1, max])('Given %d item(s), Then it is accepted', async (n) => {
      const body = aBody();
      write(body, items(n));
      expect(await violationsOf(body)).toEqual([]);
    });

    it.each([
      ['an empty list', 0, 'arrayMinSize'],
      ['one item over the maximum', max + 1, 'arrayMaxSize'],
    ])('Given %s, Then it is rejected', async (_label, n, constraint) => {
      const body = aBody();
      write(body, items(n));
      expect(await violationsOf(body)).toContain(`${path}:${constraint}`);
    });
  });

  it.each([
    [
      'a duplicated id in a list',
      (b: Body) => (b.highlights = [titled(1), titled(1)]),
      'highlights:arrayUnique',
    ],
    [
      'a non-UUID id',
      (b: Body) => (b.whatIDo[0].id = 'not-a-uuid'),
      'whatIDo.0.id:isUuid',
    ],
    [
      'an uppercase icon',
      (b: Body) => (b.technologies[0].icon = 'Angular'),
      'technologies.0.icon:matches',
    ],
    [
      'an icon with a path',
      (b: Body) => (b.technologies[0].icon = '../logo'),
      'technologies.0.icon:matches',
    ],
    [
      'an unknown key in a section',
      (b: Body) => (loose(b.biography).extra = 'x'),
      'biography.extra:whitelistValidation',
    ],
    [
      'an unknown key in a list item',
      (b: Body) => (loose(b.diplomas[0]).extra = 'x'),
      'diplomas.0.extra:whitelistValidation',
    ],
    [
      'a missing section',
      (b: Body) => delete loose(b).motivation,
      'motivation:isObject',
    ],
    [
      'a section given as a string',
      (b: Body) => (loose(b).biography = 'texte'),
      'biography:isObject',
    ],
    [
      'a list given as an object',
      (b: Body) => (loose(b).highlights = { id: uuid(1) }),
      'highlights:isArray',
    ],
    ['a missing version', (b: Body) => delete b.version, 'version:isInt'],
    ['version 0', (b: Body) => (b.version = 0), 'version:min'],
    ['a decimal version', (b: Body) => (b.version = 1.5), 'version:isInt'],
  ])('Given %s, Then it is rejected', async (_label, mutate, expected) => {
    const body = aBody();
    mutate(body);
    expect(await violationsOf(body)).toContain(expected);
  });
});
