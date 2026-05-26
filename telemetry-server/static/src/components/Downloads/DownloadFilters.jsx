function DownloadFilters(props) {
    const setFilter = (key, value) => {
        props.onChange?.({
            ...props.filters,
            [key]: value,
        })
    }

    return (
        <form class="downloads-filters" onSubmit={props.onSubmit}>
            <label class="downloads-field downloads-field--search">
                <span>Busca</span>
                <input
                    type="search"
                    value={props.filters.q}
                    placeholder="Nome, piloto, origem..."
                    onInput={(event) => setFilter('q', event.currentTarget.value)}
                />
            </label>

            <label class="downloads-field">
                <span>Inicio</span>
                <input
                    type="datetime-local"
                    value={props.filters.from}
                    onInput={(event) => setFilter('from', event.currentTarget.value)}
                />
            </label>

            <label class="downloads-field">
                <span>Fim</span>
                <input
                    type="datetime-local"
                    value={props.filters.to}
                    onInput={(event) => setFilter('to', event.currentTarget.value)}
                />
            </label>

            <label class="downloads-field">
                <span>Formato</span>
                <select
                    value={props.filters.format}
                    onChange={(event) => setFilter('format', event.currentTarget.value)}
                >
                    <option value="">Todos</option>
                    <option value="raw">RAW</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                    <option value="motec">MoTeC</option>
                    <option value="other">Outro</option>
                </select>
            </label>

            <label class="downloads-field">
                <span>Status</span>
                <select
                    value={props.filters.status}
                    onChange={(event) => setFilter('status', event.currentTarget.value)}
                >
                    <option value="">Todos</option>
                    <option value="ready">Pronto</option>
                    <option value="processing">Processando</option>
                    <option value="failed">Falhou</option>
                    <option value="expired">Expirado</option>
                </select>
            </label>

            <button class="downloads-button downloads-button--primary" type="submit">
                Filtrar
            </button>
        </form>
    )
}

export default DownloadFilters
