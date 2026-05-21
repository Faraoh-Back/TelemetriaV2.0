// src/components/StatusBar.jsx
//
// FLUXO:
//
//   signals[name] atualiza via store.js
//       │
//       ▼
//   createEffect detecta mudança e atualiza stats[name]
//   (max, min, soma, count → média)
//       │
//       ▼
//   Card renderiza valor atual, max, min, média
//   SolidJS atualiza apenas o nó de texto que mudou

import { createEffect } from 'solid-js'
import { For } from 'solid-js'
import { createStore } from 'solid-js/store'
import { signals } from '../store.js'
import { PINNED_SIGNALS } from '../config/dashboardConfig.js'

// stats acumula max/min/média por sinal — fora do JSX pra não resetar no re-render
const [stats, setStats] = createStore({})

    function StatusBar() {
        // Para cada sinal pinado, observa mudanças e acumula estatísticas
        for (const { signalName } of PINNED_SIGNALS) {
            createEffect(() => {
            const entry = signals[signalName]
            if (!entry) return

            const val = entry.value

            setStats(signalName, (prev) => {
                if (!prev) return {
                max:   val,
                min:   val,
                sum:   val,
                count: 1,
                }
                return {
                max:   Math.max(prev.max, val),
                min:   Math.min(prev.min, val),
                sum:   prev.sum + val,
                count: prev.count + 1,
                }
            })
            })
        }

        return (
            <div style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '8px',
            padding: '12px 16px',
            background: 'var(--bg2)',
            'border-bottom': '1px solid var(--border)',
            }}>
            <For each={PINNED_SIGNALS}>
                {({ signalName, label }) => (
                <SignalCard signalName={signalName} label={label} />
                )}
            </For>
            </div>
        )
    }

    function SignalCard({ signalName, label }) {
        const entry = () => signals[signalName]
        const stat  = () => stats[signalName]

        const fmt = (v) => v == null ? '—' : (Number.isInteger(v) ? v : v.toFixed(2))
        const avg = () => stat() ? stat().sum / stat().count : null

        return (
            <div style={{
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            'border-radius': '8px',
            padding: '10px 14px',
            'min-width': '140px',
            }}>
            <div style={{ color: 'var(--text2)', 'font-size': '11px', 'margin-bottom': '4px' }}>
                {label}
            </div>
            <div style={{ color: 'var(--accent)', 'font-size': '20px', 'font-weight': '600', 'font-family': 'monospace' }}>
                {fmt(entry()?.value)} <span style={{ 'font-size': '11px', color: 'var(--text2)' }}>{entry()?.unit ?? ''}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', 'margin-top': '6px', 'font-size': '11px', color: 'var(--text2)', 'font-family': 'monospace' }}>
                <span>↑ {fmt(stat()?.max)}</span>
                <span>↓ {fmt(stat()?.min)}</span>
                <span>~ {fmt(avg())}</span>
            </div>
            </div>
        )
    }

export default StatusBar