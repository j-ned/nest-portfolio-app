import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrackEventDto } from './track-event.dto';

describe('TrackEventDto', () => {
  async function check(payload: Record<string, unknown>) {
    const dto = plainToInstance(TrackEventDto, payload);
    return validate(dto);
  }

  describe('type field', () => {
    it("type='page_view' valide", async () => {
      const errors = await check({ type: 'page_view', url: '/home' });
      expect(errors).toHaveLength(0);
    });

    it("type='page_duration' valide avec url + duration", async () => {
      const errors = await check({
        type: 'page_duration',
        url: '/home',
        duration: 30,
      });
      expect(errors).toHaveLength(0);
    });

    it("type='project_click' valide sans url", async () => {
      const errors = await check({
        type: 'project_click',
        entityId: 'abc',
        entityTitle: 'Test',
      });
      expect(errors).toHaveLength(0);
    });

    it("type='cv_download' valide sans url ni entity", async () => {
      const errors = await check({ type: 'cv_download' });
      expect(errors).toHaveLength(0);
    });

    it("type='article_read' valide avec entityId + entityTitle", async () => {
      const errors = await check({
        type: 'article_read',
        entityId: 'abc',
        entityTitle: 'Test',
      });
      expect(errors).toHaveLength(0);
    });

    it("type='cta_click' valide avec entityId + entityTitle", async () => {
      const errors = await check({
        type: 'cta_click',
        entityId: 'home_hero_projects',
        entityTitle: 'Voir les projets',
      });
      expect(errors).toHaveLength(0);
    });

    it('type manquant → erreur', async () => {
      const errors = await check({ url: '/home' });
      const typeErr = errors.find((e) => e.property === 'type');
      expect(typeErr).toBeDefined();
    });

    it('type invalide → erreur', async () => {
      const errors = await check({ type: 'unknown_event', url: '/home' });
      const typeErr = errors.find((e) => e.property === 'type');
      expect(typeErr).toBeDefined();
    });
  });

  describe('url conditional requirement', () => {
    it("type='page_view' sans url → erreur sur url", async () => {
      const errors = await check({ type: 'page_view' });
      const urlErr = errors.find((e) => e.property === 'url');
      expect(urlErr).toBeDefined();
    });

    it("type='page_duration' sans duration → erreur sur duration (une durée absente ne vaut pas 0 s)", async () => {
      const errors = await check({ type: 'page_duration', url: '/home' });
      expect(errors.map((e) => e.property)).toContain('duration');
    });

    it("type='page_view' sans duration → valide", async () => {
      const errors = await check({ type: 'page_view', url: '/home' });
      expect(errors).toHaveLength(0);
    });

    it("type='page_duration' sans url → erreur sur url", async () => {
      const errors = await check({ type: 'page_duration', duration: 30 });
      const urlErr = errors.find((e) => e.property === 'url');
      expect(urlErr).toBeDefined();
    });
  });

  describe('événements v2 : entityId validé par type', () => {
    it.each([
      [{ type: 'contact_submit', entityId: 'home' }],
      [{ type: 'contact_submit', entityId: 'offer_site-vitrine' }],
      [{ type: 'outbound_click', entityId: 'email', entityTitle: '/' }],
      [{ type: 'outbound_click', entityId: 'phone', entityTitle: '/about' }],
      [{ type: 'outbound_click', entityId: 'malt' }],
      [{ type: 'outbound_click', entityId: 'discord' }],
      [{ type: 'outbound_click', entityId: 'linkedin' }],
      [{ type: 'outbound_click', entityId: 'github' }],
      [{ type: 'outbound_click', entityId: 'demo' }],
      [{ type: 'section_view', entityId: 'home_contact', entityTitle: '/' }],
    ])('Given %o, When validated, Then no error', async (payload) => {
      const errors = await check(payload);
      expect(errors).toHaveLength(0);
    });

    it.each([
      ['emplacement absent', { type: 'contact_submit' }],
      ['majuscule', { type: 'contact_submit', entityId: 'Home' }],
      ['espace', { type: 'contact_submit', entityId: 'offre vitrine' }],
      ['65 caractères', { type: 'contact_submit', entityId: 'a'.repeat(65) }],
      ['canal absent', { type: 'outbound_click' }],
      ['canal hors liste', { type: 'outbound_click', entityId: 'twitter' }],
      ['adresse', { type: 'outbound_click', entityId: 'mailto:a@b.fr' }],
      ['section absente', { type: 'section_view' }],
      ['section inconnue', { type: 'section_view', entityId: 'home_hero' }],
    ])(
      'Given %s (%o), When validated, Then an error on entityId',
      async (_reason: string, payload: Record<string, unknown>) => {
        const errors = await check(payload);
        expect(errors.map((e) => e.property)).toContain('entityId');
      },
    );

    it('Given a v1 event with a free entityId, When validated, Then no error (règles v1 inchangées)', async () => {
      const errors = await check({ type: 'cta_click', entityId: 'Home Hero' });
      expect(errors).toHaveLength(0);
    });
  });

  describe('événements v2 : aucune donnée libre (RGPD)', () => {
    it.each([
      ['outbound_click', '/offres/site-vitrine'],
      ['outbound_click', '/'],
      ['section_view', '/'],
      ['outbound_click', '/blog/mon-article-%C3%A9t%C3%A9'],
    ])(
      'Given %s with entityTitle %s (un chemin), When validated, Then no error',
      async (type, entityTitle) => {
        const errors = await check({
          type,
          entityId: type === 'section_view' ? 'home_contact' : 'email',
          entityTitle,
        });
        expect(errors).toHaveLength(0);
      },
    );

    it('Given a path with a query string, When transformed, Then only the path is kept', () => {
      const dto = plainToInstance(TrackEventDto, {
        type: 'outbound_click',
        entityId: 'email',
        entityTitle: '/offres/x?email=jean@exemple.fr#demande',
      });
      expect(dto.entityTitle).toBe('/offres/x');
    });

    it.each([
      ['texte libre', 'Jean Dupont 06 12 34 56 78'],
      ['adresse', 'mailto:jean@exemple.fr'],
      ['espace', '/a b'],
      ['trop long', `/${'a'.repeat(200)}`],
    ])(
      'Given an outbound_click with entityTitle (%s), When validated, Then an error on entityTitle',
      async (_reason: string, entityTitle: string) => {
        const errors = await check({
          type: 'outbound_click',
          entityId: 'email',
          entityTitle,
        });
        expect(errors.map((e) => e.property)).toContain('entityTitle');
      },
    );

    it.each([
      ['contact_submit', 'home'],
      ['outbound_click', 'email'],
      ['section_view', 'home_contact'],
    ])(
      'Given a %s with metadata, When validated, Then an error on metadata',
      async (type, entityId) => {
        const errors = await check({
          type,
          entityId,
          metadata: { email: 'jean@exemple.fr' },
        });
        expect(errors.map((e) => e.property)).toContain('metadata');
      },
    );

    it('Given a v1 event with a free title and metadata, When validated, Then no error (règles v1 inchangées)', async () => {
      const errors = await check({
        type: 'project_click',
        entityId: 'abc',
        entityTitle: 'Voir les projets ?',
        metadata: { source: 'card' },
      });
      expect(errors).toHaveLength(0);
    });
  });
});
