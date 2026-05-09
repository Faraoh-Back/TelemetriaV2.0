/**
 * ============================================================================
 * Cockpit.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Segunda tela operacional do dashboard.
 *
 * A Análise fica focada em gráficos. O Cockpit concentra a visão operacional:
 * vídeo onboard no centro, gauges nas laterais e slots para anexos do backend
 * como mapa de pista em tempo real.
 */

import { For } from 'solid-js'
import CockpitGauge from './CockpitGauge.jsx'
import RaceVideoPanel from './RaceVideoPanel.jsx'
import TrackMapPanel from './TrackMapPanel.jsx'
import './Cockpit.css'

function Cockpit(props) {
    const gauges = () => props.gauges ?? []
    const leftGauges = () => gauges().filter((_, index) => index % 2 === 0)
    const rightGauges = () => gauges().filter((_, index) => index % 2 === 1)

    const videoSource = () => props.videoSource
    const trackMapSource = () => props.trackMapSource

    return (
        <main class="cockpit">
            <section class="cockpit__rail cockpit__rail--left" aria-label="Gauges principais">
                <For each={leftGauges()}>
                    {(gauge) => <CockpitGauge gauge={gauge} />}
                </For>
            </section>

            <section class="cockpit__center">
                <RaceVideoPanel source={videoSource()} />

                <div class="cockpit__lower-grid">
                    <TrackMapPanel source={trackMapSource()} />
                </div>
            </section>

            <section class="cockpit__rail cockpit__rail--right" aria-label="Gauges auxiliares">
                <For each={rightGauges()}>
                    {(gauge) => <CockpitGauge gauge={gauge} />}
                </For>
            </section>
        </main>
    )
}

export default Cockpit
