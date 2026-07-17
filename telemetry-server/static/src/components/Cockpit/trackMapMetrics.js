function clamp01(value) {
    if (!Number.isFinite(value)) return 0
    if (value < 0) return 0
    if (value > 1) return 1
    return value
}

function finitePoint(point) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null
    return point
}

function boundsFromPoints(points) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of points) {
        if (!finitePoint(point)) continue
        minX = Math.min(minX, point[0])
        maxX = Math.max(maxX, point[0])
        minY = Math.min(minY, point[1])
        maxY = Math.max(maxY, point[1])
    }

    if (!Number.isFinite(minX)) return null
    return { minX, maxX, minY, maxY }
}

function buildProjector(track, points) {
    const bounds = track?.bounds ?? boundsFromPoints(points)
    if (!bounds) return null

    const minX = Number(bounds.minX)
    const maxX = Number(bounds.maxX)
    const minY = Number(bounds.minY)
    const maxY = Number(bounds.maxY)
    if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null

    const spanX = Math.max(maxX - minX, 1e-6)
    const spanY = Math.max(maxY - minY, 1e-6)
    const span = Math.max(spanX, spanY)
    const pad = span * 0.08
    const paddedSpan = span + pad * 2
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    return ([x, y]) => ({
        x: 50 + ((x - centerX) / paddedSpan) * 100,
        y: 50 - ((y - centerY) / paddedSpan) * 100,
    })
}

function buildTrackSegments(points) {
    const segments = []
    let totalLength = 0

    for (let i = 0; i < points.length; i += 1) {
        const start = points[i]
        const end = points[(i + 1) % points.length]
        const dx = end[0] - start[0]
        const dy = end[1] - start[1]
        const length = Math.hypot(dx, dy)
        segments.push({ start, end, dx, dy, length, cumulativeStart: totalLength })
        totalLength += length
    }

    return { segments, totalLength }
}

function projectVehicleOnTrack(points, vehicle) {
    if (!Array.isArray(points) || points.length < 2 || !vehicle) return null
    if (!Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.y)) return null

    const { segments, totalLength } = buildTrackSegments(points)
    if (!Number.isFinite(totalLength) || totalLength <= 0) return null

    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestArcLength = 0

    for (const segment of segments) {
        if (segment.length <= 0) continue

        const vx = vehicle.x - segment.start[0]
        const vy = vehicle.y - segment.start[1]
        const dot = vx * segment.dx + vy * segment.dy
        const segLenSq = segment.length * segment.length
        const t = clamp01(dot / segLenSq)

        const projX = segment.start[0] + segment.dx * t
        const projY = segment.start[1] + segment.dy * t
        const distSq = (vehicle.x - projX) ** 2 + (vehicle.y - projY) ** 2

        if (distSq < bestDistanceSq) {
            bestDistanceSq = distSq
            bestArcLength = segment.cumulativeStart + segment.length * t
        }
    }

    return clamp01(bestArcLength / totalLength)
}

function formatMeters(value) {
    if (!Number.isFinite(value)) return '--'
    return `${Math.max(0, value).toFixed(0)} m`
}

function formatKmh(value) {
    if (!Number.isFinite(value)) return '--'
    return `${Math.max(0, value).toFixed(1)} km/h`
}

function metersPerSecondToKmh(value) {
    if (!Number.isFinite(value)) return value
    return value * 3.6
}

function formatHeading(value) {
    if (!Number.isFinite(value)) return '--'
    return `${Math.round(value)}°`
}

export function buildTrackOverlay(track, vehicle) {
    const points = track?.points ?? []
    const project = buildProjector(track, points)
    const displayPoints = project
        ? points
            .filter(finitePoint)
            .map(project)
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        : []
    const start = displayPoints[0] ?? null
    const vehicleRawPoint = vehicle
        ? [
            Number.isFinite(vehicle.x_m) ? vehicle.x_m : vehicle.x,
            Number.isFinite(vehicle.y_m) ? vehicle.y_m : vehicle.y,
        ]
        : null
    const vehiclePoint = vehicle
        && project
        && Number.isFinite(vehicleRawPoint[0])
        && Number.isFinite(vehicleRawPoint[1])
        ? project(vehicleRawPoint)
        : null

    const trackLengthM = Number(track?.length_m)
    const vehicleForProjection = vehicleRawPoint
        ? { x: vehicleRawPoint[0], y: vehicleRawPoint[1] }
        : null
    const progressFromProjection = projectVehicleOnTrack(points, vehicleForProjection)
    const progressFromDistance = Number.isFinite(vehicle?.distance_m) && Number.isFinite(trackLengthM) && trackLengthM > 0
        ? (vehicle.distance_m % trackLengthM) / trackLengthM
        : null
    const lapProgress = progressFromProjection ?? progressFromDistance
    const progressPct = Number.isFinite(lapProgress) ? clamp01(lapProgress) * 100 : null
    const remainingM = Number.isFinite(trackLengthM) && Number.isFinite(lapProgress)
        ? trackLengthM * (1 - clamp01(lapProgress))
        : null

    return {
        start,
        vehiclePoint,
        displayPoints,
        stats: [
            { label: 'Pista', value: formatMeters(trackLengthM) },
            { label: 'Falta', value: formatMeters(remainingM) },
            { label: 'Volta', value: Number.isFinite(progressPct) ? `${progressPct.toFixed(1)}%` : '--' },
            { label: 'Vel', value: formatKmh(metersPerSecondToKmh(vehicle?.speed)) },
            { label: 'Rumo', value: formatHeading(vehicle?.heading) },
        ],
    }
}
