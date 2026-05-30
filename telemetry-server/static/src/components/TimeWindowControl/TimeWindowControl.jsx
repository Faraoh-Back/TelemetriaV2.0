/**
 * ============================================================================
 * TimeWindowControl.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Controle visual da janela temporal usada pelos gráficos.
 *
 * O componente é controlado pelo App: recebe o valor atual em segundos e emite
 * onChange quando o usuário troca entre 10s, 30s, 60s e 5min.
 */

import { For } from 'solid-js'
import './TimeWindowControl.css'

const OPTIONS = [
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '60s', value: 60 },
    { label: '5min', value: 300 },
]

function TimeWindowControl(props) {
    return (
        <div class="time-window-control" aria-label="Janela temporal dos gráficos">
            <span class="time-window-control__label">Janela</span>

            <div class="time-window-control__options">
                <For each={OPTIONS}>
                    {(option) => (
                        <button
                            classList={{
                                'time-window-control__option': true,
                                'time-window-control__option--active':
                                    props.value === option.value,
                            }}
                            type="button"
                            onClick={() => props.onChange?.(option.value)}
                        >
                            {option.label}
                        </button>
                    )}
                </For>
            </div>
        </div>
    )
}

export default TimeWindowControl
