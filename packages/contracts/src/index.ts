/**
 * Public API of `@neulander/contracts` (ADR-0002, CLAUDE.md rule 3: "Contratos primeiro").
 * Every payload shared between API, web, mobile and the edge-agent is meant to live here as
 * a Zod schema — API, web and mobile import only from this barrel, never a deep path.
 */
export { type DomainEvent, DomainEventSchema } from "./events";
export {
  type GlobalRole,
  GlobalRoleSchema,
  type LoginInput,
  LoginInputSchema,
  type Me,
  type Membership,
  MembershipSchema,
  MeSchema,
  type OrganizationRole,
  OrganizationRoleSchema,
  type RegisterInput,
  RegisterInputSchema,
  type TokenPair,
  TokenPairSchema,
} from "./identity";
export { addCents, type Cents, CentsSchema, isCents, subtractCents, toCents, ZERO_CENTS } from "./money";
