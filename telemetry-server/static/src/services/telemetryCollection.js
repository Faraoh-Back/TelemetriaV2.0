import { getServerConfig } from '../config/serverConfig.js'

export class TelemetryCollectionError extends Error {
    constructor(message, status = null) {
        super(message)
        this.name = 'TelemetryCollectionError'
        this.status = status
    }
}

function authHeaders(token) {
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
}

async function parseCollectionResponse(response, fallbackMessage) {
    const data = await response.json().catch(() => ({}))

    if (!response.ok || data.ok === false) {
        throw new TelemetryCollectionError(
            data.message || fallbackMessage,
            response.status
        )
    }

    return data
}

export async function startTelemetryCollection(token) {
    const { apiBase } = getServerConfig()
    const response = await fetch(`${apiBase}/telemetry/collection/start`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
            requested_at: new Date().toISOString(),
        }),
    })

    return parseCollectionResponse(
        response,
        'Nao foi possivel iniciar a coleta.'
    )
}

export async function stopTelemetryCollection(token, bounds) {
    const { apiBase } = getServerConfig()
    const response = await fetch(`${apiBase}/telemetry/collection/stop`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
            requested_at: new Date().toISOString(),
            log_start_unix: bounds?.log_start_unix ?? null,
            log_stop_unix: bounds?.log_stop_unix ?? null,
        }),
    })

    return parseCollectionResponse(
        response,
        'Nao foi possivel encerrar a coleta.'
    )
}

export async function persistTelemetryLogBounds(bounds, token) {
    const { apiBase } = getServerConfig()
    const response = await fetch(`${apiBase}/telemetry/log-session-bounds`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
            log_start_unix: bounds.log_start_unix,
            log_stop_unix: bounds.log_stop_unix,
        }),
    })

    return parseCollectionResponse(
        response,
        'Nao foi possivel registrar os limites da coleta.'
    )
}
