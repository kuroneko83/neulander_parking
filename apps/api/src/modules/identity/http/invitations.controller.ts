import { Body, Controller, Get, HttpStatus, Param, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AcceptInvitationInputSchema,
  type InvitationPreview,
  InvitationPreviewSchema,
  TokenPairSchema,
} from "@neulander/contracts";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";

import { AppConfigService } from "../../../config/app-config.service";
import { AcceptInvitationUseCase } from "../application/accept-invitation.use-case";
import { GetInvitationUseCase } from "../application/get-invitation.use-case";

class AcceptInvitationDto extends createZodDto(AcceptInvitationInputSchema) {}

/** Same cookie AuthController's login/refresh set (ADR-0004) — a new account created via
 * `accept` is, from the browser's perspective, an ordinary login, so the web client gets
 * its refresh token the exact same way. Duplicated here (rather than importing
 * `AuthController`'s private constant) because `AuthController` doesn't export it — see
 * that file; not worth a shared-helper refactor for two call sites. */
const REFRESH_TOKEN_COOKIE = "refresh_token";

/**
 * `GET /v1/invitations/:token` and `POST /v1/invitations/:token/accept` (both public — ADR
 * per api-and-events.md: no `JwtAuthGuard` on either, the token itself IS the credential).
 */
@ApiTags("invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(
    private readonly getInvitationUseCase: GetInvitationUseCase,
    private readonly acceptInvitationUseCase: AcceptInvitationUseCase,
    private readonly appConfig: AppConfigService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "Dados para a tela de aceite de convite (público)" })
  async getInvitation(@Param("token") token: string): Promise<InvitationPreview> {
    const preview = await this.getInvitationUseCase.execute(token);
    return InvitationPreviewSchema.parse(preview);
  }

  /**
   * `@Res()` WITHOUT `passthrough: true` (unlike `AuthController.login`/`refresh`,
   * ULTRAPLAN 1.3): this handler's status code varies per outcome (`201` new account /
   * `204` joined-or-replayed — api-and-events.md), which a single static `@HttpCode()`
   * decorator can't express. With `passthrough` off, Nest skips its own automatic
   * "apply the handler's return value with `getStatusByMethod`'s default status" step
   * entirely (`RouterResponseController`/`ExpressAdapter.reply()` — the framework's default
   * for POST is `201`, which would silently override a manual `res.status(204)` if
   * `passthrough` were left on) — this handler is fully responsible for ending the
   * response itself.
   */
  @Post(":token/accept")
  @ApiOperation({ summary: "Aceita um convite — cria conta se necessário (público)" })
  async accept(
    @Param("token") token: string,
    @Body() body: AcceptInvitationDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.acceptInvitationUseCase.execute(token, body);

    if (result.status === 204) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    res.cookie(REFRESH_TOKEN_COOKIE, result.tokenPair.refreshToken, {
      httpOnly: true,
      secure: this.appConfig.isProduction,
      sameSite: "strict",
      maxAge: this.appConfig.jwtRefreshTtlDays * 24 * 60 * 60 * 1000,
      path: "/v1/auth",
    });
    res.status(HttpStatus.CREATED).json(TokenPairSchema.parse(result.tokenPair));
  }
}
