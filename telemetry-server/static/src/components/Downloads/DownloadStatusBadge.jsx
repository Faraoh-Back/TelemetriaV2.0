const STATUS_LABELS = {
    ready: 'Pronto',
    processing: 'Processando',
    pending: 'Na fila',
    generating: 'Gerando .ld',
    downloading: 'Baixando',
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
