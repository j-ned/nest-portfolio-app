import { escapeHtml, renderTemplate } from './mailer.utils';

describe('renderTemplate', () => {
  it('remplace une variable simple', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'Julien' })).toBe(
      'Hello Julien',
    );
  });

  it('remplace plusieurs occurrences de la même variable', () => {
    expect(renderTemplate('{{x}} et encore {{x}}', { x: 'A' })).toBe(
      'A et encore A',
    );
  });

  it('laisse intactes les variables non fournies', () => {
    expect(renderTemplate('Hi {{a}} {{b}}', { a: 'X' })).toBe('Hi X {{b}}');
  });

  it('gère un template sans variables ni placeholders', () => {
    expect(renderTemplate('static', {})).toBe('static');
  });

  it('préserve les caractères spéciaux $ dans les valeurs', () => {
    // String form of replaceAll interprets $-sequences ($&, $$, $1, etc.).
    // The function form (used in renderTemplate) disables that - verify here.
    expect(renderTemplate('Prix: {{amount}}', { amount: '$100' })).toBe(
      'Prix: $100',
    );
    // `&` est échappé en `&amp;` ; si `$&` était interprété, on lirait le placeholder lui-même.
    expect(renderTemplate('Match: {{x}}', { x: '$&' })).toBe('Match: $&amp;');
    expect(renderTemplate('Dollar: {{x}}', { x: '$$' })).toBe('Dollar: $$');
  });

  describe('échappement HTML (valeurs issues du formulaire public)', () => {
    it.each([
      [
        '<a href="https://evil">Voir</a>',
        '&lt;a href=&quot;https://evil&quot;&gt;Voir&lt;/a&gt;',
      ],
      ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
      ['" onmouseover="alert(1)', '&quot; onmouseover=&quot;alert(1)'],
      ["it's & co", 'it&#39;s &amp; co'],
      ['Julien', 'Julien'],
    ])('%s → %s', (raw, expected) => {
      expect(renderTemplate('<p>{{v}}</p>', { v: raw })).toBe(
        `<p>${expected}</p>`,
      );
    });

    it("neutralise une sortie d'attribut href", () => {
      const html = renderTemplate('<a href="mailto:{{email}}">x</a>', {
        email: 'a@b.fr" onclick="alert(1)',
      });
      expect(html).toBe(
        '<a href="mailto:a@b.fr&quot; onclick=&quot;alert(1)">x</a>',
      );
    });

    it('escapeHtml laisse les caractères ordinaires intacts', () => {
      expect(escapeHtml('Bonjour, ça va ?')).toBe('Bonjour, ça va ?');
    });
  });
});
