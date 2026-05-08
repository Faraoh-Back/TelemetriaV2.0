/**
 * ============================================================================
 * StatusBar.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Renderizar a lista de sinais fixos do dashboard.
 *
 * Este componente não calcula estatísticas nem conhece detalhes internos do
 * card. Ele apenas:
 *
 *   1. Inicializa o hook de estatísticas para os sinais pinados
 *   2. Itera sobre PINNED_SIGNALS
 *   3. Renderiza um SignalCard por sinal
 */

import { For } from 'solid-js'
import { PINNED_SIGNALS } from '../../config/dashboardConfig.js'
import SignalCard from './SignalCard'
import { useSignalStats } from './useSignalStats'
import './StatusBar.css'

function StatusBar() {
    const stats = useSignalStats(PINNED_SIGNALS)

    return (
        <div class="status-bar">
        <For each={PINNED_SIGNALS}>
            {({ signalName, label }) => (
            <SignalCard
                signalName={signalName}
                label={label}
                stats={stats}
            />
            )}
        </For>
        </div>
    )
}

export default StatusBar