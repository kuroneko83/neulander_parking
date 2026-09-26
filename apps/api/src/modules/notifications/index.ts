/**
 * Public API of the `notifications` module (ULTRAPLAN 1.5, CLAUDE.md rule 1). Exports ONLY
 * the module itself — no port token, no adapter, no event handler. Every other module
 * reacts to `notifications`' effects (an e-mail/WhatsApp message getting sent) exclusively
 * by producing the domain event this module already consumes (system-design.md: "envio de
 * e-mail/WhatsApp só por esse caminho — nenhum módulo injeta o canal de mensagens de
 * `notifications` direto"); there is deliberately nothing else here for another module to
 * reach for.
 */
export { NotificationsModule } from "./notifications.module";
