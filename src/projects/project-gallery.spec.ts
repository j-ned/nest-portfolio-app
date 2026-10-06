import type { ProjectImage } from '../database/schema/project-images';
import {
  groupGalleryByProject,
  isPermutationOf,
  nextGalleryOrder,
} from './project-gallery';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';

const mkImage = (overrides: Partial<ProjectImage> = {}): ProjectImage => ({
  id: 'img',
  projectId: P1,
  key: 'project-images/img-aaaaaaaa.avif',
  alt: 'Tableau de bord',
  width: 1600,
  height: 1000,
  order: 0,
  createdAt: new Date('2026-10-06T10:00:00Z'),
  updatedAt: new Date('2026-10-06T10:00:00Z'),
  ...overrides,
});

const toUrl = (key: string) => `/storage/portfolio-storage/${key}`;

describe('groupGalleryByProject', () => {
  it('Given no rows, When grouped, Then the map is empty', () => {
    expect(groupGalleryByProject([], toUrl).size).toBe(0);
  });

  it('Given rows of two projects, When grouped, Then each project gets only its own images', () => {
    const gallery = groupGalleryByProject(
      [
        mkImage({ id: 'a', projectId: P1 }),
        mkImage({ id: 'b', projectId: P2 }),
        mkImage({ id: 'c', projectId: P1, order: 1 }),
      ],
      toUrl,
    );
    expect(gallery.get(P1)?.map((i) => i.id)).toEqual(['a', 'c']);
    expect(gallery.get(P2)?.map((i) => i.id)).toEqual(['b']);
  });

  it('Given unsorted rows, When grouped, Then images are sorted by order then createdAt', () => {
    const gallery = groupGalleryByProject(
      [
        mkImage({ id: 'third', order: 2 }),
        mkImage({
          id: 'second',
          order: 1,
          createdAt: new Date('2026-10-06T12:00:00Z'),
        }),
        mkImage({ id: 'fourth', order: 3 }),
        mkImage({
          id: 'first',
          order: 1,
          createdAt: new Date('2026-10-06T11:00:00Z'),
        }),
      ],
      toUrl,
    );
    expect(gallery.get(P1)?.map((i) => i.id)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
  });

  it('Given a row, When grouped, Then it exposes a public url, never the raw key', () => {
    const [image] =
      groupGalleryByProject(
        [mkImage({ id: 'a', key: 'project-images/a-12345678.avif', order: 4 })],
        toUrl,
      ).get(P1) ?? [];
    expect(image).toEqual({
      id: 'a',
      url: '/storage/portfolio-storage/project-images/a-12345678.avif',
      alt: 'Tableau de bord',
      width: 1600,
      height: 1000,
      order: 4,
    });
    expect(image).not.toHaveProperty('key');
  });
});

describe('nextGalleryOrder', () => {
  it.each([
    [[], 0],
    [[0], 1],
    [[0, 3, 1], 4],
    [[5], 6],
  ])(
    'Given existing orders %p, When a capture is added, Then it goes to %p',
    (orders, expected) => {
      expect(nextGalleryOrder(orders.map((order) => ({ order })))).toBe(
        expected,
      );
    },
  );
});

describe('isPermutationOf', () => {
  it.each([
    ['same order', ['a', 'b', 'c'], ['a', 'b', 'c']],
    ['reordered', ['a', 'b', 'c'], ['c', 'a', 'b']],
    ['both empty', [], []],
  ])(
    'Given %s, When checked, Then it is a permutation',
    (_, current, requested) => {
      expect(isPermutationOf(current, requested)).toBe(true);
    },
  );

  it.each([
    ['one missing', ['a', 'b', 'c'], ['a', 'b']],
    ['one extra', ['a', 'b'], ['a', 'b', 'c']],
    ['a foreign id', ['a', 'b'], ['a', 'z']],
    ['a duplicate', ['a', 'b'], ['a', 'a']],
    ['a duplicate hiding an extra', ['a', 'b', 'c'], ['a', 'a', 'b', 'c']],
    ['a request for an empty gallery', [], ['a']],
  ])('Given %s, When checked, Then it is refused', (_, current, requested) => {
    expect(isPermutationOf(current, requested)).toBe(false);
  });
});
