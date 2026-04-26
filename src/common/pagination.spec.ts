import { parsePagination } from './pagination';

describe('parsePagination', () => {
  it('utilise les defaults si rien fourni', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 10, offset: 0 });
  });

  it('cape page < 1 à 1', () => {
    expect(parsePagination({ page: 0 })).toEqual({
      page: 1,
      limit: 10,
      offset: 0,
    });
  });

  it('cape limit < 1 à 1', () => {
    expect(parsePagination({ limit: 0 })).toEqual({
      page: 1,
      limit: 1,
      offset: 0,
    });
  });

  it('cape limit > 100 à 100', () => {
    expect(parsePagination({ limit: 200 })).toEqual({
      page: 1,
      limit: 100,
      offset: 0,
    });
  });

  it('calcule offset correctement', () => {
    expect(parsePagination({ page: 3, limit: 20 })).toEqual({
      page: 3,
      limit: 20,
      offset: 40,
    });
  });
});
