import { renderTemplate } from './mailer.utils';

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
    // The function form (used in renderTemplate) disables that — verify here.
    expect(renderTemplate('Prix: {{amount}}', { amount: '$100' })).toBe(
      'Prix: $100',
    );
    expect(renderTemplate('Match: {{x}}', { x: '$&' })).toBe('Match: $&');
    expect(renderTemplate('Dollar: {{x}}', { x: '$$' })).toBe('Dollar: $$');
  });
});
