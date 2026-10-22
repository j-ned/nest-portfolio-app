import type { ProfileContent } from './profile-content';

/**
 * Contenu initial du parcours (spec 021, A2) : généré mécaniquement depuis les données statiques du
 * front (`profile.static-data.ts`, résumés de `about-what-i-do.ts` et `about-diploma.ts`), jamais
 * recopié à la main. La migration `drizzle/0021_profile_seed.sql` verse le même JSON (test d'égalité).
 *
 * Instantané figé de 0021, déjà appliquée en production : ne pas le réécrire. Un texte devenu faux
 * se corrige par une migration suivante (0028 remplace `motivation.description`, qu'elle repère mot
 * pour mot dans cette graine) ou dans l'admin.
 */
export const PROFILE_SEED: ProfileContent = {
  biography: {
    title: 'Mon parcours',
    summary:
      "De la chaudronnerie au tournage CN dans l'aéronautique, et au développement web en parallèle\u00a0: la même exigence.",
    leadEmphasis:
      "Angular et NestJS d'abord, PHP et Java aussi, en méthode agile.",
    paragraphs: [
      "Je ne suis pas venu au développement web par hasard. De la chaudronnerie au tournage CN de haute précision dans l'aéronautique, mon métier aujourd'hui, j'ai vu les outils numériques transformer un secteur entier. J'ai compris que je pouvais avoir plus d'impact en créant ces outils plutôt qu'en les utilisant.",
      "Formé dans un environnement où l'erreur coûte cher, j'ai développé une exigence que j'applique à chaque ligne de code\u00a0: pensée pour durer, comprise de bout en bout, de la requête SQL au déploiement en production. Je ne me contente jamais de faire fonctionner, je comprends pourquoi ça fonctionne.",
      "Cette expérience m'a donné une vision systémique rare\u00a0: je ne code pas des features isolées, je conçois des solutions complètes qui résolvent de vrais problèmes métier.",
    ],
  },
  highlights: [
    {
      id: 'f91a2bc6-7369-4ff5-8ab3-7ece1426be50',
      title: 'Exigence de production',
      description:
        "Formé dans un environnement où l'erreur coûte cher, j'écris du code pensé pour durer. Type-safe, testé, documenté.",
    },
    {
      id: 'bf68db5e-044f-400c-895a-e67de2f0d151',
      title: 'Autonomie réelle',
      description:
        "Autodidacte, je trouve des solutions quand il n'y a pas de tutoriel. Je lis la doc, je comprends les sources, je creuse jusqu'à résoudre.",
    },
    {
      id: '65665431-8b96-4957-bec3-8403689adfcf',
      title: "Vision d'ensemble",
      description:
        "Je ne code pas dans le vide. Je comprends le métier, l'architecture, les contraintes.",
    },
  ],
  workSummary: 'Du composant au serveur qui le sert.',
  whatIDo: [
    {
      id: '23ff2843-921d-4b76-b070-83a50bd87665',
      title: 'Applications complètes',
      description:
        'Je construis des applications de production de bout en bout\u00a0: conception, Full Stack (Angular moderne, NestJS, PostgreSQL) et déploiement conteneurisé (Docker). Pas des démos, mais des systèmes qui tournent.',
    },
    {
      id: 'dffce031-2162-4f1b-97d9-ef2c9790734d',
      title: 'Infrastructure',
      description:
        "Je gère l'intégralité de mon infrastructure\u00a0: auto-hébergement (VPS) et déploiement continu (CI/CD) via Dokploy, jusqu'aux services en production. Ce contrôle opérationnel total garantit la fiabilité et fait de moi un développeur plus complet.",
    },
  ],
  technologies: [
    {
      id: '2f66a183-bc6a-487b-9517-1235c2773f43',
      name: 'Angular',
      category: 'Framework',
      icon: 'angular',
    },
    {
      id: 'a9aafa1f-a140-40ff-ac14-5e669d5ee314',
      name: 'NestJS',
      category: 'Backend',
      icon: 'nestjs',
    },
    {
      id: '92293b7c-48a1-48fc-a1ee-9f66b94464c3',
      name: 'TypeScript',
      category: 'Langage',
      icon: 'typescript',
    },
    {
      id: '3af8cb9a-fb26-45bb-b9f8-1f2f4af7f54d',
      name: 'Tailwind CSS',
      category: 'Styling',
      icon: 'tailwindcss',
    },
    {
      id: '3f002354-321f-45f1-bfc2-2bb578ffb904',
      name: 'PostgreSQL',
      category: 'Base de données',
      icon: 'postgresql',
    },
    {
      id: '89901eaf-377c-46e1-b3ae-75b2ec28465e',
      name: 'Docker',
      category: 'DevOps',
      icon: 'docker',
    },
  ],
  diplomasSummary: 'Deux titres professionnels de niveau 5 (Bac+2).',
  diplomas: [
    {
      id: '2a970a44-7422-4e6c-adaa-5b78f6620e10',
      title: 'Développeur Web et Web Mobile',
      provider: 'Studi',
      level: 'titre professionnel · niveau 5',
      shortDescription:
        "Titre professionnel de niveau 5 axé sur la conception, le développement et la maintenance d'applications web et mobiles, avec une pédagogie orientée bonnes pratiques et travail en équipe.",
      skills: [
        'HTML5, CSS3, JavaScript',
        'Angular & TypeScript',
        'SQL & NoSQL',
        'Git & GitHub',
        'Responsive Design',
        'API REST',
      ],
    },
    {
      id: '5886de30-2beb-4654-b61d-50c737594a47',
      title: "Développeur d'applications PGI/ERP",
      provider: 'ALT-RH',
      level: 'titre professionnel · niveau 5',
      shortDescription:
        "Titre professionnel de niveau 5 dédié à la conception et à la maintenance d'applications de gestion intégrées, avec un focus sur l'architecture logicielle et la collaboration agile.",
      skills: [
        'HTML5, CSS3, JavaScript, jQuery',
        'Java & J2EE',
        'MySQL, UML & modélisation',
        'Git & gestion de version',
        'Algorithmique & design patterns',
        'Méthodes agiles (Scrum, RUP)',
      ],
    },
  ],
  motivation: {
    title: 'Ce qui me motive',
    statement:
      "La tech au service d'un impact positif\u00a0: GreenTech, industrie durable, projets qui ont du sens.",
    description:
      'Disponible en freelance sur Malt pour vos projets Angular et NestJS, et ouvert au CDI en Île-de-France dans une équipe produit fintech, greentech ou industrial tech.',
  },
};
