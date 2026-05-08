/**
 * ============================================================================
 * SignalCard.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Apresentar um único sinal pinado.
 *
 * Fluxo:
 *   signalName
 *       -> signals[signalName] para valor/unidade atual
 *       -> stats[signalName] para max/min/media acumulada
 *       -> render do card
 */

import { signals } from '../../store.js'

function formatValue(value) {
    if (value == null) return '—'

    return Number.isInteger(value) ? value : value.toFixed(2)
}

function SignalCard({ signalName, label, stats }) {
    const entry = () => signals[signalName]
    const stat = () => stats[signalName]
    const average = () => stat() ? stat().sum / stat().count : null

    return (
        <div class="signal-card">
        <div class="signal-card__label">{label}</div>

        <div class="signal-card__value">
            {formatValue(entry()?.value)}
            <span class="signal-card__unit">{entry()?.unit ?? ''}</span>
        </div>

        <div class="signal-card__stats">
            <span>↑ {formatValue(stat()?.max)}</span>
            <span>↓ {formatValue(stat()?.min)}</span>
            <span>~ {formatValue(average())}</span>
        </div>
        </div>
    )
}

export default SignalCard
