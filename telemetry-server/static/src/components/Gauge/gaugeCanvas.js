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
    START_ANGLE,
    SWEEP,
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
export function drawStatic(ctx, cx, cy, r, min, max, warnMax, critMax) {
    ctx.clearRect(0, 0, cx * 2, cy * 2)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#22263a'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.78, START_ANGLE, START_ANGLE + SWEEP, false)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = r * 0.10
    ctx.lineCap = 'round'
    ctx.stroke()

    if (warnMax != null) {
        const warnStart = valueToAngle(warnMax, min, max)
        const warnEnd = critMax != null
            ? valueToAngle(critMax, min, max)
            : START_ANGLE + SWEEP

        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.78, warnStart, warnEnd, false)
        ctx.strokeStyle = 'rgba(224,155,47,0.35)'
        ctx.lineWidth = r * 0.10
        ctx.stroke()
    }

    if (critMax != null) {
        const critStart = valueToAngle(critMax, min, max)

        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.78, critStart, START_ANGLE + SWEEP, false)
        ctx.strokeStyle = 'rgba(224,82,82,0.40)'
        ctx.lineWidth = r * 0.10
        ctx.stroke()
    }

    const ticks = 5

    for (let i = 0; i <= ticks; i++) {
        const angle = START_ANGLE + (i / ticks) * SWEEP
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const r0 = r * 0.88
        const r1 = r * 0.96

        ctx.beginPath()
        ctx.moveTo(cx + cos * r0, cy + sin * r0)
        ctx.lineTo(cx + cos * r1, cy + sin * r1)
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 1.5
        ctx.lineCap = 'butt'
        ctx.stroke()

        const tickValue = min + (i / ticks) * (max - min)
        const lx = cx + cos * (r * 0.70)
        const ly = cy + sin * (r * 0.70)

        ctx.font = `${r * 0.14}px ui-monospace,Consolas,monospace`
        ctx.fillStyle = '#8b92a8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
            Number.isInteger(tickValue) ? tickValue : tickValue.toFixed(1),
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
export function drawDynamic(ctx, cx, cy, r, value, min, max, unit, warnMax, critMax) {
    ctx.clearRect(0, 0, cx * 2, cy * 2)

    const angle = valueToAngle(value, min, max)
    const color = pointerColor(value, warnMax, critMax)

    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.78, START_ANGLE, angle, false)
    ctx.strokeStyle = color
    ctx.lineWidth = r * 0.10
    ctx.lineCap = 'round'
    ctx.stroke()

    const pointerLength = r * 0.58

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(
        cx + Math.cos(angle) * pointerLength,
        cy + Math.sin(angle) * pointerLength
    )
    ctx.strokeStyle = color
    ctx.lineWidth = r * 0.035
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.06, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    ctx.font = `bold ${r * 0.26}px ui-monospace,Consolas,monospace`
    ctx.fillStyle = '#e8eaf0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
        Number.isInteger(value) ? value : value.toFixed(1),
        cx,
        cy + r * 0.28
    )

    ctx.font = `${r * 0.13}px system-ui,sans-serif`
    ctx.fillStyle = '#8b92a8'
    ctx.fillText(unit, cx, cy + r * 0.46)
}
