import { OUTBOUND_CHANNELS } from './dto/track-event.dto';
import {
  ENGAGED_DURATION_SECONDS,
  ENGAGEMENT_EVENT_TYPES,
  OUTBOUND_GROUPS,
  V2_EVENT_TYPES,
} from './engagement';

/** Définitions figées sur l'ADR-0022 (front, `docs/adr/0022-engagement-et-rebond-reel.md`). */
describe('engagement (ADR-0022)', () => {
  it('Given the ADR, Then a visit is engaged after 30 s of visible time', () => {
    expect(ENGAGED_DURATION_SECONDS).toBe(30);
  });

  it('Given the ADR, Then the engagement events are exactly the voluntary actions', () => {
    expect([...ENGAGEMENT_EVENT_TYPES].sort()).toEqual(
      [
        'article_read',
        'contact_submit',
        'cta_click',
        'cv_download',
        'outbound_click',
        'project_click',
        'section_view',
      ].sort(),
    );
  });

  it('Given automatic events, Then they never make a visit engaged', () => {
    expect(ENGAGEMENT_EVENT_TYPES).not.toContain('article_view');
    expect(ENGAGEMENT_EVENT_TYPES).not.toContain('page_view');
    expect(ENGAGEMENT_EVENT_TYPES).not.toContain('page_duration');
  });

  it('Given the spec 020 events, Then they mark conversions as measured', () => {
    expect([...V2_EVENT_TYPES].sort()).toEqual(
      ['contact_submit', 'outbound_click', 'section_view'].sort(),
    );
  });

  it('Given the outbound channels, Then contact, profile and demo groups match the ADR and cover every channel once', () => {
    expect(OUTBOUND_GROUPS).toEqual({
      contact: ['email', 'phone', 'malt', 'discord'],
      profile: ['linkedin', 'github'],
      demo: ['demo'],
    });
    expect(Object.values(OUTBOUND_GROUPS).flat().sort()).toEqual(
      [...OUTBOUND_CHANNELS].sort(),
    );
  });
});
