/**
 * ============================================================================
 * gaugeUtils.js  (atualizado)
 * ============================================================================
 *
 * Utilitários puros do Gauge.
 *
 * Alterações:
 *   - formatGaugeValue() agora mostra zero casas decimais (Math.round)
 *     para RPM e qualquer sinal com escala grande
 *   - clampGaugeValue(): normaliza o valor ao intervalo do gauge antes
 *     de passar para valueToAngle, evitando valores visuais inconsistentes
 */

export const START_ANGLE = (225 * Math.PI) / 180
export const SWEEP = (270 * Math.PI) / 180

export const GAUGE_COLORS = {
    face: '#191c24',
    track: 'rgba(255,255,255,0.08)',
    tick: 'rgba(255,255,255,0.28)',
    tickLabel: '#9aa0ad',
    value: '#f4f5f7',
    unit: '#9aa0ad',
    nominal: '#dd663f',
    warn: '#e09b2f',
    critical: '#f05252',
}

function hasLongTickLabels(min, max) {
    return Math.max(Math.abs(min), Math.abs(max)) >= 10000
}

export function getGaugeLayout(size, min, max) {
    const r = size * 0.46
    const longLabels = hasLongTickLabels(min, max)

    return {
        size,
        cx: size / 2,
        cy: size / 2,
        r,
        faceRadius: r,
        arcRadius: r * 0.78,
        arcWidth: r * 0.10,
        tickInnerRadius: r * 0.88,
        tickOuterRadius: r * 0.96,
        tickWidth: Math.max(1.25, r * 0.012),
        tickLabelRadius: longLabels ? r * 0.56 : r * 0.62,
        tickFontSize: longLabels ? r * 0.088 : r * 0.105,
        valueFontSize: longLabels ? r * 0.21 : r * 0.25,
        valueOffsetY: r * 0.29,
        unitFontSize: r * 0.12,
        unitOffsetY: r * 0.46,
        pointerLength: r * 0.56,
        pointerWidth: r * 0.035,
        hubRadius: r * 0.06,
        ticks: 5,
        compactTicks: longLabels,
    }
}

export function formatGaugeTick(value, compact = false) {
    if (compact && Math.abs(value) >= 1000) {
        const next = value / 1000
        return Number.isInteger(next) ? `${next}k` : `${next.toFixed(1)}k`
    }

    if (Math.abs(value) >= 1000) return Math.round(value).toString()

    return Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

/**
 * Formata o valor central do gauge.
 * Para RPM (escala >= 1000) ou qualquer valor: ZERO casas decimais.
 */
export function formatGaugeValue(value) {
    if (value == null) return '--'
    // Sempre zero casas decimais conforme requisito
    return Math.round(value).toString()
}

/**
 * Clamp do valor ao intervalo [min, max] do gauge.
 * Evita que valores brutos absurdos distorçam o ponteiro.
 */
export function clampGaugeValue(value, min, max) {
    if (value == null) return min
    return Math.max(min, Math.min(max, value))
}

/**
 * Converte um valor numérico do intervalo [min, max] para o ângulo usado no arco.
 * O valor já deve estar clampado antes de chamar esta função.
 */
export function valueToAngle(value, min, max) {
    const range = max - min
    const normalized = range === 0 ? 0 : (value - min) / range
    const t = Math.max(0, Math.min(1, normalized))

    return START_ANGLE + t * SWEEP
}

/**
 * Define a cor ativa do ponteiro conforme limites de alerta e crítico.
 */
export function pointerColor(value, warnMax, critMax) {
    if (critMax != null && value >= critMax) return GAUGE_COLORS.critical
    if (warnMax != null && value >= warnMax) return GAUGE_COLORS.warn

    return GAUGE_COLORS.nominal
}
