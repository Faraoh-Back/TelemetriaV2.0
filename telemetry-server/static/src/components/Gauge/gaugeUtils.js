/**
 * ============================================================================
 * gaugeUtils.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Utilitários puros do Gauge.
 *
 * Este arquivo não conhece SolidJS, DOM ou Canvas. Ele concentra as regras de
 * conversão de valor e estado visual para que o desenho e o componente possam
 * reutilizar a mesma lógica sem acoplamento.
 */

export const START_ANGLE = (225 * Math.PI) / 180
export const SWEEP = (270 * Math.PI) / 180

/**
 * Converte um valor numérico do intervalo [min, max] para o ângulo usado no arco.
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
    if (critMax != null && value >= critMax) return '#e05252'
    if (warnMax != null && value >= warnMax) return '#e09b2f'

    return '#1fb68e'
}
