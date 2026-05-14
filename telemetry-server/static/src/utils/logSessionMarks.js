/**
 * Intervalo do log (Unix, mesmo relógio dos frames CAN) ao encerrar a coleta.
 *
 * ---------------------------------------------------------------------------
 * BACKEND — implementar (substituir o mock em persistTelemetryLogBoundsMock)
 * ---------------------------------------------------------------------------
 *
 * Rota sugerida (ajustar se o time padronizar outro path):
 *   POST /telemetry/log-session-bounds
 *
 * Headers:
 *   Content-Type: application/json
 *   Authorization: Bearer <JWT>   (mesmo token do login / WebSocket)
 *
 * Body JSON:
 *   { "log_start_unix": number, "log_stop_unix": number }
 *
 * Semântica:
 *   - Timestamps em segundos Unix, alinhados ao campo `timestamp` / `time` do
 *     armazenamento de telemetria, para fatiar o log (ex.: export MoTeC .ld).
 *
 * Resposta sugerida:
 *   { "ok": true, "id": "<identificador da marcação ou sessão>" }
 *
 * Erros: 4xx/5xx com JSON { "ok": false, "message": "..." }
 *
 * Observação: em dev com Vite, lembrar de adicionar proxy desta rota em
 * vite.config.js (como já existe para /login e /migrate).
 * ---------------------------------------------------------------------------
 */

/**
 * @param {{ log_start_unix: number, log_stop_unix: number }} bounds
 * @param {string | undefined} authToken JWT do operador (para quando houver fetch)
 * @returns {Promise<{ ok: boolean, mocked?: boolean }>}
 */
export async function persistTelemetryLogBoundsMock(bounds, authToken) {
    void authToken

    if (import.meta.env.DEV) {
        // Ajuda a validar o fluxo sem API; remover ou reduzir quando o POST existir.
        // eslint-disable-next-line no-console
        console.info('[telemetry] MOCK persistTelemetryLogBounds — backend ainda não implementado', bounds)
    }

    return { ok: true, mocked: true }
}
