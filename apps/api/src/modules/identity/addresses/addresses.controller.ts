import { POSTAL_CODE_MESSAGE, normalizePostalCode } from '@biddy/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ADDRESS_COUNTRIES, type Address } from '../db/identity.schema.js';
import { PHONE_NUMBER_HINT, normalizePhoneNumber } from '../phone/phone-number.js';
import { CurrentUser, RequireSession } from '../session/session.guard.js';
import type { AuthenticatedUser } from '../session/session.js';
import { AddressService, MAX_ADDRESSES } from './address.service.js';

function text(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${label}: co najmniej ${min} znaki.`)
    .max(max, `${label}: najwyżej ${max} znaków.`);
}

const addressFields = {
  recipientName: text('Odbiorca', 2, 100).describe('Imię i nazwisko albo nazwa firmy'),
  street: text('Ulica', 2, 100).describe('Ulica z numerem domu i lokalu'),
  postalCode: z
    .string()
    .max(10)
    .refine((value) => normalizePostalCode(value) !== undefined, POSTAL_CODE_MESSAGE)
    .describe('Kod pocztowy NN-NNN (przyjmuje też NNNNN)'),
  city: text('Miasto', 2, 60),
  phone: z
    .string()
    .max(32)
    .refine((value) => normalizePhoneNumber(value) !== undefined, PHONE_NUMBER_HINT)
    .describe('Telefon odbiorcy dla przewoźnika (polski numer komórkowy)'),
};

export class CreateAddressDto extends createZodDto(
  z.object({
    ...addressFields,
    isDefault: z.boolean().optional().describe('Domyślny adres dostawy'),
    isSenderDefault: z.boolean().optional().describe('Domyślny adres nadania'),
  }),
) {}

export class UpdateAddressDto extends createZodDto(
  z.object({
    recipientName: addressFields.recipientName.optional(),
    street: addressFields.street.optional(),
    postalCode: addressFields.postalCode.optional(),
    city: addressFields.city.optional(),
    phone: addressFields.phone.optional(),
    isDefault: z
      .literal(true)
      .optional()
      .describe('Ustawia adres jako domyślny do dostawy (poprzedni traci flagę)'),
    isSenderDefault: z
      .literal(true)
      .optional()
      .describe('Ustawia adres jako domyślny do nadania (poprzedni traci flagę)'),
  }),
) {}

export class AddressDto extends createZodDto(
  z.object({
    id: z.uuid(),
    recipientName: z.string(),
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.enum(ADDRESS_COUNTRIES),
    phone: z.e164(),
    isDefault: z.boolean().describe('Domyślny adres dostawy'),
    isSenderDefault: z.boolean().describe('Domyślny adres nadania'),
    createdAt: z.iso.datetime(),
  }),
) {}

class AddressIdParams extends createZodDto(z.object({ id: z.uuid() })) {}

function toDto(address: Address): AddressDto {
  return {
    id: address.id,
    recipientName: address.recipientName,
    street: address.street,
    postalCode: address.postalCode,
    city: address.city,
    country: address.country,
    phone: address.phone,
    isDefault: address.isDefault,
    isSenderDefault: address.isSenderDefault,
    createdAt: address.createdAt.toISOString(),
  };
}

/** Adresy dostawy i nadania zalogowanego użytkownika (F-10). Cudzy adres to 404. */
@ApiTags('me')
@Controller('me/addresses')
@RequireSession()
export class AddressesController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Adresy zalogowanego użytkownika' })
  @ZodResponse({ status: 200, description: 'Adresy (najpierw domyślny)', type: [AddressDto] })
  async getMyAddresses(@CurrentUser() user: AuthenticatedUser): Promise<AddressDto[]> {
    return (await this.addresses.list(user.id)).map(toDto);
  }

  @Post()
  @ApiOperation({
    summary: 'Nowy adres',
    description: `Pierwszy adres staje się domyślny do dostawy i nadania. Najwyżej ${MAX_ADDRESSES} adresów (409 ADDRESS_LIMIT_REACHED).`,
  })
  @ZodResponse({ status: 201, description: 'Zapisany adres', type: AddressDto })
  async createAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddressDto,
  ): Promise<AddressDto> {
    return toDto(await this.addresses.create(user.id, body));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Zmiana adresu albo ustawienie go jako domyślnego' })
  @ZodResponse({ status: 200, description: 'Zmieniony adres', type: AddressDto })
  async updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AddressIdParams,
    @Body() body: UpdateAddressDto,
  ): Promise<AddressDto> {
    return toDto(await this.addresses.update(user.id, params.id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Usunięcie adresu',
    description: 'Usunięcie domyślnego adresu nie wybiera nowego domyślnego.',
  })
  @ApiNoContentResponse({ description: 'Adres usunięty' })
  async deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AddressIdParams,
  ): Promise<void> {
    await this.addresses.delete(user.id, params.id);
  }
}
