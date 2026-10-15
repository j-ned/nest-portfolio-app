import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTemplate } from './mailer.utils';

type Rgb = readonly [number, number, number];
type Declarations = Map<string, string>;
type Element = {
  tag: string;
  inline: Declarations;
  classes: readonly string[];
  parent: Element | undefined;
};
type TextRun = { text: string; element: Element };
type Rule = { selector: string; declarations: Declarations };
type Scheme = 'light' | 'dark';

const SRC = resolve(__dirname, '..');
const read = (path: string): string =>
  readFileSync(resolve(SRC, path), 'utf-8');

const CANCELLED_WITH_REASON = read(
  'booking/mail-templates/booking-cancelled.html',
).replace(
  '{{reasonRow}}',
  read('booking/mail-templates/booking-cancelled-reason.html').trim(),
);

const TEMPLATES: readonly (readonly [string, string])[] = [
  [
    'booking-confirmation',
    read('booking/mail-templates/booking-confirmation.html'),
  ],
  [
    'booking-notification',
    read('booking/mail-templates/booking-notification.html'),
  ],
  ['booking-reminder', read('booking/mail-templates/booking-reminder.html')],
  [
    'booking-cancelled',
    read('booking/mail-templates/booking-cancelled.html').replace(
      '{{reasonRow}}',
      '',
    ),
  ],
  ['booking-cancelled + booking-cancelled-reason', CANCELLED_WITH_REASON],
  [
    'contact-confirmation',
    read('contact/mail-templates/contact-confirmation.html'),
  ],
  [
    'contact-notification',
    read('contact/mail-templates/contact-notification.html'),
  ],
];

const MIN_CONTRAST = 4.5;
const VOID_TAGS = new Set(['br', 'img', 'hr', 'meta', 'input', 'link', 'wbr']);
const BLANK_TEXT = /^(?:\s|&nbsp;|&#160;|&#xa0;)*$/i;
const DARK_QUERY = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i;

const parseColor = (raw: string): Rgb => {
  const value = raw.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (long) {
    return [
      parseInt(long[1], 16),
      parseInt(long[2], 16),
      parseInt(long[3], 16),
    ];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (value === 'white') return [255, 255, 255];
  if (value === 'black') return [0, 0, 0];
  throw new Error(`Couleur opaque non évaluable : « ${raw} »`);
};

const relativeLuminance = ([r, g, b]: Rgb): number => {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrastRatio = (a: Rgb, b: Rgb): number => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
};

const parseDeclarations = (block: string): Declarations =>
  new Map(
    block
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.includes(':'))
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        return [
          declaration.slice(0, colon).trim().toLowerCase(),
          declaration.slice(colon + 1).trim(),
        ] as const;
      }),
  );

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)?.[1];

const headOf = (html: string): string =>
  html.slice(0, Math.max(html.search(/<body\b/i), 0));

const bodyOf = (html: string): string => {
  const start = html.search(/<body\b/i);
  const end = html.search(/<\/body>/i);
  return html.slice(start, end === -1 ? undefined : end);
};

const styleBlocks = (html: string): string =>
  [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n');

/** Corps du premier bloc `@media` sombre, borné par comptage d'accolades. */
const darkMediaBody = (css: string): string | undefined => {
  const match = DARK_QUERY.exec(css);
  if (!match) return undefined;
  const open = css.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}') depth--;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return undefined;
};

const darkRules = (html: string): Rule[] => {
  const body = darkMediaBody(styleBlocks(html)) ?? '';
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    ([, selectors, block]) =>
      selectors.split(',').map((selector) => ({
        selector: selector.trim(),
        declarations: parseDeclarations(block),
      })),
  );
};

const SIMPLE_SELECTOR = /^(?:\.[\w-]+|[a-z]+)$/;

