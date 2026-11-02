// Stan konta użytkownika (F-61): poziomy i limity, strike'i, blokady i odwołania (DSA).
import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { CurrentUser, RequireSession } from '../session/session.guard.js';
import type { AuthenticatedUser } from '../session/session.js';
import { AccountPolicyService } from './account-policy.service.js';
import { AccountStandingService } from './account-standing.service.js';
import {
  AccountBlockDto,
  AppealDto,
  blockDto,
  MyStandingDto,
  MyStrikesDto,
  standingDto,
  StrikeDto,
  strikeDto,
} from './standing-dto.js';
import { StrikeService } from './strike.service.js';

export class StandingIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identyfikator z adresu; inny niż uuid to ten sam 404 co nieistniejący wpis. */
export function standingId(
  params: StandingIdParams,
  code: 'STRIKE_NOT_FOUND' | 'ACCOUNT_BLOCK_NOT_FOUND',
): string {
  if (!UUID.test(params.id)) {
    throw new DomainError({ code });
  }
  return params.id.toLowerCase();
}

@ApiTags('me')
@Controller('me')
@RequireSession()
export class StandingController {
  constructor(
    private readonly standing: AccountStandingService,
    private readonly strikes: StrikeService,
    private readonly policies: AccountPolicyService,
  ) {}

  @Get('standing')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: "Poziomy, limity, blokady i liczniki strike'ów (§4.1)",
    description:
      'Następny poziom z brakującymi warunkami; aktywne blokady licytowania i wystawiania.',
  })
  @ZodResponse({ status: 200, description: 'Stan konta', type: MyStandingDto })
  async getMyStanding(@CurrentUser() user: AuthenticatedUser): Promise<MyStandingDto> {
    return standingDto(await this.standing.overview(user.id));
  }

  @Get('strikes')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: "Strike'i i blokady z uzasadnieniem (ostatnie 2 lata)",
    description:
      'Każdy wpis ma uzasadnienie i stan odwołania; `canAppeal` mówi, czy można się odwołać.',
  })
  @ZodResponse({ status: 200, description: "Strike'i i blokady", type: MyStrikesDto })
  async listMyStrikes(@CurrentUser() user: AuthenticatedUser): Promise<MyStrikesDto> {
    const [history, policy] = await Promise.all([
      this.strikes.history(user.id),
      this.policies.current(),
    ]);
    const window = policy.strikes.appealWindowDays;
    return {
      strikes: history.strikes.map((row) => strikeDto(row, window)),
      blocks: history.blocks.map((row) => blockDto(row, window)),
    };
  }

  @Post('strikes/:id/appeal')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: "Odwołanie od strike'a",
    description:
      'Jedno odwołanie na strike, tylko od niecofniętego i w terminie (409 APPEAL_NOT_ALLOWED).',
  })
  @ZodResponse({ status: 200, description: 'Strike z odwołaniem w toku', type: StrikeDto })
  async appealStrike(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: AppealDto,
  ): Promise<StrikeDto> {
    const [row, policy] = await Promise.all([
      this.strikes.appealStrike(user.id, standingId(params, 'STRIKE_NOT_FOUND'), body.message),
      this.policies.current(),
    ]);
    return strikeDto(row, policy.strikes.appealWindowDays);
  }

  @Post('account-blocks/:id/appeal')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Odwołanie od blokady konta',
    description:
      'Jedno odwołanie na blokadę, tylko od trwającej i w terminie (409 APPEAL_NOT_ALLOWED).',
  })
  @ZodResponse({ status: 200, description: 'Blokada z odwołaniem w toku', type: AccountBlockDto })
  async appealAccountBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: StandingIdParams,
    @Body() body: AppealDto,
  ): Promise<AccountBlockDto> {
    const [row, policy] = await Promise.all([
      this.strikes.appealBlock(
        user.id,
        standingId(params, 'ACCOUNT_BLOCK_NOT_FOUND'),
        body.message,
      ),
      this.policies.current(),
    ]);
    return blockDto(row, policy.strikes.appealWindowDays);
  }
}
