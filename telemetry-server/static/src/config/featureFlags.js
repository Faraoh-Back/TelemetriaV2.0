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

// LAP_TIMING_ENABLED depende do mapa: a cronometragem é 100% derivada das
// mensagens `track_*` — ela divide `vehicle.distance_m` (vindo de `track_pose`)
// pelo comprimento da pista (vindo de `track_map`). Fica como flag própria para
// permitir desligar só a volta num servidor com o mapa ativo.
export const LAP_TIMING_ENABLED = false
