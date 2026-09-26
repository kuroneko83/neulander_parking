import { createHmac, generateKeyPairSync } from "node:crypto";

import { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service";
import type { AccessTokenClaims } from "../domain/access-token-claims";
import { JwtTokenService } from "./jwt-token.service";

const CLAIMS: AccessTokenClaims = {
  sub: "user-1",
  roleGlobal: "driver",
  roles: [{ organizationId: "org-1", role: "manager", parkingLotIds: [] }],
};

function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

function fakeAppConfig(keys: { privateKey: string; publicKey: string }): AppConfigService {
  return {
    jwtAccessPrivateKey: keys.privateKey,
    jwtAccessPublicKey: keys.publicKey,
    jwtAccessTtl: "15m",
  } as AppConfigService;
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** Crafts a JWT by hand (no `jsonwebtoken` import — it's a transitive dependency of
 * `@nestjs/jwt`, not resolvable directly under pnpm's strict `node_modules` layout, and
 * adding it as a direct dependency just for two attack-simulation tokens isn't justified).
 * `signingInput` is `base64url(header).base64url(payload)`; `signature` is whatever the
 * attack scenario needs (HMAC'd with the RSA public key, or empty for `alg: none`). */
function craftToken(header: object, payload: object, signature: string): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${signingInput}.${signature}`;
}

describe("JwtTokenService", () => {
  it("round-trips: verify() decodes exactly what sign() produced", () => {
    const service = new JwtTokenService(new JwtService(), fakeAppConfig(generateRsaKeyPair()));

    const token = service.sign(CLAIMS);
    const decoded = service.verify(token);

    expect(decoded).toEqual(CLAIMS);
  });

  it("rejects a token signed by a DIFFERENT RSA keypair (signature doesn't match)", () => {
    const service = new JwtTokenService(new JwtService(), fakeAppConfig(generateRsaKeyPair()));
    const otherKeys = generateRsaKeyPair();
    const foreignService = new JwtTokenService(new JwtService(), fakeAppConfig(otherKeys));

    const tokenFromForeignKey = foreignService.sign(CLAIMS);

    expect(() => service.verify(tokenFromForeignKey)).toThrow();
  });

  it("rejects an expired token", () => {
    const keys = generateRsaKeyPair();
    const service = new JwtTokenService(new JwtService(), {
      jwtAccessPrivateKey: keys.privateKey,
      jwtAccessPublicKey: keys.publicKey,
      jwtAccessTtl: "-1s",
    } as AppConfigService);

    const alreadyExpiredToken = service.sign(CLAIMS);

    expect(() => service.verify(alreadyExpiredToken)).toThrow();
  });

  // Security-review requirement (ULTRAPLAN 1.3, applied in ULTRAPLAN 1.4's `verify()`):
  // `algorithms: ["RS256"]` must be pinned explicitly, never inferred from the token's own
  // (attacker-controlled) `alg` header. These two tests simulate the classic JWT attacks
  // that pinning defends against — without it, a real vulnerability class.
  it("rejects an algorithm-confusion attack (HS256-signed using the RS256 PUBLIC key as an HMAC secret)", () => {
    const keys = generateRsaKeyPair();
    const service = new JwtTokenService(new JwtService(), fakeAppConfig(keys));

    const header = { alg: "HS256", typ: "JWT" };
    const payload = { ...CLAIMS, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    // The attack: an RS256 public key is public by design, so anyone can read it from a
    // legitimate token's verification side — the exploit is using it as if it were the
    // HMAC *secret* for HS256, since a naive verifier that trusts the token's own `alg`
    // header would happily switch from `jwt.verify(token, publicKey, {algorithm: "RS256"})`
    // to `jwt.verify(token, publicKey, {algorithm: "HS256"})` and succeed.
    const forgedSignature = createHmac("sha256", keys.publicKey).update(signingInput).digest("base64url");
    const forgedToken = craftToken(header, payload, forgedSignature);

    expect(() => service.verify(forgedToken)).toThrow();
  });

  it('rejects an "alg: none" (unsigned) token', () => {
    const service = new JwtTokenService(new JwtService(), fakeAppConfig(generateRsaKeyPair()));

    const header = { alg: "none", typ: "JWT" };
    const payload = { ...CLAIMS, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 };
    const unsignedToken = craftToken(header, payload, "");

    expect(() => service.verify(unsignedToken)).toThrow();
  });
});
