agyimport { For, Show, createEffect, createSignal, createMemo } from 'solid-js'
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

    const displayLaps = createMemo(() => {
        const all = lapState.allLaps
        const best = new Set(lapState.bestLaps.map((l) => l.lap))
        return all.map((entry) => ({
            ...entry,
            isBest: best.has(entry.lap),
        }))
    })

    return (
        <section class="lap-time" aria-label="Tempos de volta">
            <header class="cockpit-panel__header">
                <span>Voltas</span>
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

                <Show when={displayLaps().length > 0}>
                    <div class="lap-time__list">
                        <For each={displayLaps()}>
                            {(entry) => (
                                <span
                                    class="lap-time__entry"
                                    classList={{ 'lap-time__entry--best': entry.isBest }}
                                >
                                    <span class="lap-time__entry-lap">#{entry.lap}</span>
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
