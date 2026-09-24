# ADR-0008 — Web React + MUI v5; Mobile Expo + React Native Paper

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Preferência do autor por React/TypeScript/MUI 5. Painel é interno (sem SEO). App precisa de mapa, câmera (QR), push e pagamentos nativos.

## Decisão
Web: SPA com Vite, React 18, MUI v5 (+ MUI X DataGrid/DatePickers), TanStack Query, React Router, React Hook Form + Zod. Mobile: Expo (managed, EAS) + expo-router + React Native Paper (Material Design, visual coerente com MUI) + react-native-maps. Ambos consomem `packages/api-client`.

## Consequências
- Sem SSR (desnecessário para painel autenticado); página pública do ticket é leve.
- MUI não roda em RN: design tokens compartilhados em `packages/contracts`/`theme-tokens` para coerência.

## Alternativas consideradas
- **Next.js:** SSR sem necessidade. **Flutter:** fugiria do ecossistema TS. **Tamagui/NativeWind universal:** afastaria do MUI preferido.
