import { Show } from 'solid-js'

function TrackMapPanel({ source }) {
    return (
        <section class="track-map" aria-label="Mapa da pista em tempo real">
            <header class="cockpit-panel__header">
                <span>Mapa da pista</span>
                <strong>{source ? 'sincronizado' : 'aguardando back'}</strong>
            </header>

            <div class="track-map__body">
                <Show
                    when={source}
                    fallback={
                        <>
                            <div class="track-map__path" />
                            <div class="track-map__position" />
                            <span class="track-map__label">GPS / pose do veiculo</span>
                        </>
                    }
                >
                    <img class="track-map__image" src={source} alt="Mapa da pista" />
                </Show>
            </div>
        </section>
    )
}

export default TrackMapPanel