const textRuns = (html: string): TextRun[] => {
  const markup = bodyOf(html).replace(/<!--[\s\S]*?-->/g, '');
  const runs: TextRun[] = [];
  let current: Element | undefined;
  for (const [, closing, tag, attributes, text] of markup.matchAll(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g,
  )) {
    if (text !== undefined) {
      if (current && !BLANK_TEXT.test(text)) {
        runs.push({ text: text.trim(), element: current });
      }
      continue;
    }
    const name = tag.toLowerCase();
    if (closing) {
      let cursor = current;
      while (cursor && cursor.tag !== name) cursor = cursor.parent;
      current = cursor?.parent ?? current;
      continue;
    }
    const element: Element = {
      tag: name,
      inline: parseDeclarations(attribute(attributes, 'style') ?? ''),
      classes: (attribute(attributes, 'class') ?? '')
        .split(/\s+/)
        .filter((cls) => cls !== ''),
      parent: current,
    };
    if (!VOID_TAGS.has(name) && !attributes.trim().endsWith('/')) {
      current = element;
    }
  }
  return runs;
};

const declared = (
  element: Element,
  property: string,
  rules: readonly Rule[],
): string | undefined => {
  const important = rules
    .filter(
      ({ selector }) =>
        selector === element.tag ||
        (selector.startsWith('.') &&
          element.classes.includes(selector.slice(1))),
    )
    .map(({ declarations }) => declarations.get(property))
    .filter((value): value is string => value?.includes('!important') === true)
    .map((value) => value.replace(/!important/i, '').trim());
  return important.at(-1) ?? element.inline.get(property);
};

type Paint = { kind: 'solid'; rgb: Rgb } | { kind: 'gradient'; raw: string };

