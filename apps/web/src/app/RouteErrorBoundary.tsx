import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { isRouteErrorResponse, Link as RouterLink, useRouteError } from "react-router-dom";

import { t } from "../shared/i18n/t";

function describeError(error: unknown): string | undefined {
  if (isRouteErrorResponse(error)) {
    return `${String(error.status)} ${error.statusText}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
}

/**
 * Error boundary básico da rota raiz (ULTRAPLAN 0.7), via `errorElement` do
 * React Router: qualquer erro de render/loader dentro do layout cai aqui em vez
 * de derrubar o app inteiro numa tela branca.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const description = describeError(error);

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
      <Typography variant="h4" component="h1">
        {t("error.title")}
      </Typography>
      <Typography color="text.secondary">{t("error.description")}</Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      <Button component={RouterLink} to="/" variant="contained">
        {t("error.backHome")}
      </Button>
    </Box>
  );
}
