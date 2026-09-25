import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import Box from "@mui/material/Box";
import Chip, { type ChipProps } from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useApiHealth } from "../shared/hooks/use-api-health";
import { t } from "../shared/i18n/t";

interface ApiStatusDisplay {
  label: string;
  // `NonNullable`, não `ChipProps["color"|"icon"]` diretamente: essas são
  // indexed-access types opcionais (incluem `| undefined`), o que conflita com
  // `exactOptionalPropertyTypes` ao repassar pro `<Chip>` abaixo — cada branch
  // de `describeApiStatus` sempre define um valor concreto, nunca `undefined`.
  color: NonNullable<ChipProps["color"]>;
  icon: NonNullable<ChipProps["icon"]>;
}

function describeApiStatus(
  isLoading: boolean,
  isError: boolean,
): ApiStatusDisplay {
  if (isLoading) {
    return {
      label: t("dashboard.apiStatus.checking"),
      color: "default",
      icon: <HourglassEmptyIcon fontSize="small" />,
    };
  }
  if (isError) {
    return {
      label: t("dashboard.apiStatus.offline"),
      color: "error",
      icon: <ErrorIcon fontSize="small" />,
    };
  }
  return {
    label: t("dashboard.apiStatus.online"),
    color: "success",
    icon: <CheckCircleIcon fontSize="small" />,
  };
}

/**
 * Página placeholder ("Painel") — ULTRAPLAN 0.7. Sem tela de domínio ainda; o
 * indicador de status da API é só uma prova de conectividade fim a fim do
 * pipeline TanStack Query → fetch → `apps/api` (CORS incluso), não uma feature.
 * Cor nunca é o único sinal: ícone + texto sempre acompanham a cor do Chip.
 */
export function DashboardPage() {
  const health = useApiHealth();
  const status = describeApiStatus(health.isLoading, health.isError);

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h2">
        {t("dashboard.title")}
      </Typography>
      <Typography color="text.secondary">{t("dashboard.welcome")}</Typography>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t("dashboard.apiStatus.label")}
        </Typography>
        <Chip icon={status.icon} label={status.label} color={status.color} variant="outlined" />
      </Box>
    </Stack>
  );
}