const backgroundOf = (
  element: Element,
  rules: readonly Rule[],
): Paint | undefined => {
  const value =
    declared(element, 'background-color', rules) ??
    declared(element, 'background', rules);
  if (value === undefined || /^transparent$/i.test(value)) return undefined;
  if (/gradient\(/i.test(value)) return { kind: 'gradient', raw: value };
  const color = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/i.exec(
    value,
  )?.[0];
  return color ? { kind: 'solid', rgb: parseColor(color) } : undefined;
};

const closest = <T>(
  element: Element | undefined,
  pick: (element: Element) => T | undefined,
): T | undefined => {
  for (let cursor = element; cursor; cursor = cursor.parent) {
    const value = pick(cursor);
    if (value !== undefined) return value;
  }
  return undefined;
};

const rulesFor = (html: string, scheme: Scheme): readonly Rule[] =>
  scheme === 'dark' ? darkRules(html) : [];

const contrastViolations = (html: string, scheme: Scheme): string[] => {
  const rules = rulesFor(html, scheme);
  return textRuns(html).flatMap(({ text, element }) => {
    const background = closest(element, (el) => backgroundOf(el, rules)) ?? {
      kind: 'solid' as const,
      rgb: [255, 255, 255] as const,
    };
    if (background.kind === 'gradient') {
      return [`« ${text} » posé sur un dégradé (${background.raw})`];
    }
    const color = parseColor(
      closest(element, (el) => declared(el, 'color', rules)) ?? '#000',
    );
    const ratio = contrastRatio(color, background.rgb);
    return ratio >= MIN_CONTRAST
      ? []
      : [`« ${text} » contraste ${ratio.toFixed(2)}:1`];
  });
};

const rootBackground = (html: string, scheme: Scheme): Rgb => {
  const rules = rulesFor(html, scheme);
  const runs = textRuns(html);
  const root = closest(runs[0]?.element, (el) =>
    el.parent === undefined ? el : undefined,
  );
  const paint = root && backgroundOf(root, rules);
  if (paint?.kind !== 'solid') {
    throw new Error('Fond du <body> absent ou non uni');
  }
  return paint.rgb;
};

describe('Gabarits d’email', () => {
  describe.each(TEMPLATES)('%s', (_name, html) => {
    it('Given le gabarit, Then il déclare les deux thèmes dans ses métadonnées', () => {
      const head = headOf(html);

      expect(head).toMatch(
        /<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/,
      );
      expect(head).toMatch(
        /<meta\s+name="supported-color-schemes"\s+content="light dark"\s*\/?>/,
      );
      expect(styleBlocks(headOf(html))).toMatch(
        /:root\s*\{\s*color-scheme:\s*light dark;?\s*\}/,
      );
    });

    it('Given le thème par défaut, Then le fond du corps est clair', () => {
      expect(relativeLuminance(rootBackground(html, 'light'))).toBeGreaterThan(
        0.85,
      );
    });

    it('Given le thème par défaut, Then chaque texte contraste d’au moins 4,5:1 avec son fond uni', () => {
      expect(contrastViolations(html, 'light')).toEqual([]);
    });

    it('Given le gabarit, Then un bloc prefers-color-scheme sombre redéfinit fonds et textes par des sélecteurs simples présents dans le corps', () => {
      const rules = darkRules(html);
      const classesInBody = new Set(
        [...bodyOf(html).matchAll(/\bclass\s*=\s*"([^"]*)"/gi)].flatMap(
          ([, classes]) => classes.split(/\s+/),
        ),
      );

      expect(DARK_QUERY.test(styleBlocks(headOf(html)))).toBe(true);
      expect(
        rules.filter(({ selector }) => !SIMPLE_SELECTOR.test(selector)),
      ).toEqual([]);
      expect(
        rules
          .filter(({ selector }) => selector.startsWith('.'))
          .map(({ selector }) => selector.slice(1))
          .filter((cls) => !classesInBody.has(cls)),
      ).toEqual([]);
      const properties = rules.flatMap(({ declarations }) => [
        ...declarations.keys(),
      ]);
      expect(properties).toContain('color');
      expect(
        properties.some(
          (property) =>
            property === 'background-color' || property === 'background',
        ),
      ).toBe(true);
    });

    it('Given le thème sombre, Then le fond du corps est sombre', () => {
      expect(relativeLuminance(rootBackground(html, 'dark'))).toBeLessThan(
        0.05,
      );
    });

    it('Given le thème sombre, Then chaque texte contraste d’au moins 4,5:1 avec son fond uni', () => {
      expect(contrastViolations(html, 'dark')).toEqual([]);
    });

    it('Given des variables contenant du HTML, When le gabarit est rendu, Then chaque variable est échappée', () => {
      const placeholders = [...html.matchAll(/\{\{(\w+)\}\}/g)].map(
        ([, key]) => key,
      );
      const variables = Object.fromEntries(
        placeholders.map((key) => [key, `<b>${key}</b>"`]),
      );

      const rendered = renderTemplate(html, variables);

      expect(placeholders.length).toBeGreaterThan(0);
      expect(rendered).not.toMatch(/\{\{\w+\}\}/);
      for (const key of placeholders) {
        expect(rendered).not.toContain(`<b>${key}</b>`);
        expect(rendered).toContain(`&lt;b&gt;${key}&lt;/b&gt;&quot;`);
      }
    });
  });

  describe('outil de mesure', () => {
    it.each([
      ['#000', '#fff', 21],
      ['#94a3b8', '#262629', 5.89],
      ['#475569', '#1e1e1e', 2.2],
      ['#767676', '#ffffff', 4.54],
    ])(
      'Given %s sur %s, Then le ratio WCAG vaut %s:1',
      (foreground, background, expected) => {
        expect(
          contrastRatio(parseColor(foreground), parseColor(background)),
        ).toBeCloseTo(expected, 1);
      },
    );

    it('Given un texte blanc sur un badge en dégradé, Then il est signalé', () => {
      const html =
        '<body style="background-color:#ffffff;"><span style="background:linear-gradient(135deg,#60a5fa,#a78bfa);color:#fff;">Badge</span></body>';

      expect(contrastViolations(html, 'light')).toEqual([
        '« Badge » posé sur un dégradé (linear-gradient(135deg,#60a5fa,#a78bfa))',
      ]);
    });

    it('Given une classe sombre déclarée sans !important, Then le style inline l’emporte', () => {
      const html =
        '<head><style>@media (prefers-color-scheme: dark) { .card { background-color: #111111; } .text { color: #eeeeee !important; } }</style></head><body style="background-color:#ffffff;"><p class="card text" style="color:#222222;">Texte</p></body>';

      expect(contrastViolations(html, 'dark')).toEqual([
        '« Texte » contraste 1.16:1',
      ]);
    });
  });
});
