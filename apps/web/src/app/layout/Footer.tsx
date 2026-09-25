import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import { t } from "../../shared/i18n/t";
import { useThemeMode } from "../../theme/ThemeModeProvider";

const LOGO_BY_MODE = {
  light: "/brand/ikebukuro-wordmark-navy.png",
  dark: "/brand/ikebukuro-wordmark-white.png",
} as const;

/**
 * Crédito "Desenvolvido por" no rodapé do painel — mesmo padrão usado no
 * repositório conceptcar_premium (link para ikebukuro.com.br, texto discreto
 * + wordmark). A logo troca de variante (navy/branca) conforme o tema claro/
 * escuro, já que aqui — diferente do site estático do concept car — o painel
 * tem os dois modos.
 */
export function Footer() {
  const { mode } = useThemeMode();

  return (
    <Box component="footer" sx={{ mt: "auto", pt: 4, pb: 3, textAlign: "center" }}>
      <Link
        href="https://ikebukuro.com.br"
        target="_blank"
        rel="noopener noreferrer"
        underline="none"
        aria-label={`${t("footer.developedBy")} ${t("footer.logoAlt")}`}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          opacity: 0.7,
          transition: "opacity 0.2s ease",
          "&:hover": { opacity: 1 },
        }}
      >
        <Typography component="span" variant="caption" color="text.secondary">
          {t("footer.developedBy")}
        </Typography>
        <Box
          component="img"
          src={LOGO_BY_MODE[mode]}
          alt={t("footer.logoAlt")}
          sx={{ height: 20, width: "auto" }}
        />
      </Link>
    </Box>
  );
}
