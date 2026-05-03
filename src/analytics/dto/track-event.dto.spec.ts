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

    it("type='page_duration' sans url → erreur sur url", async () => {
      const errors = await check({ type: 'page_duration', duration: 30 });
      const urlErr = errors.find((e) => e.property === 'url');
      expect(urlErr).toBeDefined();
    });
  });
});
