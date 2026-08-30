// src/config/featureFlags.js
//
// Kill switches de features do cockpit — desligam a feature sem remover o
// código, para isolar variáveis durante a investigação de gargalo na telemetria.
//
// TRACK_MAP_ENABLED espelha, no cliente, o `TRACK_MAP_ENABLED` do servidor
// (telemetry-server/.env). Com o servidor desligado nenhuma mensagem `track_*`
// chega pelo WebSocket, mas o cliente ainda pagava o custo do painel montado:
// `buildTrackOverlay` roda em memos que reprojetam a polyline inteira e o SVG
// fica no DOM só para mostrar "aguardando volta". Com o flag em `false` o
// worker descarta a mensagem antes do JSON.parse, o store não escreve em
// `trackState` e o painel some da árvore — custo zero no caminho quente.
//
// Para reativar: `true` aqui + `TRACK_MAP_ENABLED=true` no .env do servidor,
// seguido de `npm run build` (o dashboard é servido de `dist/`).
export const TRACK_MAP_ENABLED = false

// Mantido apenas para recursos visuais do mapa. A lista de voltas exibida no
// Cockpit vem do backend via WebSocket, não é mais calculada pelo frontend.
export const LAP_TIMING_ENABLED = false
