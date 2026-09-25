import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

import { t } from "../shared/i18n/t";

/**
 * Rota coringa (`*`) — ULTRAPLAN 0.7. Fora do `AppLayout` de propósito: uma URL
 * inexistente não deveria parecer que o painel "meio que carregou" com AppBar e
 * Drawer de um contexto que não existe.
 */
export function NotFoundPage() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 2,
        textAlign: "center",
        p: 3,
      }}
    >
      <Typography
        variant="h1"
        component="p"
        aria-hidden
        sx={{ fontSize: { xs: "3.5rem", sm: "5rem" }, fontWeight: 700, color: "text.disabled" }}
      >
        404
      </Typography>
      <Typography variant="h5" component="h1">
        {t("notFound.title")}
      </Typography>
      <Typography color="text.secondary">{t("notFound.description")}</Typography>
      <Button component={RouterLink} to="/" variant="contained">
        {t("notFound.backHome")}
      </Button>
    </Box>
  );
}
