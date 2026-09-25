import type { SvgIconComponent } from "@mui/icons-material";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";

import type { DictionaryKey } from "../../shared/i18n/t";

export interface NavItem {
  to: string;
  labelKey: DictionaryKey;
  icon: SvgIconComponent;
}

/**
 * Item placeholder único ("Painel") — ULTRAPLAN 0.7 é só o esqueleto do app,
 * ainda sem telas de domínio (sessions/lots/pricing chegam módulo a módulo nas
 * próximas fases). Não inventar itens de navegação para features que não existem.
 * `icon` vive no dado (não fixo no componente do Drawer) para que o próximo item
 * de navegação real não precise lembrar de "destravar" o ícone lá.
 */
export const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: SpaceDashboardIcon },
];
