import type { ProfileContent } from './profile-content';

/** Contenu de test neutre, valide au regard du DTO : jamais la copie réelle du parcours. */
export const aProfileContent = (
  overrides: Partial<ProfileContent> = {},
): ProfileContent => ({
  biography: {
    title: 'Titre',
    summary: 'Résumé',
    leadEmphasis: 'Suite',
    paragraphs: ['Paragraphe un', 'Paragraphe deux'],
  },
  highlights: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Trait',
      description: 'Description du trait',
    },
  ],
  workSummary: 'Résumé activités',
  whatIDo: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Activité',
      description: 'Description activité',
    },
  ],
  technologies: [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'Techno',
      category: 'Catégorie',
      icon: 'angular',
    },
  ],
  diplomasSummary: 'Résumé formations',
  diplomas: [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      title: 'Titre pro',
      provider: 'Organisme',
      level: 'niveau 5',
      shortDescription: 'Description formation',
      skills: ['Compétence'],
    },
  ],
  motivation: { title: 'Motivation', statement: 'Énoncé', description: 'Desc' },
  ...overrides,
});
