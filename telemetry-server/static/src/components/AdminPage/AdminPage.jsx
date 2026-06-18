import { createSignal, onMount, onCleanup } from 'solid-js'
import { getServerConfig } from '../../config/serverConfig.js'
import './AdminPage.css'

const POLL_INTERVAL_MS = 3000

function formatBytes(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function latencyBadge(us) {
    if (us <= 0)     return 'off'
    if (us < 5000)   return 'ok'    // < 5ms
    if (us < 20000)  return 'warn'  // < 20ms
    return 'error'
}

function latencyLabel(us) {
    if (us <= 0) return 'Sem dados'
    if (us < 1000) return `${us} µs`
    return `${(us / 1000).toFixed(1)} ms`
}

function AdminPage(props) {
    const [stats, setStats]     = createSignal(null)
    const [network, setNetwork] = createSignal(null)
    const [error, setError]     = createSignal('')
    const [lastUpdate, setLastUpdate] = createSignal(null)

    const { apiBase } = getServerConfig()

    async function fetchStats() {
        try {
            const res = await fetch(`${apiBase}/api/admin/stats`, {
                headers: { Authorization: `Bearer ${props.session.token}` },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setStats(await res.json())
            setError('')
        } catch (e) {
            setError(`Erro ao buscar stats: ${e.message}`)
        }
    }

    async function fetchNetwork() {
        try {
            const res = await fetch(`${apiBase}/api/admin/network`, {
                headers: { Authorization: `Bearer ${props.session.token}` },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setNetwork(await res.json())
            setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
        } catch (e) {
            setError(`Erro ao buscar rede: ${e.message}`)
        }
    }

    async function refresh() {
        await Promise.all([fetchStats(), fetchNetwork()])
    }

    onMount(() => {
        refresh()
        const timer = setInterval(refresh, POLL_INTERVAL_MS)
        onCleanup(() => clearInterval(timer))
    })

    return (
        <div class="admin-page">
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <h2 class="admin-page__title">Painel Administrativo</h2>
                <div class="admin-refresh">
                    {lastUpdate() && <span>Atualizado às {lastUpdate()}</span>}
                    <button class="admin-refresh__btn" onClick={refresh}>↺ Atualizar</button>
                </div>
            </div>

            {error() && (
                <div style="color: #ef5350; font-size:13px;">{error()}</div>
            )}

            <div class="admin-grid">

                {/* ── Latência ── */}
                <div class="admin-card">
                    <div class="admin-card__header">
                        <h3 class="admin-card__title">Latência CAN → Servidor</h3>
                        <span class={`admin-card__badge admin-card__badge--${stats() ? latencyBadge(stats().latency_us) : 'off'}`}>
                            {stats() ? (latencyBadge(stats().latency_us) === 'ok' ? 'OK' : latencyBadge(stats().latency_us) === 'warn' ? 'ATENÇÃO' : latencyBadge(stats().latency_us) === 'error' ? 'ALTO' : 'OFFLINE') : 'OFFLINE'}
                        </span>
                    </div>
                    <div class="admin-stat">
                        <span class="admin-stat__label">Último frame recebido</span>
                        <span class="admin-stat__value">
                            {stats() ? latencyLabel(stats().latency_us) : '—'}
                        </span>
                    </div>
                </div>

                {/* ── Frequência de mensagens ── */}
                <div class="admin-card">
                    <div class="admin-card__header">
                        <h3 class="admin-card__title">Frequência de Mensagens</h3>
                        <span class={`admin-card__badge admin-card__badge--${stats()?.msg_per_sec > 0 ? 'ok' : 'off'}`}>
                            {stats()?.msg_per_sec > 0 ? 'ATIVO' : 'OFFLINE'}
                        </span>
                    </div>
                    <div class="admin-stat-row">
                        <div class="admin-stat">
                            <span class="admin-stat__label">Frames / segundo</span>
                            <span class="admin-stat__value">
                                {stats()?.msg_per_sec ?? '—'}
                                <span class="admin-stat__unit">fps</span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* ── QoS HTB ── */}
                <div class="admin-card">
                    <div class="admin-card__header">
                        <h3 class="admin-card__title">QoS — Classes HTB</h3>
                        <span class="admin-card__badge">
                            {network()?.iface ?? '—'}
                        </span>
                    </div>
                    {network()?.htb_classes?.length > 0 ? (
                        <>
                            <table class="admin-htb-table">
                                <thead>
                                    <tr>
                                        <th>Classe</th>
                                        <th>Enviado</th>
                                        <th>Pacotes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {network().htb_classes.map(c => (
                                        <tr>
                                            <td>{c.label}</td>
                                            <td>{formatBytes(c.sent_bytes)}</td>
                                            <td>{c.sent_pkts.toLocaleString('pt-BR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div class="admin-stat-row">
                                <div class="admin-stat">
                                    <span class="admin-stat__label">RX total</span>
                                    <span style="font-size:16px; font-weight:600; color:var(--text1);">
                                        {network() ? formatBytes(network().rx_bytes) : '—'}
                                    </span>
                                </div>
                                <div class="admin-stat">
                                    <span class="admin-stat__label">TX total</span>
                                    <span style="font-size:16px; font-weight:600; color:var(--text1);">
                                        {network() ? formatBytes(network().tx_bytes) : '—'}
                                    </span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div class="admin-placeholder">
                            <span class="admin-placeholder__icon">📡</span>
                            <span>QoS não configurado ou interface sem classes HTB</span>
                        </div>
                    )}
                </div>

                {/* ── RSSI ── */}
                <div class="admin-card">
                    <div class="admin-card__header">
                        <h3 class="admin-card__title">RSSI — Sinal Wi-Fi</h3>
                        <span class="admin-card__badge admin-card__badge--off">PENDENTE</span>
                    </div>
                    <div class="admin-placeholder">
                        <span class="admin-placeholder__icon">📶</span>
                        <span>Disponível quando a Jetson (AC_carro_laranja) estiver conectada</span>
                        <span style="font-size:11px; margin-top:4px;">
                            AP box: 143.106.207.101 · AP carro: 143.106.207.49
                        </span>
                    </div>
                </div>

            </div>
        </div>
    )
}

export default AdminPage