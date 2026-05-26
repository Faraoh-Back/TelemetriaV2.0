const STATUS_LABELS = {
    ready: 'Pronto',
    processing: 'Processando',
    failed: 'Falhou',
    expired: 'Expirado',
}

function DownloadStatusBadge(props) {
    const status = () => props.status || 'processing'

    return (
        <span
            classList={{
                'download-status': true,
                [`download-status--${status()}`]: true,
            }}
        >
            {STATUS_LABELS[status()] ?? status()}
        </span>
    )
}

export default DownloadStatusBadge
