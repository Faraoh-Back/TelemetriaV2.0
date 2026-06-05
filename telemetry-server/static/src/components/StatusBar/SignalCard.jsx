/**
 * ============================================================================
 * SignalCard.jsx  (atualizado)
 * ============================================================================
 *
 * Alterações:
 *   - Área de valor com largura fixa (110px), flex-shrink: 0, text-align right,
 *     white-space: nowrap, font-variant-numeric: tabular-nums.
 *   - Valores numéricos formatados com 2 casas decimais.
 *   - Marcador de cor lateral usa a mesma cor da paleta do gráfico (via signalColor prop).
 *   - Estatísticas (max/min/avg) também com largura estável.
 */

import { signals } from '../../store.js'

function formatValue(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—'
    return Number(value).toFixed(2)
}

function getFiniteSignalEntries(signalNames = []) {
    return signalNames
        .map((name) => ({ name, entry: signals[name] }))
        .filter(({ entry }) => entry?.value != null && Number.isFinite(Number(entry.value)))
}

function getAggregateEntry(signalNames = [], aggregate = 'last') {
    const entries = getFiniteSignalEntries(signalNames)
    if (entries.length === 0) return null

    if (aggregate === 'min') {
        return entries.reduce((lowest, current) =>
            Number(current.entry.value) < Number(lowest.entry.value) ? current : lowest
        )
    }

    if (aggregate === 'max') {
        return entries.reduce((highest, current) =>
            Number(current.entry.value) > Number(highest.entry.value) ? current : highest
        )
    }

    return entries[entries.length - 1]
}

/**
 * @param {string}  signalName
 * @param {string[]} [signalNames]
 * @param {string}  label
 * @param {string}  dataClass
 * @param {string}  [aggregate]
 * @param {string}  [unit]
 * @param {object}  stats
 * @param {string}  [signalColor]  — cor da paleta do gráfico para este sinal
 */
function SignalCard({ signalName, signalNames, label, dataClass = 'default', aggregate, unit, stats, signalColor }) {
    const aggregateEntry = () => signalNames?.length > 0
        ? getAggregateEntry(signalNames, aggregate)
        : null
    const entry = () => aggregateEntry()?.entry ?? signals[signalName]
    const sourceName = () => aggregateEntry()?.name
    const stat = () => stats[signalName]
    const average = () => stat() ? stat().sum / stat().count : null
    const displayUnit = () => {
        if (unit) return unit
        if (dataClass === 'torque') return 'Nm'
        return entry()?.unit ?? ''
    }

    // Estilo inline apenas para a cor dinâmica do marcador lateral
    const borderStyle = () =>
        signalColor
            ? { 'border-left-color': signalColor, '--signal-card-color': signalColor }
            : {}

    return (
        <div
            class={`signal-card signal-card--${dataClass}`}
            style={borderStyle()}
        >
            <div class="signal-card__label">{label}</div>

            <div class="signal-card__value-row">
                <span class="signal-card__value-area">
                    <span class="signal-card__value">
                        {formatValue(entry()?.value)}
                    </span>
                    <span class="signal-card__unit">{displayUnit()}</span>
                </span>
            </div>

            <div class="signal-card__source">
                {sourceName() ?? signalName}
            </div>

            <div class="signal-card__stats">
                <span class="signal-card__stat">
                    <span class="signal-card__stat-icon">↑</span>
                    <span class="signal-card__stat-value">{formatValue(stat()?.max)}</span>
                </span>
                <span class="signal-card__stat">
                    <span class="signal-card__stat-icon">↓</span>
                    <span class="signal-card__stat-value">{formatValue(stat()?.min)}</span>
                </span>
                <span class="signal-card__stat">
                    <span class="signal-card__stat-icon">~</span>
                    <span class="signal-card__stat-value">{formatValue(average())}</span>
                </span>
            </div>
        </div>
    )
}

export default SignalCard
