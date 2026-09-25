/**
 * Camada mínima de i18n (ULTRAPLAN 0.7 — persona web-engineer: "texto de UI em
 * pt-BR através de uma camada simples de `t()`, pronta pra `en` depois").
 *
 * Não há troca de idioma nesta tarefa — só a estrutura (locale fixo em "pt-BR",
 * dicionário por idioma, fallback para pt-BR em chave ausente) para que adicionar
 * `en` mais tarde seja preencher `dictionaries.en`, não reescrever chamadas de `t()`.
 */

export type Locale = "pt-BR" | "en";

const DEFAULT_LOCALE: Locale = "pt-BR";

const ptBR = {
  "app.title": "Neulander Parking",
  "nav.title": "Navegação",
  "nav.dashboard": "Painel",
  "nav.toggleDrawer": "Alternar menu de navegação",
  "theme.toggleToDark": "Ativar tema escuro",
  "theme.toggleToLight": "Ativar tema claro",
  "dashboard.title": "Painel",
  "dashboard.welcome": "Esqueleto do painel operador/gestor — telas de domínio chegam nas próximas fases.",
  "dashboard.apiStatus.label": "Status da API",
  "dashboard.apiStatus.checking": "Verificando conexão com a API…",
  "dashboard.apiStatus.online": "API online",
  "dashboard.apiStatus.offline": "API offline — verifique se apps/api está rodando",
  "notFound.title": "Página não encontrada",
  "notFound.description": "O endereço acessado não existe ou foi movido.",
  "notFound.backHome": "Voltar para o início",
  "error.title": "Algo deu errado",
  "error.description": "Ocorreu um erro inesperado ao carregar esta página.",
  "error.backHome": "Voltar para o início",
} as const;

export type DictionaryKey = keyof typeof ptBR;

type Dictionary = Partial<Record<DictionaryKey, string>>;

const dictionaries: Record<Locale, Dictionary> = {
  "pt-BR": ptBR,
  // Vazio de propósito: sem troca de idioma nesta tarefa. `t()` cai para pt-BR
  // em qualquer chave ausente aqui, então isto pode ser preenchido incrementalmente.
  en: {},
};

/**
 * Resolve uma chave de UI no locale atual. Chave ausente no locale ativo cai
 * para pt-BR (locale de referência) e, na ausência, retorna a própria chave —
 * nunca lança, para que um texto novo nunca derrube uma tela em produção.
 */
export function t(key: DictionaryKey, locale: Locale = DEFAULT_LOCALE): string {
  return dictionaries[locale][key] ?? dictionaries["pt-BR"][key] ?? key;
}
