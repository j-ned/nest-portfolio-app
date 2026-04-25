import { PartialType } from '@nestjs/swagger';
import { CreateDiplomaDto } from './create-diploma.dto';

export class UpdateDiplomaDto extends PartialType(CreateDiplomaDto) {}
