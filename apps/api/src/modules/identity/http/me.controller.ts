import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Me } from "@neulander/contracts";
import { MeSchema } from "@neulander/contracts";

import { GetMeUseCase } from "../application/get-me.use-case";
import type { AuthenticatedRequest } from "./guards/authenticated-request";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

/**
 * `GET /v1/me` (ULTRAPLAN 1.4, `JwtAuthGuard`-only — see `GetMeUseCase`'s doc comment for
 * why it reads fresh from the database instead of returning `request.user`'s JWT claims
 * directly). A separate controller/route prefix from `AuthController` (`/v1/me`, not
 * `/v1/auth/me`) matching `api-and-events.md`'s own path for this endpoint exactly.
 */
@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(private readonly getMeUseCase: GetMeUseCase) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Perfil + memberships do usuário autenticado" })
  async me(@Req() req: AuthenticatedRequest): Promise<Me> {
    const me = await this.getMeUseCase.execute(req.user.sub);
    return MeSchema.parse(me);
  }
}
