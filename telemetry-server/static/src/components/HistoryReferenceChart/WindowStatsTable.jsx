import { For, Show } from 'solid-js'

import { formatValue2 } from '../../utils/telemetryUtils.js'
import { formatDuration } from './historyUtils'

function WindowStatsTable(props) {
    return (
        <div class="history-reference__window">
            <div class="history-reference__window-header">
                <span>Resumo da janela selecionada</span>
                <strong>
                    {formatDuration(props.range?.startSeconds)} - {formatDuration(props.range?.endSeconds)}
                </strong>
            </div>

            <Show
                when={(props.rows ?? []).length > 0}
                fallback={<span class="history-reference__samples-empty">Selecione sinais para calcular a janela.</span>}
            >
                <div class="history-reference__window-columns">
                    <span>Sinal</span>
                    <span>Min</span>
                    <span>Media</span>
                    <span>Max</span>
                    <span>Unidade</span>
                </div>
                <div class="history-reference__window-grid">
                    <For each={props.rows ?? []}>
                        {(row) => (
                            <div class="history-reference__window-row" title={row.name}>
                                <span class="history-reference__sample-name">{row.name}</span>
                                <span>
                                    <small>Min</small>
                                    <strong>{formatValue2(row.stats?.min)}</strong>
                                </span>
                                <span>
                                    <small>Media</small>
                                    <strong>{formatValue2(row.stats?.avg)}</strong>
                                </span>
                                <span>
                                    <small>Max</small>
                                    <strong>{formatValue2(row.stats?.max)}</strong>
                                </span>
                                <em>{row.unit}</em>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

export default WindowStatsTable
