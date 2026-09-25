import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";

import { AppHeader } from "./AppHeader";
import { NavigationDrawer } from "./NavigationDrawer";

/**
 * Layout raiz (ULTRAPLAN 0.7): AppBar + Drawer + `<Outlet />` do React Router.
 * Estado do Drawer vive aqui (a única fonte de verdade) e é passado para baixo —
 * AppHeader só dispara o toggle, NavigationDrawer só reflete `open`.
 */
export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleToggleDrawer = useCallback(() => {
    setDrawerOpen((current) => !current);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  return (
    <Box sx={{ display: "flex" }}>
      <AppHeader onToggleDrawer={handleToggleDrawer} />
      <NavigationDrawer open={drawerOpen} onClose={handleCloseDrawer} />
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
