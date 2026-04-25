import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const baseValid = {
    DATABASE_URL: 'postgres://u:p@localhost:55432/db',
    JWT_SECRET: '0123456789abcdef0123456789abcdef', // exactly 32 chars
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'access-key',
    S3_SECRET_KEY: 'secret-key-12345',
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
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/d' })).toThrow(
      /postgres/,
    );
  });

  it('accepte postgresql:// (alias officiel)', () => {
    const result = validateEnv({
      ...baseValid,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    });
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/d');
  });

  it('utilise LOG_LEVEL=info par défaut en production', () => {
    const result = validateEnv({ ...baseValid, NODE_ENV: 'production' });
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('utilise LOG_LEVEL=info par défaut en NODE_ENV=test', () => {
    const result = validateEnv({ ...baseValid, NODE_ENV: 'test' });
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('respecte LOG_LEVEL fourni explicitement', () => {
    const result = validateEnv({ ...baseValid, LOG_LEVEL: 'warn' });
    expect(result.LOG_LEVEL).toBe('warn');
  });

  it('rejette LOG_LEVEL invalide', () => {
    expect(() => validateEnv({ ...baseValid, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('rejette JWT_SECRET trop court', () => {
    expect(() => validateEnv({ ...baseValid, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('utilise JWT_EXPIRES_IN=7d par défaut', () => {
    const result = validateEnv(baseValid);
    expect(result.JWT_EXPIRES_IN).toBe('7d');
  });

  it('respecte JWT_EXPIRES_IN explicite', () => {
    const result = validateEnv({ ...baseValid, JWT_EXPIRES_IN: '14d' });
    expect(result.JWT_EXPIRES_IN).toBe('14d');
  });

  it('rejette ADMIN_EMAIL invalide quand fourni', () => {
    expect(() =>
      validateEnv({ ...baseValid, ADMIN_EMAIL: 'not-an-email' }),
    ).toThrow(/ADMIN_EMAIL/);
  });

  it('rejette ADMIN_INITIAL_PASSWORD trop court quand fourni', () => {
    expect(() =>
      validateEnv({ ...baseValid, ADMIN_INITIAL_PASSWORD: 'short' }),
    ).toThrow(/ADMIN_INITIAL_PASSWORD/);
  });

  it('utilise TOTP_APP_NAME=J-Ned Portfolio par défaut', () => {
    const result = validateEnv(baseValid);
    expect(result.TOTP_APP_NAME).toBe('J-Ned Portfolio');
  });

  it('rejette S3_ENDPOINT non-URL', () => {
    expect(() => validateEnv({ ...baseValid, S3_ENDPOINT: 'not-a-url' })).toThrow(/S3_ENDPOINT/);
  });

  it('rejette S3_ACCESS_KEY trop courte', () => {
    expect(() => validateEnv({ ...baseValid, S3_ACCESS_KEY: 'abc' })).toThrow(/S3_ACCESS_KEY/);
  });

  it('rejette S3_SECRET_KEY trop courte', () => {
    expect(() => validateEnv({ ...baseValid, S3_SECRET_KEY: 'short' })).toThrow(/S3_SECRET_KEY/);
  });

  it('utilise S3_PUBLIC_URL = S3_ENDPOINT par défaut', () => {
    const result = validateEnv(baseValid);
    expect(result.S3_PUBLIC_URL).toBe('http://localhost:9000');
  });

  it('respecte S3_PUBLIC_URL explicite', () => {
    const result = validateEnv({ ...baseValid, S3_PUBLIC_URL: 'https://cdn.example.com' });
    expect(result.S3_PUBLIC_URL).toBe('https://cdn.example.com');
  });
});
