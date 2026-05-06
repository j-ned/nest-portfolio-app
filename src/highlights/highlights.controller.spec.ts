import { Test, TestingModule } from '@nestjs/testing';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';

describe('HighlightsController (with :section param)', () => {
  let controller: HighlightsController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HighlightsController],
      providers: [{ provide: HighlightsService, useValue: service }],
    }).compile();
    controller = module.get(HighlightsController);
  });

  it('findAll forwards "profile" to the service', async () => {
    service.findAll.mockResolvedValue([]);
    await controller.findAll('profile');
    expect(service.findAll).toHaveBeenCalledWith('profile');
  });

  it('findAll forwards "home" to the service', async () => {
    service.findAll.mockResolvedValue([]);
    await controller.findAll('home');
    expect(service.findAll).toHaveBeenCalledWith('home');
  });

  it('findOne forwards section + id to the service', async () => {
    service.findOne.mockResolvedValue({ id: 'h1' });
    await controller.findOne('home', 'h1');
    expect(service.findOne).toHaveBeenCalledWith('h1', 'home');
  });

  it('create forwards section + dto to the service', async () => {
    const dto = { title: 't', description: 'd', icon: 'i', order: 0 } as never;
    service.create.mockResolvedValue({ id: 'h1' });
    await controller.create('profile', dto);
    expect(service.create).toHaveBeenCalledWith(dto, 'profile');
  });

  it('update forwards section + id + dto to the service', async () => {
    const dto = { title: 't' } as never;
    service.update.mockResolvedValue({ id: 'h1' });
    await controller.update('home', 'h1', dto);
    expect(service.update).toHaveBeenCalledWith('h1', dto, 'home');
  });

  it('remove forwards section + id to the service', async () => {
    service.remove.mockResolvedValue(undefined);
    await controller.remove('profile', 'h1');
    expect(service.remove).toHaveBeenCalledWith('h1', 'profile');
  });
});
