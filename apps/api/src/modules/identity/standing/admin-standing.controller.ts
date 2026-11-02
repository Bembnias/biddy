// Strike'i, blokady, odwołania i limity od strony personelu (F-61). Do panelu admina z osobną
// sesją (F-34) rola personelu pochodzi ze zwykłej sesji konta, jak przy unieważnianiu ofert.
import {
  accountPolicySchema,
  APPEAL_DECISIONS,
  STAFF_STRIKE_REASONS,
  STRIKE_ROLES,
  userLimitsOverrideSchema,
} from '@biddy/shared';
import { Body, Controller, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { AccountBlockRow, StrikeRow } from '../db/standing.schema.js';
import { CurrentUser, RequireStaff } from '../session/session.guard.js';
import type { AuthenticatedUser } from '../session/session.js';
import { AccountPolicyService } from './account-policy.service.js';
import { AccountStandingService } from './account-standing.service.js';
import {
  blockDto,
  blockSchema,
  MyStandingDto,
  standingDto,
  strikeDto,
  strikeSchema,
} from './standing-dto.js';
import { StandingIdParams, standingId } from './standing.controller.js';
import { StrikeService } from './strike.service.js';

const staffNote = (label: string) =>
  z.string().trim().min(5, `${label}: co najmniej 5 znaków.`).max(1000);

const adminStrikeSchema = strikeSchema.extend({
  userId: z.uuid(),
  issuedBy: z.uuid().nullable().describe('Personel; null = system'),
  note: z.string().min(1).nullable().describe('Notatka wewnętrzna personelu'),
  revokedBy: z.uuid().nullable(),
});

const adminBlockSchema = blockSchema.extend({
  userId: z.uuid(),
  liftedBy: z.uuid().nullable(),
});

export class AdminStrikeDto extends createZodDto(adminStrikeSchema) {}
export class AdminAccountBlockDto extends createZodDto(adminBlockSchema) {}

export class AdminUserStandingDto extends createZodDto(
  MyStandingDto.schema.extend({
    limitsOverride: userLimitsOverrideSchema.nullable(),
    strikes: z.object({
      windowDays: z.int(),
      blockDays: z.int(),
      threshold: z.int(),
      buyer: z.int(),
      seller: z.int(),
      items: z.array(adminStrikeSchema),
    }),
    blocks: z.array(adminBlockSchema),
  }),
) {}

export class AdminAppealsDto extends createZodDto(
  z.object({
    strikes: z.array(adminStrikeSchema).describe("Odwołania od strike'ów, najstarsze pierwsze"),
    blocks: z.array(adminBlockSchema).describe('Odwołania od blokad, najstarsze pierwsze'),
  }),
) {}

export class IssueStrikeDto extends createZodDto(
  z
    .object({
      userId: z.uuid(),
      reason: z
        .enum(STAFF_STRIKE_REASONS)
        .describe('COUNTERFEIT blokuje od razu wystawianie i wypłaty'),
      role: z.enum(STRIKE_ROLES).optional().describe('Wymagana przy OTHER'),
      note: staffNote('Uzasadnienie').describe('Dopisywane do uzasadnienia dla użytkownika'),
      orderId: z.uuid().optional(),
      auctionId: z.uuid().optional(),
    })
    .strict()
    .refine((value) => value.reason !== 'OTHER' || value.role !== undefined, {
      path: ['role'],
      message: 'Przy powodzie OTHER wskaż rolę (BUYER albo SELLER).',
    }),
) {}

export class StaffNoteDto extends createZodDto(
  z.object({ note: staffNote('Uzasadnienie').describe('Widoczne dla użytkownika') }).strict(),
) {}

export class AppealDecisionDto extends createZodDto(
  z
    .object({
      decision: z.enum(APPEAL_DECISIONS),
      note: staffNote('Uzasadnienie').describe('Widoczne dla użytkownika'),
    })
    .strict(),
) {}

export class AccountPolicyDto extends createZodDto(
  z.object({
    policy: accountPolicySchema,
    id: z.uuid().nullable().describe('null = wartości domyślne'),
    createdAt: z.iso.datetime().nullable(),
    createdBy: z.uuid().nullable(),
    note: z.string().min(1).nullable(),
  }),
) {}

export class PublishAccountPolicyDto extends createZodDto(
  z
    .object({
      policy: accountPolicySchema,
      note: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
) {}

export class UserLimitsDto extends createZodDto(
  z
    .object({ limits: userLimitsOverrideSchema.nullable().describe('null usuwa nadpisania') })
    .strict(),
) {}

class UserIdParams extends createZodDto(z.object({ id: z.uuid() })) {}

function adminStrike(row: StrikeRow, window: number): AdminStrikeDto {
  return {
    ...strikeDto(row, window),
    userId: row.userId,
    issuedBy: row.issuedBy,
    note: row.note,
    revokedBy: row.revokedBy,
  };
}

function adminBlock(row: AccountBlockRow, window: number): AdminAccountBlockDto {
  return { ...blockDto(row, window), userId: row.userId, liftedBy: row.liftedBy };
}

@ApiTags('admin')
@Controller('admin')
@RequireStaff('support', 'moderator', 'admin')
export class AdminStandingController {
  constructor(
    private readonly standing: AccountStandingService,
    private readonly strikes: StrikeService,
    private readonly policies: AccountPolicyService,
  ) {}

  private async appealWindow(): Promise<number> {
    return (await this.policies.current()).strikes.appealWindowDays;
  }

  @Get('account-policy')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: "Obowiązująca polityka kont (limity i reguły strike'ów)" })
  @ZodResponse({ status: 200, description: 'Polityka', type: AccountPolicyDto })
  async getAccountPolicy(): Promise<AccountPolicyDto> {
    return versionDto(await this.policies.currentVersion());
  }

  @Put('account-policy')
  @RequireStaff('admin')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Nowa wersja polityki kont',
    description: 'Działa w każdym procesie najpóźniej po 30 s, bez deployu.',
  })
  @ZodResponse({ status: 200, description: 'Zapisana polityka', type: AccountPolicyDto })
  async publishAccountPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PublishAccountPolicyDto,
  ): Promise<AccountPolicyDto> {
    return versionDto(await this.policies.publish(body.policy, user.id, body.note));
  }

  @Put('users/:id/limits')
  @RequireStaff('support', 'admin')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Nadpisania limitów użytkownika (`users.limits`)' })
  @ZodResponse({ status: 200, description: 'Stan konta po zmianie', type: AdminUserStandingDto })
  async setUserLimits(
    @Param() params: UserIdParams,
    @Body() body: UserLimitsDto,
  ): Promise<AdminUserStandingDto> {
    await this.standing.setOverride(params.id, body.limits);
    return this.userStanding(params.id);
  }

  @Get('users/:id/standing')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: "Poziomy, limity, nadpisania, strike'i i blokady użytkownika" })
  @ZodResponse({ status: 200, description: 'Stan konta', type: AdminUserStandingDto })
  async getUserStanding(@Param() params: UserIdParams): Promise<AdminUserStandingDto> {
    return this.userStanding(params.id);
  }

  @Get('appeals')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Odwołania w toku (najstarsze pierwsze)' })
  @ZodResponse({ status: 200, description: 'Odwołania', type: AdminAppealsDto })
  async listAppeals(): Promise<AdminAppealsDto> {
    const [pending, window] = await Promise.all([
      this.strikes.pendingAppeals(),
      this.appealWindow(),
    ]);
    return {
      strikes: pending.strikes.map((row) => adminStrike(row, window)),
      blocks: pending.blocks.map((row) => adminBlock(row, window)),
    };
  }

  @Post('strikes')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Strike nadany przez personel',
    description: 'COUNTERFEIT (podróbka) albo OTHER z rolą; ocenia blokadę jak strike systemowy.',
  })
  @ZodResponse({ status: 201, description: 'Nadany strike', type: AdminStrikeDto })
  async issueStrike(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: IssueStrikeDto,
  ): Promise<AdminStrikeDto> {
    const issued = await this.strikes.issueByStaff(user.id, {
      userId: body.userId,
      reason: body.reason,
      ...(body.role === undefined ? {} : { role: body.role }),
      note: body.note,
      ...(body.orderId === undefined ? {} : { orderId: body.orderId }),
      ...(body.auctionId === undefined ? {} : { auctionId: body.auctionId }),
    });
    return adminStrike(issued.strike, await this.appealWindow());
  }

  @Post('strikes/:id/revoke')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: "Cofnięcie strike'a",
    description: 'Zdejmuje blokady, które ten strike wywołał. Cofnięty strike zwraca bez zmian.',
  })
  @ZodResponse({ status: 200, description: 'Cofnięty strike', type: AdminStrikeDto })
  async revokeStrike(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: StaffNoteDto,
  ): Promise<AdminStrikeDto> {
    const row = await this.strikes.revokeByStaff(
      user.id,
      standingId(params, 'STRIKE_NOT_FOUND'),
      body.note,
    );
    return adminStrike(row, await this.appealWindow());
  }

  @Post('strikes/:id/appeal-decision')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: "Decyzja w odwołaniu od strike'a",
    description:
      'ACCEPTED cofa strike razem z blokadami; bez odwołania w toku 409 APPEAL_NOT_PENDING.',
  })
  @ZodResponse({ status: 200, description: 'Strike po decyzji', type: AdminStrikeDto })
  async decideStrikeAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: AppealDecisionDto,
  ): Promise<AdminStrikeDto> {
    const row = await this.strikes.decideStrikeAppeal(
      user.id,
      standingId(params, 'STRIKE_NOT_FOUND'),
      body.decision,
      body.note,
    );
    return adminStrike(row, await this.appealWindow());
  }

  @Post('account-blocks/:id/lift')
  @RequireStaff('moderator', 'admin')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Zdjęcie blokady konta', description: "Strike'i zostają." })
  @ZodResponse({ status: 200, description: 'Zdjęta blokada', type: AdminAccountBlockDto })
  async liftAccountBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: StaffNoteDto,
  ): Promise<AdminAccountBlockDto> {
    const row = await this.strikes.liftByStaff(
      user.id,
      standingId(params, 'ACCOUNT_BLOCK_NOT_FOUND'),
      body.note,
    );
    return adminBlock(row, await this.appealWindow());
  }

  @Post('account-blocks/:id/appeal-decision')
  @RequireStaff('moderator', 'admin')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Decyzja w odwołaniu od blokady',
    description: 'ACCEPTED zdejmuje blokadę; bez odwołania w toku 409 APPEAL_NOT_PENDING.',
  })
  @ZodResponse({ status: 200, description: 'Blokada po decyzji', type: AdminAccountBlockDto })
  async decideAccountBlockAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: AppealDecisionDto,
  ): Promise<AdminAccountBlockDto> {
    const row = await this.strikes.decideBlockAppeal(
      user.id,
      standingId(params, 'ACCOUNT_BLOCK_NOT_FOUND'),
      body.decision,
      body.note,
    );
    return adminBlock(row, await this.appealWindow());
  }

  private async userStanding(userId: string): Promise<AdminUserStandingDto> {
    const overview = await this.standing.overview(userId);
    const window = overview.policy.strikes.appealWindowDays;
    const base = standingDto(overview);
    return {
      ...base,
      limitsOverride: overview.override,
      strikes: {
        ...base.strikes,
        items: overview.strikes.map((row) => adminStrike(row, window)),
      },
      blocks: overview.blocks.map((row) => adminBlock(row, window)),
    };
  }
}

function versionDto(version: Awaited<ReturnType<AccountPolicyService['currentVersion']>>) {
  return {
    policy: version.policy,
    id: version.id,
    createdAt: version.createdAt?.toISOString() ?? null,
    createdBy: version.createdBy,
    note: version.note,
  };
}
