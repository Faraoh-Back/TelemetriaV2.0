/**
 * ============================================================================
 * StatusBar.jsx  (atualizado)
 * ============================================================================
 *
 * Alterações:
 *   - Estrutura de dois containers: externo com overflow:hidden,
 *     interno (.status-bar__scroll) com overflow-y:auto e min-height:0.
 *   - Passa signalColor de PINNED_SIGNALS para cada SignalCard (se definido),
 *     ou usa getSignalColor(índice) como fallback para consistência com gráficos.
 */

import { For } from 'solid-js'
import { PINNED_SIGNALS } from '../../config/dashboardConfig.js'
import { getSignalColor } from '../../utils/telemetryUtils.js'
import SignalCard from './SignalCard'
import { useSignalStats } from './useSignalStats'
import './StatusBar.css'

function StatusBar() {
    const stats = useSignalStats(PINNED_SIGNALS)

    return (
        <div class="status-bar">
            {/* Container interno com overflow-y: auto — único responsável pelo scroll */}
            <div class="status-bar__scroll">
                <For each={PINNED_SIGNALS}>
                    {({ signalName, label, dataClass }, index) => (
                        <SignalCard
                            signalName={signalName}
                            label={label}
                            dataClass={dataClass}
                            stats={stats}
                            signalColor={getSignalColor(index())}
                        />
                    )}
                </For>
            </div>
        </div>
    )
}

export default StatusBar
