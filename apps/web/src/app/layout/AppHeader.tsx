import {
  Brightness4 as Brightness4Icon,
  Brightness7 as Brightness7Icon,
  Menu as MenuIcon,
} from "@mui/icons-material";
import AppBar from "@mui/material/AppBar";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import { t } from "../../shared/i18n/t";
import { useThemeMode } from "../../theme/ThemeModeProvider";

interface AppHeaderProps {
  onToggleDrawer: () => void;
}

export function AppHeader({ onToggleDrawer }: AppHeaderProps) {
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === "dark";

  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar>
        <IconButton
          color="inherit"
          edge="start"
          aria-label={t("nav.toggleDrawer")}
          onClick={onToggleDrawer}
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
          {t("app.title")}
        </Typography>
        {/* Cor não é o único sinal: o ícone (sol/lua) já muda de forma, e o
            aria-label descreve a ação disponível, não o estado atual. */}
        <IconButton
          color="inherit"
          aria-label={isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
          onClick={toggleMode}
        >
          {isDark ? <Brightness7Icon /> : <Brightness4Icon />}
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
