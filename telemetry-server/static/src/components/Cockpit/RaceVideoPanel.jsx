import { Show } from 'solid-js'

function RaceVideoPanel({ source }) {
    return (
        <section class="race-video" aria-label="Video onboard em tempo real">
            <header class="cockpit-panel__header">
                <span>Onboard</span>
                <strong>{source ? 'live' : 'aguardando feed'}</strong>
            </header>

            <div class="race-video__frame">
                <Show
                    when={source}
                    fallback={
                        <div class="race-video__empty">
                            <div class="race-video__horizon" />
                            <div class="race-video__car-nose" />
                            <div class="race-video__crosshair" />
                            <strong>Video em tempo real</strong>
                            <span>Slot preparado para stream vindo do backend</span>
                        </div>
                    }
                >
                    <video
                        class="race-video__media"
                        src={source}
                        autoplay
                        muted
                        playsinline
                    />
                </Show>
            </div>
        </section>
    )
}

export default RaceVideoPanel
