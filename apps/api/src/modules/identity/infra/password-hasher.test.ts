import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service";
import { PasswordHasher } from "./password-hasher";

/** Only `.passwordPepper` is ever read by `PasswordHasher` — a plain object stand-in avoids
 * wiring up the real `ConfigService`/`ConfigModule` for a unit test that has nothing to do
 * with env loading. */
function fakeAppConfig(passwordPepper: string): AppConfigService {
  return { passwordPepper } as AppConfigService;
}

describe("PasswordHasher", () => {
  it("hashes with argon2id and the cost parameters pinned in ARGON2_COST (security review, ULTRAPLAN 1.3)", async () => {
    const hasher = new PasswordHasher(fakeAppConfig("a-pepper-at-least-32-chars-long!"));

    const hash = await hasher.hash("correct horse battery staple");

    // `m=65536,p=4,t=3` mirrors ARGON2_COST — pinned explicitly so a library upgrade can't
    // silently weaken every new hash without a test noticing.
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
  });

  it("round-trips: a hash verifies against its own password and pepper, and rejects the wrong password", async () => {
    const hasher = new PasswordHasher(fakeAppConfig("a-pepper-at-least-32-chars-long!"));
    const hash = await hasher.hash("correct horse battery staple");

    await expect(hasher.verify(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(hasher.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("rejects verification against the same hash with a different pepper", async () => {
    const hasher = new PasswordHasher(fakeAppConfig("a-pepper-at-least-32-chars-long!"));
    const hash = await hasher.hash("correct horse battery staple");

    const differentPepperHasher = new PasswordHasher(fakeAppConfig("a-completely-different-pepper!!"));

    await expect(differentPepperHasher.verify(hash, "correct horse battery staple")).resolves.toBe(
      false,
    );
  });
});
