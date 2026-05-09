import Gauge from '../Gauge/Gauge.jsx'

function CockpitGauge({ gauge, size = 168 }) {
    return (
        <div class="cockpit-gauge">
            <Gauge
                signalName={gauge.signalName}
                label={gauge.label}
                min={gauge.min}
                max={gauge.max}
                unit={gauge.unit}
                warnMax={gauge.warnMax}
                critMax={gauge.critMax}
                size={size}
            />
        </div>
    )
}

export default CockpitGauge
