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
    if (value == null) return '—'
    return Number(value).toFixed(2)
}

/**
 * @param {string}  signalName
 * @param {string}  label
 * @param {string}  dataClass
 * @param {object}  stats
 * @param {string}  [signalColor]  — cor da paleta do gráfico para este sinal
 */
function SignalCard({ signalName, label, dataClass = 'default', stats, signalColor }) {
    const entry = () => signals[signalName]
    const stat = () => stats[signalName]
    const average = () => stat() ? stat().sum / stat().count : null

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
                    <span class="signal-card__unit">{entry()?.unit ?? ''}</span>
                </span>
            </div>

            <div class="signal-card__stats">
                <span class="signal-card__stat">↑&nbsp;<span class="signal-card__stat-value">{formatValue(stat()?.max)}</span></span>
                <span class="signal-card__stat">↓&nbsp;<span class="signal-card__stat-value">{formatValue(stat()?.min)}</span></span>
                <span class="signal-card__stat">~&nbsp;<span class="signal-card__stat-value">{formatValue(average())}</span></span>
            </div>
        </div>
    )
}

export default SignalCard
