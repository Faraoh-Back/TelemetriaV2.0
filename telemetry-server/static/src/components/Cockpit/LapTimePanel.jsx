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

    const allLaps = () => lapState.allLaps ?? []
    const bestLap = () => lapState.bestLap ?? lapState.bestLaps?.[0] ?? null
    const isBestLap = (entry) =>
        bestLap() && entry.lap === bestLap().lap && entry.time === bestLap().time

    return (
        <section class="lap-time" aria-label="Tempos de volta">
            <header class="cockpit-panel__header">
                <span>Tempos de volta</span>
                <strong>{allLaps().length > 0 ? `${allLaps().length} completadas` : 'aguardando'}</strong>
            </header>

            <div class="lap-time__body">
                <Show
                    when={bestLap()}
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
                        <span class="lap-time__last-label">Melhor volta</span>
                        <span class="lap-time__last-value">{bestLap().formatted}</span>
                    </div>
                </Show>

                <Show when={allLaps().length > 0}>
                    <div class="lap-time__list">
                        <For each={allLaps()}>
                            {(entry) => (
                                <span
                                    class="lap-time__entry"
                                    classList={{ 'lap-time__entry--best': isBestLap(entry) }}
                                >
                                    <span class="lap-time__entry-rank">#{entry.lap}</span>
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
