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
import type {
  StoredWorkshopGuideContent,
  WorkshopGuideContent,
} from './workshop-guide-content';
import {
  anAllMaterialsEntry,
  anEntry,
  aWorkshopGuideContent,
  withoutDecoderToggle,
} from './workshop-guide-test-builders';
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
const aDto = (content: StoredWorkshopGuideContent, version: number) =>
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
        decoderEnabled: false,
        entries: [],
        version: 0,
        updatedAt: null,
      });
    });

    it('Given a row stored before the decoder toggle, When read, Then decoderEnabled is false', async () => {
      db.limit.mockResolvedValueOnce([
        aRow({ content: withoutDecoderToggle(aWorkshopGuideContent()) }),
      ]);

      expect(await service.findCurrent()).toStrictEqual({
        ...aWorkshopGuideContent(),
        decoderEnabled: false,
        version: 3,
        updatedAt: UPDATED_AT,
      });
    });

    it('Given the production row (disabled, no entry, no decoder toggle), When read, Then the decoder is off', async () => {
      db.limit.mockResolvedValueOnce([
        aRow({ content: { enabled: false, entries: [] }, version: 1 }),
      ]);

      expect(await service.findCurrent()).toStrictEqual({
        enabled: false,
        decoderEnabled: false,
        entries: [],
        version: 1,
        updatedAt: UPDATED_AT,
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
        decoderEnabled: true,
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
        decoderEnabled: true,
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

    describe('all-materials entries and optional radius (spec 037)', () => {
      /** Entrées écrites par le dernier `set` (mise à jour conditionnelle). */
      const writtenEntries = () =>
        (db.set.mock.calls as [[{ content: { entries: unknown } }]])[0][0]
          .content.entries;

      /** Remplace le guide par un corps brut (valeurs `null` ou vides comprises), tel que validé. */
      const replaceWith = async (entries: object[]) => {
        db.limit.mockResolvedValueOnce([aRow()]);
        db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);
        await service.replace(
          plainToInstance(UpdateWorkshopGuideDto, {
            enabled: true,
            decoderEnabled: true,
            entries,
            version: 3,
          }),
        );
      };

      it.each([
        ['without material', {}],
        ['with an empty material', { material: '' }],
        ['with a null material', { material: null }],
        ['with a material, ignored', { material: '  Inox  ' }],
      ])(
        'Given an all-materials entry %s, When replaced, Then allMaterials is stored without material',
        async (_l, extra) => {
          await replaceWith([
            { ...anAllMaterialsEntry({ operation: 'boring' }), ...extra },
          ]);

          expect(writtenEntries()).toStrictEqual([
            { allMaterials: true, operation: 'boring', insert: 'CODE 0003' },
          ]);
        },
      );

      it.each([
        ['missing', {}],
        ['null', { noseRadius: null }],
      ])(
        'Given a radius %s, When replaced, Then the radius is omitted (never null)',
        async (_l, radius) => {
          await replaceWith([
            {
              material: 'Matière A',
              operation: 'external-roughing',
              insert: 'CODE 0001',
              note: 'Vue',
              ...radius,
            },
          ]);

          expect(writtenEntries()).toStrictEqual([
            {
              material: 'Matière A',
              operation: 'external-roughing',
              insert: 'CODE 0001',
              note: 'Vue',
            },
          ]);
        },
      );

      it('Given allMaterials false, When replaced, Then the material is stored and allMaterials omitted', async () => {
        await replaceWith([
          { ...anEntry({ note: 'Vue' }), allMaterials: false },
        ]);

        expect(writtenEntries()).toStrictEqual([anEntry({ note: 'Vue' })]);
      });

      it('Given a body from the front before spec 037, When replaced, Then the entries are stored as before', async () => {
        await replaceWith([
          {
            material: ' Matière A ',
            operation: 'internal-finishing',
            insert: 'CODE 0001',
            noseRadius: 0.8,
            note: '',
          },
        ]);

        expect(writtenEntries()).toStrictEqual([
          {
            material: 'Matière A',
            operation: 'internal-finishing',
            insert: 'CODE 0001',
            noseRadius: 0.8,
          },
        ]);
      });

      it('Given a row stored before spec 037, When read, Then its entries come back unchanged', async () => {
        const before = aWorkshopGuideContent();
        db.limit.mockResolvedValueOnce([aRow({ content: before })]);

        expect((await service.findCurrent()).entries).toStrictEqual(
          before.entries,
        );
      });

      it('Given a stored all-materials entry without radius, When the same content is replaced, Then nothing is written', async () => {
        const content = aWorkshopGuideContent({
          entries: [anEntry(), anAllMaterialsEntry({ operation: 'boring' })],
        });
        db.limit.mockResolvedValueOnce([aRow({ content })]);

        await service.replace(aDto(content, 3));

        expect(db.update).not.toHaveBeenCalled();
      });
    });

    describe('decoderEnabled (spec 036)', () => {
      /** Contenu écrit par le dernier `set` (mise à jour conditionnelle). */
      const writtenContent = () =>
        (db.set.mock.calls as [[{ content: unknown }]])[0][0].content;

      it.each([
        ['turned off', true, false],
        ['turned on', false, true],
      ])(
        'Given the toggle %s, When replaced, Then the new value is written',
        async (_l, stored, sent) => {
          db.limit.mockResolvedValueOnce([
            aRow({
              content: aWorkshopGuideContent({ decoderEnabled: stored }),
            }),
          ]);
          db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);

          await service.replace(
            aDto(aWorkshopGuideContent({ decoderEnabled: sent }), 3),
          );

          expect(writtenContent()).toStrictEqual(
            aWorkshopGuideContent({ decoderEnabled: sent }),
          );
        },
      );

      it.each([
        ['on', true],
        ['off', false],
      ])(
        'Given the stored decoder %s and a body without the field, When the entries change, Then the stored value is kept',
        async (_l, stored) => {
          db.limit.mockResolvedValueOnce([
            aRow({
              content: aWorkshopGuideContent({ decoderEnabled: stored }),
            }),
          ]);
          db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);

          await service.replace(
            aDto(
              withoutDecoderToggle(aWorkshopGuideContent({ entries: [] })),
              3,
            ),
          );

          expect(writtenContent()).toStrictEqual(
            aWorkshopGuideContent({ decoderEnabled: stored, entries: [] }),
          );
        },
      );

      it('Given a row stored before the toggle and a body without the field, When the entries change, Then false is written', async () => {
        db.limit.mockResolvedValueOnce([
          aRow({ content: withoutDecoderToggle(aWorkshopGuideContent()) }),
        ]);
        db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);

        await service.replace(
          aDto(withoutDecoderToggle(aWorkshopGuideContent({ entries: [] })), 3),
        );

        expect(writtenContent()).toStrictEqual(
          aWorkshopGuideContent({ decoderEnabled: false, entries: [] }),
        );
      });

      it('Given no row, version 0 and a body without the field, When replaced, Then the document is created with the decoder off', async () => {
        db.limit.mockResolvedValueOnce([]);
        db.returning.mockResolvedValueOnce([aRow({ version: 1 })]);

        await service.replace(
          aDto(withoutDecoderToggle(aWorkshopGuideContent()), 0),
        );

        expect(db.values).toHaveBeenCalledWith({
          id: 'main',
          content: aWorkshopGuideContent({ decoderEnabled: false }),
        });
      });

      it.each([
        [
          'a body without the field',
          aRow(),
          withoutDecoderToggle(aWorkshopGuideContent()),
        ],
        [
          'a row stored before the toggle and a body without the field',
          aRow({ content: withoutDecoderToggle(aWorkshopGuideContent()) }),
          withoutDecoderToggle(aWorkshopGuideContent()),
        ],
        [
          'a row stored before the toggle and decoderEnabled false',
          aRow({ content: withoutDecoderToggle(aWorkshopGuideContent()) }),
          aWorkshopGuideContent({ decoderEnabled: false }),
        ],
      ])(
        'Given %s, same content otherwise, When replaced, Then nothing is written',
        async (_l, row, sent) => {
          db.limit.mockResolvedValueOnce([row]);

          await service.replace(aDto(sent, 3));

          expect(db.update).not.toHaveBeenCalled();
          expect(db.insert).not.toHaveBeenCalled();
        },
      );

      it('Given a row with the decoder on and decoderEnabled false, same content otherwise, When replaced, Then it is written', async () => {
        db.limit.mockResolvedValueOnce([aRow()]);
        db.returning.mockResolvedValueOnce([aRow({ version: 4 })]);

        await service.replace(
          aDto(aWorkshopGuideContent({ decoderEnabled: false }), 3),
        );

        expect(db.update).toHaveBeenCalledWith(workshopGuide);
      });
    });
  });
});
