import { getServerConfig } from '../config/serverConfig.js'

export class LogDownloadError extends Error {
    constructor(message, status = null) {
        super(message)
        this.name = 'LogDownloadError'
        this.status = status
    }
}

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {}
}

function buildLogsUrl(filters = {}) {
    const { apiBase } = getServerConfig()
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(filters)) {
        if (value == null || value === '') continue
        params.set(key, value)
    }

    const query = params.toString()
    return `${apiBase}/telemetry/logs${query ? `?${query}` : ''}`
}

async function parseJsonResponse(response) {
    const data = await response.json().catch(() => ({}))

    if (!response.ok || data.ok === false) {
        const statusMessage =
            response.status === 404
                ? 'Rota de logs nao encontrada no backend.'
                : null

        throw new LogDownloadError(
            statusMessage || data.message || 'Nao foi possivel carregar os logs.',
            response.status
        )
    }

    return data
}

export async function listTelemetryLogs(filters, token) {
    const response = await fetch(buildLogsUrl(filters), {
        headers: authHeaders(token),
    })
    const data = await parseJsonResponse(response)

    return {
        items: Array.isArray(data.items) ? data.items : [],
        nextCursor: data.next_cursor ?? null,
    }
}

function getFilenameFromDisposition(disposition) {
    if (!disposition) return null

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])

    const quotedMatch = disposition.match(/filename="([^"]+)"/i)
    if (quotedMatch?.[1]) return quotedMatch[1]

    const plainMatch = disposition.match(/filename=([^;]+)/i)
    return plainMatch?.[1]?.trim() ?? null
}

function getFallbackFilename(log) {
    const baseName = log.name || log.id || 'telemetry-log'
    const extension = log.format ? `.${log.format}` : ''
    return `${baseName}${extension}`.replace(/[\\/:*?"<>|]/g, '-')
}

function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}

export async function downloadTelemetryLog(log, token) {
    if (log.download_url) {
        window.location.assign(log.download_url)
        return
    }

    const { apiBase } = getServerConfig()
    const response = await fetch(`${apiBase}/telemetry/logs/${encodeURIComponent(log.id)}/download`, {
        headers: authHeaders(token),
    })

    if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new LogDownloadError(
            data.message || 'Nao foi possivel baixar o log.',
            response.status
        )
    }

    const blob = await response.blob()
    const filename =
        getFilenameFromDisposition(response.headers.get('Content-Disposition')) ||
        getFallbackFilename(log)

    triggerBlobDownload(blob, filename)
}
