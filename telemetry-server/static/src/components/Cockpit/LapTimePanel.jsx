import { For, Show, createEffect, createSignal } from 'solid-js'
import { lapState } from '../../store.js'

function LapTimePanel() {
    const [flash, setFlash] = createSignal(false)

    createEffect(() => {
        const at = lapState.lastLapAt
        if (!at) return
        setFlash(true)
        const timer = setTimeout(() => setFlash(false), 2000)
        return () => clearTimeout(timer)
    })

    // bestLaps já vem do store ordenado por tempo (mais rápida primeiro), top 5
    const bestLaps = () => lapState.bestLaps

    return (
        <section class="lap-time" aria-label="Tempos de volta">
            <header class="cockpit-panel__header">
                <span>Melhores voltas</span>
                <strong>{lapState.lapCount > 0 ? `${lapState.lapCount} completadas` : 'aguardando'}</strong>
            </header>

            <div class="lap-time__body">
                <Show
                    when={lapState.lastLapTime}
                    fallback={
                        <div class="lap-time__empty">
                            <span>aguardando primeira volta</span>
                        </div>
                    }
                >
                    <div
                        class="lap-time__last"
                        classList={{ 'lap-time__last--flash': flash() }}
                    >
                        <span class="lap-time__last-label">Última volta</span>
                        <span class="lap-time__last-value">{lapState.lastLapTime}</span>
                    </div>
                </Show>

                <Show when={bestLaps().length > 0}>
                    <div class="lap-time__list">
                        <For each={bestLaps()}>
                            {(entry, i) => (
                                <span
                                    class="lap-time__entry"
                                    classList={{ 'lap-time__entry--best': i() === 0 }}
                                >
                                    <span class="lap-time__entry-rank">#{i() + 1}</span>
                                    <span class="lap-time__entry-lap">volta {entry.lap}</span>
                                    <span class="lap-time__entry-time">{entry.formatted}</span>
                                </span>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </section>
    )
}

export default LapTimePanel