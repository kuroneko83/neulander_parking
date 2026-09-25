import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import { NavLink } from "react-router-dom";

import { t } from "../../shared/i18n/t";
import { navItems } from "./nav-items";

export const DRAWER_WIDTH = 260;

interface NavigationDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer temporário (overlay) controlado pelo botão de menu do AppBar — mesmo
 * comportamento em qualquer tamanho de tela nesta tarefa (ULTRAPLAN 0.7 é só o
 * esqueleto; um layout permanente-no-desktop/temporário-no-mobile fica pra
 * quando houver conteúdo de domínio suficiente para justificar a complexidade).
 */
export function NavigationDrawer({ open, onClose }: NavigationDrawerProps) {
  return (
    <Drawer
      variant="temporary"
      open={open}
      onClose={onClose}
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
      }}
    >
      <Toolbar />
      <List aria-label={t("nav.title")}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            onClick={onClose}
            sx={{
              "&.active": {
                backgroundColor: "action.selected",
              },
            }}
          >
            <ListItemIcon>
              <item.icon />
            </ListItemIcon>
            <ListItemText primary={t(item.labelKey)} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}
