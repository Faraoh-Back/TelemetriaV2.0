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

import { For, Show } from 'solid-js'
import CockpitGauge from './CockpitGauge.jsx'
import RaceVideoPanel from './RaceVideoPanel.jsx'
import TrackMapPanel from './TrackMapPanel.jsx'
import LapTimePanel from './LapTimePanel.jsx'
import TorqueDistribution from './TorqueDistribution.jsx'
import { TRACK_MAP_ENABLED } from '../../config/featureFlags.js'
import './Cockpit.css'

function Cockpit(props) {
    const gauges = () => props.gauges ?? []
    const leftGauges = () => gauges().filter((_, index) => index % 2 === 0)
    const rightGauges = () => gauges().filter((_, index) => index % 2 === 1)

    const videoSource = () => props.videoSource
    const trackMapSource = () => props.trackMapSource
    const trackMap = () => props.trackMap
    const isTelemetryLive = () => Boolean(props.isTelemetryLive)

    return (
        <main class="cockpit">
            <section class="cockpit__rail cockpit__rail--left" aria-label="Gauges principais">
                <For each={leftGauges()}>
                    {(gauge) => <CockpitGauge gauge={gauge} />}
                </For>
            </section>

            <section class="cockpit__center">
                <RaceVideoPanel source={videoSource()} />

                {/* Com TRACK_MAP_ENABLED=false o painel nem entra na árvore: sem
                    memos de overlay, sem polyline no DOM e sem leitura de trackState. */}
                <Show when={TRACK_MAP_ENABLED}>
                    <div class="cockpit__lower-grid">
                        <TrackMapPanel source={trackMapSource()} data={trackMap()} isTelemetryLive={isTelemetryLive()} />
                        <LapTimePanel />
                    </div>
                </Show>
                <Show when={!TRACK_MAP_ENABLED}>
                    <LapTimePanel />
                </Show>
            </section>

            <section class="cockpit__rail cockpit__rail--right" aria-label="Gauges auxiliares">
                <For each={rightGauges()}>
                    {(gauge) => <CockpitGauge gauge={gauge} />}
                </For>
                <TorqueDistribution />
            </section>
        </main>
    )
}

export default Cockpit
