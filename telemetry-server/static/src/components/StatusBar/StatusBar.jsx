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
import { METRIC_SIGNAL_CARDS, STATUS_INDICATORS } from '../../config/dashboardConfig.js'
import { getSignalColor } from '../../utils/telemetryUtils.js'
import SignalCard from './SignalCard'
import StatusIndicator from './StatusIndicator'
import { useSignalStats } from './useSignalStats'
import './StatusBar.css'

function StatusBar() {
    const stats = useSignalStats(METRIC_SIGNAL_CARDS)

    return (
        <div class="status-bar">
            {/* Container interno com overflow-y: auto — único responsável pelo scroll */}
            <div class="status-bar__scroll">
                <For each={METRIC_SIGNAL_CARDS}>
                    {(config, index) => (
                        <SignalCard
                            signalName={config.signalName}
                            signalNames={config.signalNames}
                            label={config.label}
                            dataClass={config.dataClass}
                            aggregate={config.aggregate}
                            unit={config.unit}
                            stats={stats}
                            signalColor={getSignalColor(index())}
                        />
                    )}
                </For>

                <div class="status-indicator-group">
                    <For each={STATUS_INDICATORS}>
                        {(config) => <StatusIndicator config={config} />}
                    </For>
                </div>
            </div>
        </div>
    )
}

export default StatusBar
