/**
 * Mock du builder Drizzle pour les tests unitaires des services.
 *
 * L'API Drizzle est fluent : db.select().from(table).where(...).limit(1).
 * Chaque méthode retourne un builder mockReturnThis pour permettre le chaînage.
 *
 * Le terminator (`returning`, ou un await direct sur la chaîne) doit être
 * configuré par chaque test : `db.returning.mockResolvedValueOnce([{...}])`.
 *
 * Pour les méthodes qui retournent directement un Promise<T[]> sans .returning()
 * (comme `db.select().from(t).where(...)` qui est awaitable), on utilise
 * `mockImplementation` pour simuler. En pratique, les services Drizzle
 * appellent toujours .returning() pour insert/update/delete et awaitent
 * directement pour select. Pour mocker le select, on peut faire
 * `db.where.mockResolvedValueOnce([...])` ou `db.limit.mockResolvedValueOnce([...])`.
 */
export function createMockDb() {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    insert: jest.fn(),
    values: jest.fn(),
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
