/**
 * Mock chaînable du builder Drizzle pour les tests unitaires des services.
 * Configurer le terminator par test : `db.returning.mockResolvedValueOnce([{...}])`,
 * ou `db.limit.mockResolvedValueOnce([...])` pour les selects sans `.returning()`.
 */
export function createMockDb() {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    groupBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    insert: jest.fn(),
    values: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    returning: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/require-await
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(builder)),
    execute: jest.fn(),
  };
  // Chaque méthode retourne le builder lui-même pour permettre le chaînage.
  for (const key of Object.keys(builder)) {
    if (key !== 'transaction') {
      builder[key].mockReturnValue(builder);
    }
  }
  return builder;
}
