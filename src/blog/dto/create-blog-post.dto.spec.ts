import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBlogPostDto } from './create-blog-post.dto';

describe('CreateBlogPostDto', () => {
  it('rejette un titre vide', async () => {
    const dto = plainToInstance(CreateBlogPostDto, {
      title: '',
      excerpt: 'x',
      contentMarkdown: 'x',
      status: 'draft',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('accepte un DTO valide complet', async () => {
    const dto = plainToInstance(CreateBlogPostDto, {
      title: 'Mon article',
      excerpt: 'Résumé',
      contentMarkdown: '# Titre\n\nContenu.',
      tags: ['Angular', 'NestJS'],
      status: 'published',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejette un status invalide', async () => {
    const dto = plainToInstance(CreateBlogPostDto, {
      title: 'x',
      excerpt: 'x',
      contentMarkdown: 'x',
      status: 'archived',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
