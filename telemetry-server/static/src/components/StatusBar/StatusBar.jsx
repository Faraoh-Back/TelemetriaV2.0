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
import { METRIC_SIGNAL_CARDS, STATUS_INDICATOR_GROUPS } from '../../config/dashboardConfig.js'
import { getSignalColor } from '../../utils/telemetryUtils.js'
import SignalCard from './SignalCard'
import StatusIndicator from './StatusIndicator'
import { createSignalSources, useSignalStats } from './useSignalStats'
import './StatusBar.css'

function StatusBar() {
    // Uma fonte por card, compartilhada entre estatísticas e render — ver o
    // cabeçalho de useSignalStats.js para o porquê.
    const sources = createSignalSources(METRIC_SIGNAL_CARDS)
    const stats = useSignalStats(METRIC_SIGNAL_CARDS, sources)

    return (
        <div class="status-bar">
            {/* Container interno com overflow-y: auto — único responsável pelo scroll */}
            <div class="status-bar__scroll">
                <For each={METRIC_SIGNAL_CARDS}>
                    {(config, index) => (
                        <SignalCard
                            signalName={config.signalName}
                            label={config.label}
                            dataClass={config.dataClass}
                            unit={config.unit}
                            stats={stats}
                            source={sources.get(config.signalName)}
                            signalColor={getSignalColor(index())}
                        />
                    )}
                </For>

                <For each={STATUS_INDICATOR_GROUPS}>
                    {(group) => (
                        <section class={`status-indicator-section status-indicator-section--${group.tone}`}>
                            <div class="status-indicator-section__title">{group.label}</div>
                            <div class="status-indicator-group">
                                <For each={group.indicators}>
                                    {(config) => <StatusIndicator config={config} />}
                                </For>
                            </div>
                        </section>
                    )}
                </For>
            </div>
        </div>
    )
}

export default StatusBar
