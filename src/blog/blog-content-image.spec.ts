import {
  CONTENT_IMAGE_PREFIX,
  contentImageKey,
  contentImageKeysIn,
  isContentImageKey,
} from './blog-content-image';

const UUID = '0b6c7f3e-9d1a-4c2b-8e5f-1a2b3c4d5e6f';
const KEY = `blog-content/${UUID}-a1b2c3d4-1600x900.avif`;
const OTHER_KEY = `blog-content/${UUID.replace('0b6c', 'ffff')}-deadbeef-800x600.avif`;

describe('contentImageKey', () => {
  it('Given an id, a hash and dimensions, When built, Then the key carries them under blog-content/', () => {
    expect(contentImageKey(UUID, 'a1b2c3d4', 1600, 900)).toBe(KEY);
    expect(KEY.startsWith(CONTENT_IMAGE_PREFIX)).toBe(true);
  });
});

describe('contentImageKeysIn', () => {
  it.each([
    [
      'an absolute production URL',
      `![Schéma](https://api.nedellec-julien.fr/api/storage/portfolio-storage/${KEY})`,
      [KEY],
    ],
    [
      'a relative /storage URL',
      `![Schéma](/storage/portfolio-storage/${KEY})`,
      [KEY],
    ],
    [
      'a development /api/storage URL',
      `![Schéma](/api/storage/portfolio-storage/${KEY})`,
      [KEY],
    ],
    [
      'the same image twice',
      `![a](/storage/portfolio-storage/${KEY})\n\n![b](https://api.nedellec-julien.fr/api/storage/portfolio-storage/${KEY})`,
      [KEY],
    ],
    [
      'two distinct images',
      `![a](/storage/portfolio-storage/${KEY}) ![b](/storage/portfolio-storage/${OTHER_KEY})`,
      [KEY, OTHER_KEY],
    ],
    [
      'a cover image key (blog/…)',
      `![c](/storage/portfolio-storage/blog/${UUID}-a1b2c3d4.avif)`,
      [],
    ],
    ['another bucket', `![x](/storage/other-bucket/${KEY})`, []],
    [
      'an external URL without the storage path',
      `![x](https://example.com/${KEY})`,
      [],
    ],
    [
      'a key that does not follow the content image format',
      `![x](/storage/portfolio-storage/blog-content/../cv/cv.pdf) ![y](/storage/portfolio-storage/blog-content/anything.avif)`,
      [],
    ],
    [
      'a share card derived from a content image key',
      `![x](/storage/portfolio-storage/${KEY}.share.jpg)`,
      [],
    ],
    [
      'a key followed by extra characters',
      `![x](/storage/portfolio-storage/${KEY}x)`,
      [],
    ],
    ['no image at all', '# Titre\n\nDu texte, `du code`.', []],
    ['an empty markdown', '', []],
  ])(
    'Given %s, When scanned, Then the cited keys are returned',
    (_, md, keys) => {
      expect(contentImageKeysIn(md)).toEqual(keys);
    },
  );
});

describe('isContentImageKey', () => {
  it.each([
    [KEY, true],
    [OTHER_KEY, true],
    [`blog/${UUID}-a1b2c3d4.avif`, false],
    ['blog-content/../cv/cv.pdf', false],
    ['blog-content/anything.avif', false],
    [`${KEY}.share.jpg`, false],
    [`${KEY}x`, false],
    [`x${KEY}`, false],
    ['', false],
  ])('Given %p, When checked, Then it is %p', (key, expected) => {
    expect(isContentImageKey(key)).toBe(expected);
  });
});
