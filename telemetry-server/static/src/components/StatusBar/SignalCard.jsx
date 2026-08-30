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

function formatValue(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—'
    return Number(value).toFixed(2)
}

/**
 * @param {string}  signalName
 * @param {string}  label
 * @param {string}  dataClass
 * @param {string}  [unit]
 * @param {object}  stats
 * @param {Function} source  — memo de useSignalStats: () => { name, value, unit } | null.
 *                             Uma varredura por atualização, compartilhada com as estatísticas.
 * @param {string}  [totalLabel]
 * @param {Function} [totalSource]
 * @param {string}  [signalColor]  — cor da paleta do gráfico para este sinal
 */
function SignalCard({
    signalName,
    label,
    dataClass = 'default',
    unit,
    stats,
    source,
    totalLabel,
    totalSource,
    signalColor,
}) {
    const stat = () => stats[signalName]
    const average = () => stat() ? stat().sum / stat().count : null
    const total = () => totalSource?.()
    const displayUnit = () => {
        if (unit) return unit
        if (dataClass === 'torque') return 'Nm'
        return source()?.unit ?? ''
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
                        {formatValue(source()?.value)}
                    </span>
                    <span class="signal-card__unit">{displayUnit()}</span>
                </span>
            </div>

            <div class="signal-card__source">
                {source()?.name ?? signalName}
            </div>

            <div
                classList={{
                    'signal-card__stats': true,
                    'signal-card__stats--with-total': Boolean(totalSource),
                }}
            >
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
                {totalSource && (
                    <span class="signal-card__stat signal-card__stat--total">
                        <span class="signal-card__stat-icon">{totalLabel ?? 'total'}</span>
                        <span class="signal-card__stat-value">
                            {formatValue(total()?.value)}
                            <span class="signal-card__stat-unit">{unit ?? total()?.unit ?? ''}</span>
                        </span>
                    </span>
                )}
            </div>
        </div>
    )
}

export default SignalCard
