import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  LoginInputSchema,
  RefreshInputSchema,
  RegisterInputSchema,
  type TokenPair,
  TokenPairSchema,
} from "@neulander/contracts";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";

import { AppConfigService } from "../../../config/app-config.service";
import { LoginUseCase } from "../application/login.use-case";
import { LogoutUseCase } from "../application/logout.use-case";
import { RefreshTokenUseCase } from "../application/refresh-token.use-case";
import type { RegisterUserResult } from "../application/register-user.use-case";
import { RegisterUserUseCase } from "../application/register-user.use-case";
import { RefreshTokenInvalidError } from "../domain/auth-errors";
import type { AuthenticatedRequest } from "./guards/authenticated-request";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

class RegisterDto extends createZodDto(RegisterInputSchema) {}
class LoginDto extends createZodDto(LoginInputSchema) {}
class RefreshDto extends createZodDto(RefreshInputSchema) {}
// Same optional-`refreshToken` shape `refresh` validates against — `logout` accepts the
// token the exact same two ways (cookie for web, body for mobile), so it reuses the
// contract rather than declaring an identical one under a new name.
class LogoutDto extends createZodDto(RefreshInputSchema) {}

/** Name of the `HttpOnly` cookie the web client relies on (ADR-0004: "web usa cookie
 * `HttpOnly` pro refresh"). Scoped to `path: "/v1/auth"` — the only routes that ever need
 * to read it back — so it isn't sent on every unrelated request to the API. */
const REFRESH_TOKEN_COOKIE = "refresh_token";

/** Minimal `Cookie` header parser — reads exactly the one cookie this controller cares
 * about. Not `cookie-parser`: that middleware exists to populate `req.cookies` for
 * anything that wants ANY cookie, which nothing in this codebase does yet outside this one
 * read; pulling in a whole extra dependency (plus its `@types` package) for a single
 * `name=value` lookup isn't justified. `res.cookie()` (used below to SET the cookie) is
 * plain Express and needs no such middleware either way. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}

/** Same body-then-cookie fallback `refresh` and `logout` both need — reads whichever the
 * caller presented (web: cookie only; mobile: body only), or `undefined` if neither did. */
function extractPresentedRefreshToken(
  bodyToken: string | undefined,
  req: Request,
): string | undefined {
  return bodyToken ?? readCookie(req.headers.cookie, REFRESH_TOKEN_COOKIE);
}

/**
 * `/v1/auth/*` — register/login/refresh (ULTRAPLAN 1.3) are public per `api-and-events.md`'s
 * "Auth & identidade" table; `logout` (ULTRAPLAN 1.4) requires `JwtAuthGuard`. `GET /v1/me`
 * lives in `MeController` instead — a different route prefix (`/v1/me`, not `/v1/auth/me`).
 *
 * Decision on `TokenPair`'s wire shape (`packages/contracts` deliberately leaves this to
 * the controller): `login`/`refresh` always return BOTH `accessToken` and `refreshToken`
 * in the JSON body — matching `TokenPairSchema`'s two required fields exactly — AND set the
 * same refresh token as an `HttpOnly` cookie. This serves both ADR-0004 clients from one
 * response shape instead of branching on a client-type header/query param the task never
 * asked for: mobile (SecureStore) reads `refreshToken` straight from the body; a web
 * client can ignore that field entirely and rely solely on the cookie the browser already
 * attached automatically. It also keeps `test/identity/auth.int.test.ts` simple — the
 * refresh token is always decodable from the response body, cookie or not.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly appConfig: AppConfigService,
  ) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Cadastro de motorista (público)" })
  register(@Body() body: RegisterDto): Promise<RegisterUserResult> {
    return this.registerUserUseCase.execute(body);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login — retorna access + refresh token" })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair> {
    const tokenPair = await this.loginUseCase.execute(body);
    this.setRefreshCookie(res, tokenPair.refreshToken);
    return TokenPairSchema.parse(tokenPair);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotação de refresh token" })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair> {
    const presentedToken = extractPresentedRefreshToken(body.refreshToken, req);
    if (!presentedToken) {
      // No token in the body AND no cookie — same error a real-but-unknown token would
      // get (never distinguish "missing" from "invalid" here; both mean "not
      // authenticated", and there's nothing useful a caller could do differently either
      // way).
      throw new RefreshTokenInvalidError();
    }

    const tokenPair = await this.refreshTokenUseCase.execute(presentedToken);
    this.setRefreshCookie(res, tokenPair.refreshToken);
    return TokenPairSchema.parse(tokenPair);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoga a família de refresh da sessão atual (autenticado)" })
  async logout(
    @Body() body: LogoutDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const presentedToken = extractPresentedRefreshToken(body.refreshToken, req);
    await this.logoutUseCase.execute(req.user.sub, presentedToken);
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/v1/auth" });
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.appConfig.isProduction,
      sameSite: "strict",
      maxAge: this.appConfig.jwtRefreshTtlDays * 24 * 60 * 60 * 1000,
      path: "/v1/auth",
    });
  }
}
