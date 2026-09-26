import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CreateInvitationInputSchema,
  type InvitationView,
  InvitationViewSchema,
} from "@neulander/contracts";
import { createZodDto } from "nestjs-zod";

import { InviteMemberUseCase } from "../application/invite-member.use-case";
import type { AuthenticatedRequest } from "./guards/authenticated-request";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { OrgScopeGuard } from "./guards/org-scope.guard";
import { Roles } from "./guards/roles.decorator";
import { RolesGuard } from "./guards/roles.guard";

class CreateInvitationDto extends createZodDto(CreateInvitationInputSchema) {}

/**
 * `POST /v1/orgs/:orgId/members` (ULTRAPLAN 1.5, api-and-events.md: "owner, manager |
 * Convida operador/gestor por e-mail"). Guard order matters (`OrgScopeGuard` needs
 * `request.user` from `JwtAuthGuard`; `RolesGuard` needs `request.membership` from
 * `OrgScopeGuard`) — same order every other `/v1/orgs/:orgId/...` route uses.
 *
 * `req.membership.role` (set by `OrgScopeGuard`) is the caller's role IN THIS organization —
 * exactly what `InviteMemberUseCase`'s role-escalation check (`canInviteRole`) needs as
 * `invitedByRole`. Never trusts `req.user.roleGlobal` for that decision: a `platform_admin`
 * calling this endpoint (technically allowed through by `RolesGuard`'s "OR global role"
 * check, though nothing in this task's scope has one actually calling it) still needs a real
 * membership in `:orgId` to even reach here (`OrgScopeGuard`'s first check), so
 * `req.membership` is always defined by this point regardless.
 */
@ApiTags("members")
@Controller("orgs/:orgId/members")
export class MembersController {
  constructor(private readonly inviteMemberUseCase: InviteMemberUseCase) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, OrgScopeGuard, RolesGuard)
  @Roles("owner", "manager")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Convida um novo membro (operador/gestor) por e-mail" })
  async invite(
    @Param("orgId") orgId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateInvitationDto,
  ): Promise<InvitationView> {
    // `req.membership` is set by `OrgScopeGuard`, which runs before this handler — its
    // static type (`AuthenticatedRequest.membership?`) is optional only because a
    // `JwtAuthGuard`-only route (no `OrgScopeGuard`) never sets it; this route always has
    // both guards, so it's always defined here in practice (see the class doc comment).
    const invitedByRole = req.membership?.role;
    if (!invitedByRole) {
      throw new Error("MembersController.invite chamado sem OrgScopeGuard ter rodado antes.");
    }

    const result = await this.inviteMemberUseCase.execute({
      organizationId: orgId,
      invitedByUserId: req.user.sub,
      invitedByRole,
      input: body,
    });

    return InvitationViewSchema.parse(result);
  }
}
