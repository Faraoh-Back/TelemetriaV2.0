// src/config/featureFlags.js
//
// Kill switches de features do cockpit — desligam a feature sem remover o
// código, para isolar variáveis durante a investigação de gargalo na telemetria.
//
// LAP_TIMING_ENABLED espelha, no cliente, o `TRACK_MAP_ENABLED` do servidor
// (telemetry-server/.env). A cronometragem de volta é 100% derivada das
// mensagens `track_*`: ela divide `vehicle.distance_m` (vindo de `track_pose`)
// pelo comprimento da pista (vindo de `track_map`). Com o servidor desligado
// essas mensagens nunca chegam e a volta já pararia sozinha — este flag garante
// que ela fique desligada também num servidor com o mapa ainda ativo, e some
// da UI em vez de ficar um painel parado em "aguardando".
//
// Para reativar: `true` aqui + `TRACK_MAP_ENABLED=true` no .env do servidor,
// seguido de `npm run build` (o dashboard é servido de `dist/`).
export const LAP_TIMING_ENABLED = false
