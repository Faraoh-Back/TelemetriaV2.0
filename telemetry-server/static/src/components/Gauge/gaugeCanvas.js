/**
 * ============================================================================
 * gaugeCanvas.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Camada imperativa de desenho do Gauge.
 *
 * O componente SolidJS apenas decide quando desenhar. Este arquivo decide como
 * desenhar cada parte do canvas:
 *
 *   - drawStatic(): fundo, arco base, zonas, ticks e labels
 *   - drawDynamic(): arco de valor, ponteiro, valor central e unidade
 */

import {
    GAUGE_COLORS,
    START_ANGLE,
    SWEEP,
    formatGaugeTick,
    formatGaugeValue,
    pointerColor,
    valueToAngle,
} from './gaugeUtils'

/**
 * Desenha a camada que muda raramente.
 *
 * Fluxo:
 *   props de escala/limite
 *       -> geometria do arco
 *       -> zonas de alerta
 *       -> ticks e labels fixos
 */
export function drawStatic(ctx, layout, min, max, warnMax, critMax) {
    const { cx, cy, size } = layout

    ctx.clearRect(0, 0, size, size)

    ctx.beginPath()
    ctx.arc(cx, cy, layout.faceRadius, 0, Math.PI * 2)
    ctx.fillStyle = GAUGE_COLORS.face
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, layout.arcRadius, START_ANGLE, START_ANGLE + SWEEP, false)
    ctx.strokeStyle = GAUGE_COLORS.track
    ctx.lineWidth = layout.arcWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    if (warnMax != null) {
        const warnStart = valueToAngle(warnMax, min, max)
        const warnEnd = critMax != null
            ? valueToAngle(critMax, min, max)
            : START_ANGLE + SWEEP

        ctx.beginPath()
        ctx.arc(cx, cy, layout.arcRadius, warnStart, warnEnd, false)
        ctx.strokeStyle = 'rgba(224,155,47,0.35)'
        ctx.lineWidth = layout.arcWidth
        ctx.stroke()
    }

    if (critMax != null) {
        const critStart = valueToAngle(critMax, min, max)

        ctx.beginPath()
        ctx.arc(cx, cy, layout.arcRadius, critStart, START_ANGLE + SWEEP, false)
        ctx.strokeStyle = 'rgba(240,82,82,0.40)'
        ctx.lineWidth = layout.arcWidth
        ctx.stroke()
    }

    for (let i = 0; i <= layout.ticks; i++) {
        const angle = START_ANGLE + (i / layout.ticks) * SWEEP
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        ctx.beginPath()
        ctx.moveTo(
            cx + cos * layout.tickInnerRadius,
            cy + sin * layout.tickInnerRadius
        )
        ctx.lineTo(
            cx + cos * layout.tickOuterRadius,
            cy + sin * layout.tickOuterRadius
        )
        ctx.strokeStyle = GAUGE_COLORS.tick
        ctx.lineWidth = layout.tickWidth
        ctx.lineCap = 'butt'
        ctx.stroke()

        const tickValue = min + (i / layout.ticks) * (max - min)
        const lx = cx + cos * layout.tickLabelRadius
        const ly = cy + sin * layout.tickLabelRadius

        ctx.font = `${layout.tickFontSize}px ui-monospace,Consolas,monospace`
        ctx.fillStyle = GAUGE_COLORS.tickLabel
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
            formatGaugeTick(tickValue, layout.compactTicks),
            lx,
            ly
        )
    }
}

/**
 * Desenha a camada que acompanha os dados em tempo real.
 *
 * Fluxo:
 *   valor atual do store
 *       -> cor por limite
 *       -> arco preenchido
 *       -> ponteiro
 *       -> display central
 */
export function drawDynamic(ctx, layout, value, min, max, unit, warnMax, critMax, hasSignal = true) {
    const { cx, cy, size } = layout

    ctx.clearRect(0, 0, size, size)

    if (!hasSignal) {
        ctx.font = `bold ${layout.valueFontSize}px ui-monospace,Consolas,monospace`
        ctx.fillStyle = 'rgba(244,245,247,0.46)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('--', cx, cy + layout.valueOffsetY)

        ctx.font = `${layout.unitFontSize}px system-ui,sans-serif`
        ctx.fillStyle = 'rgba(154,160,173,0.60)'
        ctx.fillText(unit, cx, cy + layout.unitOffsetY)
        return
    }

    const angle = valueToAngle(value, min, max)
    const color = pointerColor(value, warnMax, critMax)

    ctx.beginPath()
    ctx.arc(cx, cy, layout.arcRadius, START_ANGLE, angle, false)
    ctx.strokeStyle = color
    ctx.lineWidth = layout.arcWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(
        cx + Math.cos(angle) * layout.pointerLength,
        cy + Math.sin(angle) * layout.pointerLength
    )
    ctx.strokeStyle = color
    ctx.lineWidth = layout.pointerWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, layout.hubRadius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    ctx.font = `bold ${layout.valueFontSize}px ui-monospace,Consolas,monospace`
    ctx.fillStyle = GAUGE_COLORS.value
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(formatGaugeValue(value), cx, cy + layout.valueOffsetY)

    ctx.font = `${layout.unitFontSize}px system-ui,sans-serif`
    ctx.fillStyle = GAUGE_COLORS.unit
    ctx.fillText(unit, cx, cy + layout.unitOffsetY)
}
