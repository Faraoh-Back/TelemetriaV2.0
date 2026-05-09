/**
 * ============================================================================
 * telemetryUtils.js
 * ============================================================================
 *
 * Utilitários reutilizáveis para o dashboard de telemetria:
 *   - clampRpm() / normalizeRpm(): normalização para gauges de RPM
 *   - SIGNAL_COLORS / getSignalColor(): paleta fixa por índice
 *   - getYDomain(): domínio do eixo Y por tipo de sinal
 *   - formatValue2() / formatRpm(): formatação numérica
 */

// ─── NORMALIZAÇÃO DE RPM ──────────────────────────────────────────────────────

export const RPM_CLAMP_MIN = 0
export const RPM_CLAMP_MAX = 10000

/**
 * Limita o valor de RPM ao intervalo operacional do cockpit/gráficos.
 * Use este valor para o texto central do gauge.
 */
export function clampRpm(value) {
    if (value == null) return 0
    return Math.max(RPM_CLAMP_MIN, Math.min(RPM_CLAMP_MAX, value))
}

/**
 * Normaliza RPM para [0, 1] após o clamp.
 * Para gauges que trabalham com escala percentual/angular.
 */
export function normalizeRpm(value) {
    const clamped = clampRpm(value)
    return (clamped - RPM_CLAMP_MIN) / (RPM_CLAMP_MAX - RPM_CLAMP_MIN)
}

// ─── PALETA FIXA DE CORES ─────────────────────────────────────────────────────
//
// A mesma cor para o mesmo índice de sinal em gráfico, legenda e card.

export const SIGNAL_COLORS = [
    '#dd663f', // laranja
    '#3d8ef0', // azul
    '#1fb68e', // verde-teal
    '#f59e0b', // âmbar
    '#a78bfa', // violeta
    '#f472b6', // rosa
    '#34d399', // esmeralda
    '#fb7185', // vermelho suave
]

/**
 * Retorna a cor fixa para um índice de série (cicla se necessário).
 */
export function getSignalColor(index) {
    return SIGNAL_COLORS[index % SIGNAL_COLORS.length]
}

// ─── DOMÍNIO DO EIXO Y ────────────────────────────────────────────────────────

function inferDomainType(signalName) {
    if (!signalName) return 'default'
    if (/^act_Speed_/i.test(signalName) || /\brpm\b/i.test(signalName)) return 'rpm'
    if (/acc_/i.test(signalName) || /^ventor_linear_acc_/i.test(signalName)) return 'acceleration'
    if (/temperature|temp/i.test(signalName)) return 'temperature'
    if (/voltage|dcbus/i.test(signalName)) return 'voltage'
    if (/power/i.test(signalName)) return 'power'
    return 'default'
}

const FIXED_DOMAINS = {
    rpm:          [0,      10000],
    acceleration: [-15,    15],
    temperature:  [0,      120],
    voltage:      [0,      500],
    power:        [-100,   100],
}

/**
 * Retorna o domínio [min, max] para o eixo Y.
 *
 * - Para tipos conhecidos: retorna o domínio fixo.
 * - Para tipo 'default': retorna [null, null] — o caller deve calcular
 *   dinamicamente com os dados reais.
 *
 * @param {string[]} signalNames — nomes das séries
 * @param {number[]|null} values — valores flat (usado apenas quando tipo = default)
 * @returns {[number|null, number|null]}
 */
export function getYDomain(signalNames, values) {
    const type = inferDomainType(signalNames?.[0] ?? '')

    if (FIXED_DOMAINS[type]) {
        return FIXED_DOMAINS[type]
    }

    // Tipo desconhecido: calcula dinamicamente se houver valores
    if (!values || values.length === 0) return [null, null]

    const finite = values.filter(v => v != null && isFinite(v))
    if (finite.length === 0) return [null, null]

    const dataMin = Math.min(...finite)
    const dataMax = Math.max(...finite)

    if (dataMin === dataMax) {
        const margin = Math.abs(dataMin) * 0.1 || 1
        return [dataMin - margin, dataMax + margin]
    }

    const range = dataMax - dataMin
    const margin = range * 0.10
    return [dataMin - margin, dataMax + margin]
}

// ─── FORMATAÇÃO NUMÉRICA ──────────────────────────────────────────────────────

/** Formata com 2 casas decimais. Retorna '—' para nulos. */
export function formatValue2(value) {
    if (value == null || !isFinite(value)) return '—'
    return Number(value).toFixed(2)
}

/** Formata RPM com zero casas decimais. */
export function formatRpm(value) {
    if (value == null) return '--'
    return Math.round(value).toString()
}
