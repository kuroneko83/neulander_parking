import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

import { AppConfigService } from "../../../config/app-config.service";
import type { PasswordHasherPort } from "../application/ports";

/**
 * Argon2id password hashing (ADR-0004: "Senhas com argon2id"), with `PASSWORD_PEPPER`
 * applied as argon2's own `secret` option rather than string-concatenated onto the
 * password before hashing.
 *
 * Decision (ULTRAPLAN 1.3 explicitly leaves the exact pepper mechanism open — "documente a
 * decisão"): `node-argon2`'s `secret` option (see `argon2.d.cts`: `HashOptions.secret?:
 * Buffer`) feeds the pepper into Argon2's native "secret value" input (Argon2 RFC 9106
 * §3.1's `K` parameter) rather than mixing it into the password material by hand. Chosen
 * over `password + pepper` concatenation for two reasons: (1) it's what the library
 * actually designed this option for, so there's no risk of getting the concatenation
 * order/encoding subtly wrong in a way that's hard to notice; (2) a pepper applied this
 * way is authenticated as part of Argon2's own internal construction rather than merely
 * being extra input bytes the hash function treats no differently from the password
 * itself. Same `secret` must be supplied on both `hash()` and `verify()` — it is NOT
 * embedded in the stored digest string the way the salt/params are, so a `PASSWORD_PEPPER`
 * rotation would invalidate every existing hash (same trade-off a hand-concatenated
 * pepper would have; not this task's concern to solve, no pepper-rotation flow exists).
 *
 * `memoryCost`/`timeCost`/`parallelism` are pinned explicitly rather than left to
 * `node-argon2`'s library defaults (security review, ULTRAPLAN 1.3): those defaults
 * currently exceed the OWASP minimum, but leaving them implicit means a minor-version bump
 * could silently weaken every new password hash with nothing noticing. `ARGON2_COST`
 * documents and freezes today's actual defaults (64 MiB / t=3 / p=4) as an explicit,
 * tested constant instead.
 */
const ARGON2_COST = {
  memoryCost: 1 << 16, // 65536 KiB = 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class PasswordHasher implements PasswordHasherPort {
  constructor(private readonly appConfig: AppConfigService) {}

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      secret: this.pepper(),
      ...ARGON2_COST,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password, { secret: this.pepper() });
  }

  private pepper(): Buffer {
    return Buffer.from(this.appConfig.passwordPepper, "utf8");
  }
}
