// src/components/Gauge.jsx
//
// Canvas gauge — camada estática desenhada uma vez, ponteiro via rAF a 60fps.
//
// Props:
//   signalName  — string  (chave no store)
//   label       — string  (exibido abaixo)
//   min         — number  (default 0)
//   max         — number  (default 100)
//   unit        — string  (fallback se store não tiver)
//   size        — number  px, diâmetro (default 160)
//   warnMax     — number  (opcional) — amarelo acima deste valor
//   critMax     — number  (opcional) — vermelho acima deste valor
//
// Arco: 225° a -45° (270° total), sentido horário, começa embaixo-esquerda.

import { onMount, onCleanup, createEffect } from 'solid-js'
import { signals } from '../store.js'

// ── constantes de geometria ───────────────────────────────────────────────
const START_ANGLE = (225 * Math.PI) / 180   // rad, embaixo-esquerda
const END_ANGLE   = (-45 * Math.PI) / 180   // rad, embaixo-direita
const SWEEP       = (270 * Math.PI) / 180   // arco total

// converte valor [min,max] → ângulo em rad
function valueToAngle(v, min, max) {
    const t = Math.max(0, Math.min(1, (v - min) / (max - min)))
  return START_ANGLE + t * SWEEP
}

// cor do ponteiro conforme limites
function pointerColor(v, warnMax, critMax) {
    if (critMax != null && v >= critMax) return '#e05252'
    if (warnMax != null && v >= warnMax) return '#e09b2f'
    return '#1fb68e'
}

// ── camada estática (fundo, arco, ticks, labels) ─────────────────────────
function drawStatic(ctx, cx, cy, r, min, max, warnMax, critMax) {
    ctx.clearRect(0, 0, cx * 2, cy * 2)

    // fundo
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#22263a'
    ctx.fill()

    // arco de fundo
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.78, START_ANGLE, START_ANGLE + SWEEP, false)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = r * 0.10
    ctx.lineCap = 'round'
    ctx.stroke()

    // zona warn (amarelo)
    if (warnMax != null) {
        const warnStart = valueToAngle(warnMax, min, max)
        const warnEnd   = critMax != null ? valueToAngle(critMax, min, max) : START_ANGLE + SWEEP
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.78, warnStart, warnEnd, false)
        ctx.strokeStyle = 'rgba(224,155,47,0.35)'
        ctx.lineWidth = r * 0.10
        ctx.stroke()
    }

    // zona crit (vermelho)
    if (critMax != null) {
        const critStart = valueToAngle(critMax, min, max)
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.78, critStart, START_ANGLE + SWEEP, false)
        ctx.strokeStyle = 'rgba(224,82,82,0.40)'
        ctx.lineWidth = r * 0.10
        ctx.stroke()
    }

    // ticks (5 divisões principais)
    const TICKS = 5
    for (let i = 0; i <= TICKS; i++) {
        const angle = START_ANGLE + (i / TICKS) * SWEEP
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const r0 = r * 0.88, r1 = r * 0.96
        ctx.beginPath()
        ctx.moveTo(cx + cos * r0, cy + sin * r0)
        ctx.lineTo(cx + cos * r1, cy + sin * r1)
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 1.5
        ctx.lineCap = 'butt'
        ctx.stroke()

        // label numérico
        const val = min + (i / TICKS) * (max - min)
        const lx = cx + cos * (r * 0.70)
        const ly = cy + sin * (r * 0.70)
        ctx.font = `${r * 0.14}px ui-monospace,Consolas,monospace`
        ctx.fillStyle = '#8b92a8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(Number.isInteger(val) ? val : val.toFixed(1), lx, ly)
    }
}

// ── camada dinâmica (arco de valor + ponteiro + display central) ──────────
function drawDynamic(ctx, cx, cy, r, value, min, max, unit, warnMax, critMax) {
    ctx.clearRect(0, 0, cx * 2, cy * 2)

    const angle = valueToAngle(value, min, max)
    const color = pointerColor(value, warnMax, critMax)

    // arco de valor
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.78, START_ANGLE, angle, false)
    ctx.strokeStyle = color
    ctx.lineWidth = r * 0.10
    ctx.lineCap = 'round'
    ctx.stroke()

    // ponteiro (linha fina do centro)
    const pLen = r * 0.58
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(angle) * pLen, cy + Math.sin(angle) * pLen)
    ctx.strokeStyle = color
    ctx.lineWidth = r * 0.035
    ctx.lineCap = 'round'
    ctx.stroke()

    // ponto central
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.06, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()

    // valor numérico
    ctx.font = `bold ${r * 0.26}px ui-monospace,Consolas,monospace`
    ctx.fillStyle = '#e8eaf0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
        Number.isInteger(value) ? value : value.toFixed(1),
        cx, cy + r * 0.28
    )

    // unidade
    ctx.font = `${r * 0.13}px system-ui,sans-serif`
    ctx.fillStyle = '#8b92a8'
    ctx.fillText(unit, cx, cy + r * 0.46)
}

// ── componente ────────────────────────────────────────────────────────────
function Gauge(props) {
    let staticCanvas, dynCanvas
    let rafHandle = null
    let lastValue = null

    const size    = () => props.size    ?? 160
    const min     = () => props.min     ?? 0
    const max     = () => props.max     ?? 100
    const warnMax = () => props.warnMax ?? null
    const critMax = () => props.critMax ?? null

    onMount(() => {
        const s  = size()
        const cx = s / 2, cy = s / 2, r = s * 0.46

        // camada estática — desenhada uma vez
        const sCtx = staticCanvas.getContext('2d')
        drawStatic(sCtx, cx, cy, r, min(), max(), warnMax(), critMax())

        // camada dinâmica — via rAF
        const dCtx = dynCanvas.getContext('2d')

        function tick() {
        rafHandle = requestAnimationFrame(tick)
        const entry = signals[props.signalName]
        const v     = entry?.value ?? min()
        if (v === lastValue) return   // sem mudança — skip
        lastValue = v
        const u = entry?.unit ?? props.unit ?? ''
        drawDynamic(dCtx, cx, cy, r, v, min(), max(), u, warnMax(), critMax())
        }

        rafHandle = requestAnimationFrame(tick)
    })

    // se os limites mudarem em runtime, redesenha a camada estática
    createEffect(() => {
        if (!staticCanvas) return
        const s = size(), cx = s / 2, cy = s / 2, r = s * 0.46
        drawStatic(staticCanvas.getContext('2d'), cx, cy, r, min(), max(), warnMax(), critMax())
    })

    onCleanup(() => {
        if (rafHandle) cancelAnimationFrame(rafHandle)
    })

    return (
        <div style={{
        display: 'inline-flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: '6px',
        }}>
        <div style={{ position: 'relative', width: `${size()}px`, height: `${size()}px` }}>
            <canvas
            ref={staticCanvas}
            width={size()}
            height={size()}
            style={{ position: 'absolute', top: 0, left: 0 }}
            />
            <canvas
            ref={dynCanvas}
            width={size()}
            height={size()}
            style={{ position: 'absolute', top: 0, left: 0 }}
            />
        </div>
        <span style={{
            'font-size': '11px',
            color: 'var(--text2)',
            'text-transform': 'uppercase',
            'letter-spacing': '0.06em',
        }}>
            {props.label ?? props.signalName}
        </span>
        </div>
    )
}

export default Gauge