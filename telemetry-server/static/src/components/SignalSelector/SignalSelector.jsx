/**
 * ============================================================================
 * SignalSelector.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Exibir e selecionar sinais recebidos na sessão de forma pesquisável e agrupada.
 *
 * Fluxo:
 *   signals store
 *       -> Object.entries()
 *       -> filtro por busca
 *       -> groupSignals()
 *       -> render por subsistema
 *       -> seleção controlada pelo App
 *
 * O componente não decide o que fazer com a seleção. Ele apenas expõe eventos
 * para que a tela de Análise monte gráficos customizados ou outras ferramentas.
 */

import { For, Show, createMemo, createSignal } from 'solid-js'
import { signals } from '../../store.js'
import { groupSignals } from '../../utils/signalGrouping'
import './SignalSelector.css'

const EMPTY_SIGNAL_GROUPS = [
    {
        label: 'Powertrain',
        signals: ['act_Speed_A0', 'act_DCBusVoltage_M0', 'act_Power_A0'],
    },
    {
        label: 'BMS e seguranca',
        signals: ['Fault_BMS', 'BMS_Over_voltage', 'BMS_Cell_Overheat'],
    },
    {
        label: 'Inercial',
        signals: ['ventor_linear_acc_x', 'ventor_linear_acc_y', 'ventor_linear_acc_z'],
    },
]

function formatValue(value) {
    if (value == null) return '—'

    return Number.isInteger(value) ? value : value.toFixed(2)
}

function SignalSelector(props) {
    const [query, setQuery] = createSignal('')

    const selectedSet = createMemo(() => new Set(props.selectedSignals ?? []))

    const signalEntries = createMemo(() => {
        const normalizedQuery = query().trim().toLowerCase()

        return Object.entries(signals)
            .map(([name, entry]) => ({
                name,
                value: entry.value,
                unit: entry.unit,
                timestamp: entry.timestamp,
            }))
            .filter(({ name, unit }) => {
                if (!normalizedQuery) return true

                return (
                    name.toLowerCase().includes(normalizedQuery) ||
                    (unit ?? '').toLowerCase().includes(normalizedQuery)
                )
            })
            .sort((a, b) => a.name.localeCompare(b.name))
    })

    const groupedSignals = createMemo(() => groupSignals(signalEntries()))
    const totalSignals = createMemo(() => Object.keys(signals).length)
    const selectedCount = createMemo(() => props.selectedSignals?.length ?? 0)

    return (
        <section class="signal-selector">
            <header class="signal-selector__header">
                <div>
                    <h2 class="signal-selector__title">Sinais</h2>
                    <span class="signal-selector__count">
                        {totalSignals()} recebidos · {selectedCount()} selecionados
                    </span>
                </div>

                <div class="signal-selector__actions">
                    <button
                        class="signal-selector__clear"
                        type="button"
                        disabled={selectedCount() === 0}
                        onClick={() => props.onClearSelection?.()}
                    >
                        Limpar
                    </button>

                    <input
                        class="signal-selector__search"
                        type="search"
                        placeholder="Buscar sinal"
                        value={query()}
                        onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                </div>
            </header>

            <Show
                when={groupedSignals().length > 0}
                fallback={
                    <div class="signal-selector__empty">
                        <div class="signal-selector__empty-copy">
                            <strong>Aguardando sinais da sessao</strong>
                            <span>Os grupos abaixo indicam os canais esperados quando o stream iniciar.</span>
                        </div>

                        <div class="signal-selector__empty-groups">
                            <For each={EMPTY_SIGNAL_GROUPS}>
                                {(group) => (
                                    <section class="signal-selector__empty-group">
                                        <div class="signal-selector__empty-group-title">
                                            {group.label}
                                        </div>
                                        <For each={group.signals}>
                                            {(signal) => (
                                                <span class="signal-selector__empty-signal">
                                                    {signal}
                                                </span>
                                            )}
                                        </For>
                                    </section>
                                )}
                            </For>
                        </div>
                    </div>
                }
            >
                <div class="signal-selector__groups">
                    <For each={groupedSignals()}>
                        {(group) => (
                            <section class="signal-group">
                                <div class="signal-group__header">
                                    <span>{group.label}</span>
                                    <span>{group.signals.length}</span>
                                </div>

                                <div class="signal-group__list">
                                    <For each={group.signals}>
                                        {(signal) => (
                                            <button
                                                classList={{
                                                    'signal-row': true,
                                                    'signal-row--selected': selectedSet().has(signal.name),
                                                }}
                                                type="button"
                                                title={signal.name}
                                                aria-pressed={selectedSet().has(signal.name)}
                                                onClick={() => props.onToggleSignal?.(signal.name)}
                                            >
                                                <span class="signal-row__name">
                                                    {signal.name}
                                                </span>
                                                <span class="signal-row__value">
                                                    {formatValue(signal.value)}
                                                    <span class="signal-row__unit">
                                                        {signal.unit ?? ''}
                                                    </span>
                                                </span>
                                            </button>
                                        )}
                                    </For>
                                </div>
                            </section>
                        )}
                    </For>
                </div>
            </Show>
        </section>
    )
}

export default SignalSelector
