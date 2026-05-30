import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { buildTrackOverlay } from './trackMapMetrics.js'

function TrackMapPanel({ source, data, isTelemetryLive }) {
    const [frozenOverlay, setFrozenOverlay] = createSignal(null)

    const pointsAttr = () => {
        const points = data?.track?.points ?? []
        return points
            .map(([x, y]) => `${(x * 100).toFixed(2)},${(100 - y * 100).toFixed(2)}`)
            .join(' ')
    }

    const hasRealtimeMap = () => (data?.track?.points?.length ?? 0) > 1
    const telemetryLive = () => Boolean(isTelemetryLive)
    const liveOverlay = createMemo(() => buildTrackOverlay(data?.track, data?.vehicle))
    const pausedOverlay = createMemo(() => buildTrackOverlay(data?.track, null))
    const displayOverlay = createMemo(() => {
        if (telemetryLive()) return liveOverlay()
        return frozenOverlay() ?? pausedOverlay()
    })

    createEffect(() => {
        if (!hasRealtimeMap()) {
            setFrozenOverlay(null)
            return
        }
        const overlay = liveOverlay()
        if (!telemetryLive() || !overlay?.vehiclePoint) return
        setFrozenOverlay(overlay)
    })

    return (
        <section class="track-map" aria-label="Mapa da pista em tempo real">
            <header class="cockpit-panel__header">
                <span>Mapa da pista</span>
                <strong>
                    {hasRealtimeMap()
                        ? telemetryLive() ? 'tracking' : 'coleta pausada'
                        : source ? 'sincronizado' : 'aguardando volta'}
                </strong>
            </header>

            <div class="track-map__body">
                <Show
                    when={hasRealtimeMap()}
                    fallback={
                        <Show
                            when={source}
                            fallback={
                                <>
                                    <div class="track-map__path" />
                                    <div class="track-map__position" />
                                    <span class="track-map__label">aprendendo primeira volta</span>
                                </>
                            }
                        >
                            <img class="track-map__image" src={source} alt="Mapa da pista" />
                        </Show>
                    }
                >
                    <svg class="track-map__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                        <polyline class="track-map__polyline" points={pointsAttr()} />
                        <Show when={displayOverlay()?.start}>
                            {(point) => (
                                <circle class="track-map__start" cx={point().x} cy={point().y} r="2.4" />
                            )}
                        </Show>
                        <Show when={displayOverlay()?.vehiclePoint}>
                            {(point) => (
                                <circle class="track-map__vehicle" cx={point().x} cy={point().y} r="2.8" />
                            )}
                        </Show>
                    </svg>
                    <div class="track-map__stats">
                        <For each={displayOverlay()?.stats ?? []}>
                            {(stat) => (
                                <span class="track-map__stat">
                                    <strong>{stat.label}</strong>
                                    <em>{stat.value}</em>
                                </span>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </section>
    )
}

export default TrackMapPanel
