import { For, Show } from 'solid-js'
import DownloadStatusBadge from './DownloadStatusBadge.jsx'

function formatDate(value) {
    if (!value) return '-'

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(date)
}

function formatDuration(seconds) {
    if (seconds == null) return '-'

    const totalSeconds = Math.max(0, Math.round(seconds))
    const minutes = Math.floor(totalSeconds / 60)
    const remainingSeconds = totalSeconds % 60

    return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
}

function formatBytes(bytes) {
    if (bytes == null) return '-'
    if (bytes < 1024) return `${bytes} B`

    const units = ['KB', 'MB', 'GB']
    let value = bytes / 1024
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function getLogName(log) {
    return log.name || log.id || 'Log de telemetria'
}

function getActionLabel(log, isDownloading, canDownload) {
    if (isDownloading) return 'Baixando'
    if (!canDownload) return 'Restrito'
    if (log.status === 'processing' || log.status === 'pending' || log.status === 'generating') {
        return 'Gerando .ld'
    }
    if (log.status === 'failed') return 'Falhou'
    if (log.status === 'expired') return 'Expirado'
    return 'Baixar'
}

function DownloadLogTable(props) {
    return (
        <div class="downloads-table-wrap">
            <table class="downloads-table">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Inicio</th>
                        <th>Fim</th>
                        <th>Duracao</th>
                        <th>Formato</th>
                        <th>Tamanho</th>
                        <th>Status</th>
                        <th>Acao</th>
                    </tr>
                </thead>
                <tbody>
                    <For each={props.logs}>
                        {(log) => {
                            const isReady = () => log.status === 'ready'
                            const isDownloading = () => props.downloadingId === log.id
                            const status = () => isDownloading() ? 'downloading' : log.status

                            return (
                                <tr>
                                    <td>
                                        <div class="downloads-log-name">{getLogName(log)}</div>
                                        <Show when={log.metadata?.driver || log.metadata?.vehicle}>
                                            <div class="downloads-log-meta">
                                                {[log.metadata?.driver, log.metadata?.vehicle]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </div>
                                        </Show>
                                    </td>
                                    <td>{formatDate(log.started_at)}</td>
                                    <td>{formatDate(log.ended_at)}</td>
                                    <td>{formatDuration(log.duration_seconds)}</td>
                                    <td class="downloads-format">{log.format || '-'}</td>
                                    <td>{formatBytes(log.size_bytes)}</td>
                                    <td>
                                        <DownloadStatusBadge status={status()} />
                                    </td>
                                    <td>
                                        <button
                                            class="downloads-button"
                                            type="button"
                                            disabled={!isReady() || isDownloading() || !props.canDownload}
                                            onClick={() => props.onDownload?.(log)}
                                        >
                                            {getActionLabel(log, isDownloading(), props.canDownload)}
                                        </button>
                                    </td>
                                </tr>
                            )
                        }}
                    </For>
                </tbody>
            </table>
        </div>
    )
}

export default DownloadLogTable
