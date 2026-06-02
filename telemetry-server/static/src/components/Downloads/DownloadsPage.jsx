import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import {
    downloadTelemetryLog,
    listTelemetryLogs,
} from '../../services/logDownloads.js'
import { PERMISSIONS, hasPermission } from '../../utils/permissions.js'
import DownloadFilters from './DownloadFilters.jsx'
import DownloadLogTable from './DownloadLogTable.jsx'
import './DownloadsPage.css'

const DEFAULT_FILTERS = {
    q: '',
    from: '',
    to: '',
    format: '',
    status: '',
    limit: '50',
}

const PROCESSING_STATUSES = new Set(['processing', 'pending', 'generating'])
const PROCESSING_REFRESH_MS = 5000

function normalizeFilters(filters) {
    return {
        ...filters,
        from: filters.from ? new Date(filters.from).toISOString() : '',
        to: filters.to ? new Date(filters.to).toISOString() : '',
    }
}

function DownloadsPage(props) {
    const [filters, setFilters] = createSignal(DEFAULT_FILTERS)
    const [logs, setLogs] = createSignal([])
    const [loading, setLoading] = createSignal(false)
    const [refreshing, setRefreshing] = createSignal(false)
    const [error, setError] = createSignal('')
    const [downloadingId, setDownloadingId] = createSignal(null)
    let refreshTimer = null

    const canDownload = () =>
        hasPermission(props.session, PERMISSIONS.logsDownload)
    const hasProcessingLogs = () =>
        logs().some((log) => PROCESSING_STATUSES.has(log.status))

    async function loadLogs(nextFilters = filters(), options = {}) {
        const background = options.background ?? false
        if (background) setRefreshing(true)
        else setLoading(true)
        setError('')

        try {
            const result = await listTelemetryLogs(
                normalizeFilters(nextFilters),
                props.session.token
            )
            setLogs(result.items)
        } catch (err) {
            setLogs([])
            setError(err.message || 'Nao foi possivel carregar os logs.')
        } finally {
            if (background) setRefreshing(false)
            else setLoading(false)
        }
    }

    async function handleSubmit(event) {
        event.preventDefault()
        await loadLogs()
    }

    async function handleDownload(log) {
        if (!canDownload()) return

        setDownloadingId(log.id)
        setError('')

        try {
            await downloadTelemetryLog(log, props.session.token)
        } catch (err) {
            setError(err.message || 'Nao foi possivel baixar o log.')
        } finally {
            setDownloadingId(null)
        }
    }

    onMount(() => {
        loadLogs()
    })

    createEffect(() => {
        if (refreshTimer) {
            clearTimeout(refreshTimer)
            refreshTimer = null
        }

        if (!hasProcessingLogs() || loading() || refreshing() || error()) return

        refreshTimer = setTimeout(() => {
            loadLogs(filters(), { background: true })
        }, PROCESSING_REFRESH_MS)
    })

    onCleanup(() => {
        if (refreshTimer) clearTimeout(refreshTimer)
    })

    return (
        <main class="downloads-page">
            <header class="downloads-header">
                <div>
                    <h1>Downloads</h1>
                    <p>Logs de telemetria disponiveis para analise.</p>
                </div>

                <button
                    class="downloads-button"
                    type="button"
                    disabled={loading() || refreshing()}
                    onClick={() => loadLogs()}
                >
                    {refreshing() ? 'Atualizando' : 'Atualizar'}
                </button>
            </header>

            <DownloadFilters
                filters={filters()}
                onChange={setFilters}
                onSubmit={handleSubmit}
            />

            <Show
                when={!loading()}
                fallback={<div class="downloads-message">Carregando logs...</div>}
            >
                <Show
                    when={!error()}
                    fallback={
                        <div class="downloads-message downloads-message--error" role="alert">
                            {error()}
                        </div>
                    }
                >
                    <Show
                        when={logs().length > 0}
                        fallback={<div class="downloads-message">Nenhum log encontrado.</div>}
                    >
                        <DownloadLogTable
                            logs={logs()}
                            canDownload={canDownload()}
                            downloadingId={downloadingId()}
                            onDownload={handleDownload}
                        />
                    </Show>
                </Show>
            </Show>
        </main>
    )
}

export default DownloadsPage
