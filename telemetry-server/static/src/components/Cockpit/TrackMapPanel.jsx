import { Show } from 'solid-js'

function TrackMapPanel({ source, data }) {
    const pointsAttr = () => {
        const points = data?.track?.points ?? []
        return points
            .map(([x, y]) => `${(x * 100).toFixed(2)},${(100 - y * 100).toFixed(2)}`)
            .join(' ')
    }

    const vehicleStyle = () => {
        const vehicle = data?.vehicle
        if (!vehicle) return {}
        return {
            left: `${vehicle.x * 100}%`,
            top: `${(1 - vehicle.y) * 100}%`,
        }
    }

    const hasRealtimeMap = () => (data?.track?.points?.length ?? 0) > 1

    return (
        <section class="track-map" aria-label="Mapa da pista em tempo real">
            <header class="cockpit-panel__header">
                <span>Mapa da pista</span>
                <strong>{hasRealtimeMap() ? 'tracking' : source ? 'sincronizado' : 'aguardando volta'}</strong>
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
                    </svg>
                    <Show when={data?.vehicle}>
                        <div class="track-map__position track-map__position--live" style={vehicleStyle()} />
                    </Show>
                    <span class="track-map__label">
                        {data?.track?.length_m ? `${data.track.length_m.toFixed(0)} m` : 'mapa congelado'}
                    </span>
                </Show>
            </div>
        </section>
    )
}

export default TrackMapPanel
