/**
 * ============================================================================
 * Gauge.jsx  (atualizado)
 * ============================================================================
 *
 * Alterações:
 *   - Antes de passar o valor ao drawDynamic, aplica clampGaugeValue()
 *     para normalizar ao intervalo [min, max] do gauge.
 *   - formatGaugeValue() exibe zero casas decimais (já atualizado em gaugeUtils).
 *   - A unidade continua exibida ao lado do valor textual.
 */

import { createEffect, onCleanup, onMount } from 'solid-js'
import { signals } from '../../store.js'
import { drawDynamic, drawStatic } from './gaugeCanvas'
import { clampGaugeValue, getGaugeLayout } from './gaugeUtils'
import './Gauge.css'

function Gauge(props) {
    let staticCanvas
    let dynamicCanvas
    let rafHandle = null
    let lastValue = null

    const size = () => props.size ?? 160
    const min = () => props.min ?? 0
    const max = () => props.max ?? 100
    const warnMax = () => props.warnMax ?? null
    const critMax = () => props.critMax ?? null

    function getLayout() {
        return getGaugeLayout(size(), min(), max())
    }

    function renderStaticLayer() {
        if (!staticCanvas) return
        const ctx = staticCanvas.getContext('2d')
        drawStatic(ctx, getLayout(), min(), max(), warnMax(), critMax())
    }

    function tick() {
        rafHandle = requestAnimationFrame(tick)
        if (!dynamicCanvas) return

        const entry = signals[props.signalName]
        const hasSignal = entry?.value != null

        // ── NORMALIZAÇÃO ──────────────────────────────────────────────────────
        // Clamp do valor bruto ao intervalo [min, max] antes de renderizar.
        // Isso evita que RPMs fora da escala do gauge distorçam o ponteiro.
        const rawValue = hasSignal ? entry.value : min()
        const value = clampGaugeValue(rawValue, min(), max())

        const frameKey = hasSignal ? value : '__empty__'
        if (frameKey === lastValue) return
        lastValue = frameKey

        const unit = entry?.unit ?? props.unit ?? ''
        const ctx = dynamicCanvas.getContext('2d')

        drawDynamic(
            ctx,
            getLayout(),
            value,
            min(),
            max(),
            unit,
            warnMax(),
            critMax(),
            hasSignal
        )
    }

    onMount(() => {
        renderStaticLayer()
        rafHandle = requestAnimationFrame(tick)
    })

    createEffect(() => {
        size()
        min()
        max()
        warnMax()
        critMax()
        renderStaticLayer()
    })

    onCleanup(() => {
        if (rafHandle) cancelAnimationFrame(rafHandle)
    })

    return (
        <div class="gauge">
            <div
                class="gauge__canvas-stack"
                style={{
                    width: `${size()}px`,
                    height: `${size()}px`,
                }}
            >
                <canvas
                    ref={staticCanvas}
                    class="gauge__canvas"
                    width={size()}
                    height={size()}
                />
                <canvas
                    ref={dynamicCanvas}
                    class="gauge__canvas"
                    width={size()}
                    height={size()}
                />
            </div>

            <span class="gauge__label">
                {props.label ?? props.signalName}
            </span>
        </div>
    )
}

export default Gauge