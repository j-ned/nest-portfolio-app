import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const baseValid = {
    DATABASE_URL: 'postgres://u:p@localhost:55432/db',
  };

  it('parse une env valide minimaliste avec défauts', () => {
    const result = validateEnv(baseValid);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe(baseValid.DATABASE_URL);
    expect(result.LOG_LEVEL).toBe('debug'); // défaut auto en dev
  });

  it('coerce PORT depuis une string', () => {
    const result = validateEnv({ ...baseValid, PORT: '4242' });
    expect(result.PORT).toBe(4242);
  });

  it('rejette PORT hors plage', () => {
    expect(() => validateEnv({ ...baseValid, PORT: '99999' })).toThrow(/PORT/);
  });

  it('rejette DATABASE_URL absente', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejette DATABASE_URL non-postgres', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/d' })).toThrow(/postgres/);
  });

  it('accepte postgresql:// (alias officiel)', () => {
    const result = validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/d' });
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/d');
  });

  it('utilise LOG_LEVEL=info par défaut en production', () => {
    const result = validateEnv({ ...baseValid, NODE_ENV: 'production' });
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('respecte LOG_LEVEL fourni explicitement', () => {
    const result = validateEnv({ ...baseValid, LOG_LEVEL: 'warn' });
    expect(result.LOG_LEVEL).toBe('warn');
  });

  it('rejette LOG_LEVEL invalide', () => {
    expect(() => validateEnv({ ...baseValid, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
