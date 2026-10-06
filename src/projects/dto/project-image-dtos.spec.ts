import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProjectImageAltDto } from './project-image-alt.dto';
import { ReorderProjectImagesDto } from './reorder-project-images.dto';

describe('ProjectImageAltDto', () => {
  it('Given an alt with surrounding spaces, When transformed, Then it is trimmed and accepted', async () => {
    const dto = plainToInstance(ProjectImageAltDto, {
      alt: '  Tableau de bord  ',
    });
    expect(dto.alt).toBe('Tableau de bord');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('Given an alt of exactly 300 characters, When validated, Then it is accepted', async () => {
    const dto = plainToInstance(ProjectImageAltDto, { alt: 'a'.repeat(300) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['empty', { alt: '' }],
    ['blank', { alt: '   ' }],
    ['301 characters', { alt: 'a'.repeat(301) }],
    ['not a string', { alt: 42 }],
  ])(
    'Given an alt %s, When validated, Then alt is rejected',
    async (_, body) => {
      const dto = plainToInstance(ProjectImageAltDto, body);
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('alt');
    },
  );
});

describe('ReorderProjectImagesDto', () => {
  const uuid = (n: number) =>
    `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

  it.each([
    ['an empty list', []],
    ['two UUIDs', [uuid(1), uuid(2)]],
    ['12 UUIDs', Array.from({ length: 12 }, (_, i) => uuid(i))],
  ])('Given %s, When validated, Then it is accepted', async (_, imageIds) => {
    const dto = plainToInstance(ReorderProjectImagesDto, { imageIds });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['not an array', { imageIds: uuid(1) }],
    ['a non-UUID', { imageIds: [uuid(1), 'nope'] }],
    ['a duplicate', { imageIds: [uuid(1), uuid(1)] }],
    ['13 UUIDs', { imageIds: Array.from({ length: 13 }, (_, i) => uuid(i)) }],
  ])('Given %s, When validated, Then imageIds is rejected', async (_, body) => {
    const dto = plainToInstance(ReorderProjectImagesDto, body);
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('imageIds');
  });
});
