/**
 * ============================================================================
 * Cockpit.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Segunda tela operacional do dashboard.
 *
 * A Análise fica focada em gráficos. O Cockpit concentra os gauges e a área
 * visual do veículo, pronta para receber câmera, mapa ou desenho real do carro.
 */

import { For } from 'solid-js'
import Gauge from '../Gauge/Gauge.jsx'
import './Cockpit.css'

function Cockpit(props) {
    return (
        <main class="cockpit">
            <section class="cockpit__vehicle">
                <div class="vehicle-visual" aria-label="Veículo">
                    <div class="vehicle-visual__body" />
                    <div class="vehicle-visual__cockpit" />
                    <div class="vehicle-visual__wheel vehicle-visual__wheel--fl" />
                    <div class="vehicle-visual__wheel vehicle-visual__wheel--fr" />
                    <div class="vehicle-visual__wheel vehicle-visual__wheel--rl" />
                    <div class="vehicle-visual__wheel vehicle-visual__wheel--rr" />
                </div>
            </section>

            <section class="cockpit__gauges">
                <For each={props.gauges ?? []}>
                    {(gauge) => (
                        <Gauge
                            signalName={gauge.signalName}
                            label={gauge.label}
                            min={gauge.min}
                            max={gauge.max}
                            unit={gauge.unit}
                            size={180}
                        />
                    )}
                </For>
            </section>
        </main>
    )
}

export default Cockpit
