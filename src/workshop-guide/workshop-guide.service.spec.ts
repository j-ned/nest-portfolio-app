import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import {
  workshopGuide,
  type WorkshopGuideRow,
} from '../database/schema/workshop-guide';
import { createMockDb } from '../database/test-utils';
import { UpdateWorkshopGuideDto } from './dto/update-workshop-guide.dto';
import type { WorkshopGuideContent } from './workshop-guide-content';
import { anEntry, aWorkshopGuideContent } from './workshop-guide-test-builders';
import { WorkshopGuideService } from './workshop-guide.service';

const UPDATED_AT = new Date('2026-10-27T08:00:00.000Z');

const aRow = (overrides: Partial<WorkshopGuideRow> = {}): WorkshopGuideRow => ({
  id: 'main',
  content: aWorkshopGuideContent(),
  version: 3,
  updatedAt: UPDATED_AT,
  ...overrides,
});

/** Le corps tel que la ValidationPipe le livre : une instance du DTO. */
const aDto = (content: WorkshopGuideContent, version: number) =>
  plainToInstance(UpdateWorkshopGuideDto, { ...content, version });

describe('WorkshopGuideService', () => {
  let service: WorkshopGuideService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module = await Test.createTestingModule({
      providers: [WorkshopGuideService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(WorkshopGuideService);
  });

  describe('findCurrent', () => {
    it('Given the row, When read, Then the content comes flat with its version and date', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);

      const result = await service.findCurrent();

      expect(db.where).toHaveBeenCalledWith(eq(workshopGuide.id, 'main'));
      expect(result).toEqual({
        ...aWorkshopGuideContent(),
        version: 3,
        updatedAt: UPDATED_AT,
      });
    });

    it('Given no row, When read, Then the default document: disabled, no entry, version 0, no date', async () => {
      db.limit.mockResolvedValueOnce([]);

      expect(await service.findCurrent()).toEqual({
        enabled: false,
        entries: [],
        version: 0,
        updatedAt: null,
      });
    });
  });

  describe('replace', () => {
    const changed = aWorkshopGuideContent({ enabled: false });

    it('Given the same content at the current version, When replaced, Then nothing is written', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);

      const result = await service.replace(aDto(aWorkshopGuideContent(), 3));

      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(result).toEqual({
        ...aWorkshopGuideContent(),
        version: 3,
        updatedAt: UPDATED_AT,
      });
    });

    it('Given a new content at the current version, When replaced, Then a conditional update bumps the version', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);
      const saved = aRow({ content: changed, version: 4 });
      db.returning.mockResolvedValueOnce([saved]);

      const result = await service.replace(aDto(changed, 3));

      expect(db.update).toHaveBeenCalledWith(workshopGuide);
      expect(db.set).toHaveBeenCalledWith({
        content: changed,
        version: sql`${workshopGuide.version} + 1`,
        updatedAt: expect.any(Date) as Date,
      });
      expect(db.where).toHaveBeenLastCalledWith(
        and(eq(workshopGuide.id, 'main'), eq(workshopGuide.version, 3)),
      );
      expect(result).toEqual({ ...changed, version: 4, updatedAt: UPDATED_AT });
    });

    it.each([
      ['the same content', aWorkshopGuideContent()],
      ['a new content', changed],
    ])(
      'Given %s at a stale version, When replaced, Then the conditional write answers 409',
      async (_l, content) => {
        db.limit.mockResolvedValueOnce([aRow({ version: 4 })]);
        db.returning.mockResolvedValueOnce([]);

        await expect(service.replace(aDto(content, 3))).rejects.toThrow(
          ConflictException,
        );
      },
    );

    it('Given no row and version 0, When replaced, Then the document is created at version 1', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        aRow({ content: changed, version: 1 }),
      ]);

      const result = await service.replace(aDto(changed, 0));

      expect(db.insert).toHaveBeenCalledWith(workshopGuide);
      expect(db.values).toHaveBeenCalledWith({ id: 'main', content: changed });
      expect(db.onConflictDoNothing).toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(result).toEqual({ ...changed, version: 1, updatedAt: UPDATED_AT });
    });

    it('Given version 0 but a row created meanwhile, When replaced, Then 409', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([]);

      await expect(service.replace(aDto(changed, 0))).rejects.toThrow(
        ConflictException,
      );
    });

    it('Given entries with padding, an empty note and DTO instances, When replaced, Then plain trimmed objects are stored, field by field, in order', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);
      db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);
      const sent: WorkshopGuideContent = {
        enabled: true,
        entries: [
          anEntry({ material: '  Inox  ', insert: ' CODE 9 ', note: '  ' }),
          anEntry({ material: 'Alu', note: ' Vue ' }),
          {
            material: 'Laiton',
            operation: 'drilling',
            insert: 'X',
            noseRadius: 0.2,
          },
        ],
      };

      await service.replace(aDto(sent, 3));

      const [[written]] = db.set.mock.calls as [[{ content: unknown }]];
      const stored = written.content;
      expect(stored).toStrictEqual({
        enabled: true,
        entries: [
          {
            material: 'Inox',
            operation: 'external-roughing',
            insert: 'CODE 9',
            noseRadius: 0.8,
          },
          {
            material: 'Alu',
            operation: 'external-roughing',
            insert: 'CODE 0001',
            noseRadius: 0.8,
            note: 'Vue',
          },
          {
            material: 'Laiton',
            operation: 'drilling',
            insert: 'X',
            noseRadius: 0.2,
          },
        ],
      });
    });
  });
});
