import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { buildTrackOverlay } from './trackMapMetrics.js'

function TrackMapPanel({ source, data, isTelemetryLive }) {
    const [frozenOverlay, setFrozenOverlay] = createSignal(null)

    const pointsAttr = () => {
        const points = displayOverlay()?.displayPoints ?? []
        return points
            .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
            .join(' ')
    }

    const odomPointsAttr = () => {
        const points = displayOverlay()?.odomPathPoints ?? []
        return points
            .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
            .join(' ')
    }

    const telemetryLive = () => Boolean(isTelemetryLive)
    const isLearning = () => data?.status === 'learning_first_lap' || data?.track?.learning === true
    const hasRealtimeMap = () => !isLearning() && (data?.track?.points?.length ?? 0) > 1
    const liveOverlay = createMemo(() => buildTrackOverlay(data?.track, data?.vehicle, data?.path, data?.quality, data?.landmarks))
    const pausedOverlay = createMemo(() => buildTrackOverlay(data?.track, null, data?.path, data?.quality, data?.landmarks))
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
                        <Show when={displayOverlay()?.odomPathPoints?.length > 0}>
                            <polyline class="track-map__odom-path" points={odomPointsAttr()} />
                        </Show>
                        <Show when={displayOverlay()?.start}>
                            {(point) => (
                                <circle class="track-map__start" cx={point().x} cy={point().y} r="2.4" />
                            )}
                        </Show>
                        <For each={displayOverlay()?.landmarks ?? []}>
                            {(landmark) => (
                                <circle class="track-map__landmark" cx={landmark.x} cy={landmark.y} r="1.5" />
                            )}
                        </For>
                        <Show when={displayOverlay()?.rawVehiclePoint && displayOverlay()?.projectedVehiclePoint}>
                            <line class="track-map__drift-line" 
                                x1={displayOverlay().rawVehiclePoint.x} y1={displayOverlay().rawVehiclePoint.y}
                                x2={displayOverlay().projectedVehiclePoint.x} y2={displayOverlay().projectedVehiclePoint.y}
                            />
                        </Show>
                        <Show when={displayOverlay()?.rawVehiclePoint}>
                            {(point) => (
                                <circle class="track-map__raw-vehicle" cx={point().x} cy={point().y} r="1.8" />
                            )}
                        </Show>
                        <Show when={displayOverlay()?.projectedVehiclePoint || displayOverlay()?.vehiclePoint}>
                            {(point) => (
                                <circle class="track-map__projected-vehicle track-map__vehicle" cx={point().x} cy={point().y} r="2.8" />
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
