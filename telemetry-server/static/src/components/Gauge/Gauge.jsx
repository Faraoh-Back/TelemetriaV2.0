/**
 * ============================================================================
 * Gauge.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Orquestra o gauge de canvas dentro do lifecycle do SolidJS.
 *
 * Este arquivo cuida de:
 *
 *   1. Ler props e store global
 *   2. Configurar refs dos canvases
 *   3. Desenhar a camada estática quando escala/limites mudam
 *   4. Atualizar a camada dinâmica via requestAnimationFrame
 *   5. Renderizar a estrutura visual
 *
 * ARQUITETURA:
 * -------------
 *
 * Gauge.jsx
 *    |
 *    |-- gaugeCanvas.js
 *    |      |-- drawStatic()
 *    |      `-- drawDynamic()
 *    |
 *    |-- gaugeUtils.js
 *    |      |-- valueToAngle()
 *    |      `-- pointerColor()
 *    |
 *    `-- Gauge.css
 *
 * FLUXO:
 * ------
 *
 * onMount()
 *    |
 *    |-- drawStatic()
 *    |      `-- pinta fundo/ticks/zonas uma vez
 *    |
 *    `-- requestAnimationFrame(tick)
 *           |
 *           |-- lê signals[signalName]
 *           |-- ignora se valor não mudou
 *           `-- drawDynamic()
 *
 * createEffect()
 *    `-- redesenha camada estática quando size/min/max/warn/crit mudam
 */

import { createEffect, onCleanup, onMount } from 'solid-js'
import { signals } from '../../store.js'
import { drawDynamic, drawStatic } from './gaugeCanvas'
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

    /**
     * Centraliza os cálculos de geometria.
     *
     * Como as duas camadas usam a mesma escala, manter isso em uma função evita
     * divergência entre canvas estático e canvas dinâmico.
     */
    function getGeometry() {
        const s = size()

        return {
            size: s,
            cx: s / 2,
            cy: s / 2,
            r: s * 0.46,
        }
    }

    /**
     * Redesenha fundo, ticks e faixas de alerta.
     *
     * Essa etapa é separada do ponteiro para reduzir trabalho por frame: o que
     * não muda com frequência fica em um canvas próprio.
     */
    function renderStaticLayer() {
        if (!staticCanvas) return

        const ctx = staticCanvas.getContext('2d')
        const { cx, cy, r } = getGeometry()

        drawStatic(ctx, cx, cy, r, min(), max(), warnMax(), critMax())
    }

    /**
     * Lê o valor mais recente do store e atualiza somente a camada dinâmica.
     *
     * O RAF mantém o ponteiro sincronizado com a tela, enquanto o cache
     * lastValue evita redesenhar quando o sinal ainda não mudou.
     */
    function tick() {
        rafHandle = requestAnimationFrame(tick)

        if (!dynamicCanvas) return

        const entry = signals[props.signalName]
        const value = entry?.value ?? min()

        if (value === lastValue) return

        lastValue = value

        const unit = entry?.unit ?? props.unit ?? ''
        const ctx = dynamicCanvas.getContext('2d')
        const { cx, cy, r } = getGeometry()

        drawDynamic(
            ctx,
            cx,
            cy,
            r,
            value,
            min(),
            max(),
            unit,
            warnMax(),
            critMax()
        )
    }

    /**
     * ==========================================================================
     * LIFECYCLE
     * ==========================================================================
     */
    onMount(() => {
        renderStaticLayer()
        rafHandle = requestAnimationFrame(tick)
    })

    /**
     * Reage a mudanças de configuração.
     *
     * Acessar os getters dentro do effect registra as dependências do Solid para
     * size/min/max/warnMax/critMax. O valor dinâmico continua vindo do RAF.
     */
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

    /**
     * ==========================================================================
     * RENDER
     * ==========================================================================
     */
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
