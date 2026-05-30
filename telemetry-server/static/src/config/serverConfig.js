/**
 * Configuracao central dos endpoints usados pelo frontend.
 *
 * Mantem a regra que existia no HTML legado: a interface fala com o host atual
 * e usa a porta do servidor de telemetria quando estiver rodando pelo Vite.
 */

const DEFAULT_SERVER_PORT = '8081'
const BACKEND_PORT = DEFAULT_SERVER_PORT

function getServerHost() {
    return window.location.hostname || 'localhost'
}

function getServerPort() {
    const { port } = window.location

    // Em desenvolvimento o Vite pode cair em 5173, 5174, etc.; a API/WS
    // continuam expostos pelo servidor de telemetria na porta 8081.
    if (!port || port !== BACKEND_PORT) return BACKEND_PORT

    return port
}

function getHttpProtocol() {
    return window.location.protocol === 'https:' ? 'https' : 'http'
}

function getWsProtocol() {
    return window.location.protocol === 'https:' ? 'wss' : 'ws'
}

export function getServerConfig() {
    const host = getServerHost()
    const port = getServerPort()

    return {
        host,
        port,
        address: `${host}:${port}`,
        apiBase: import.meta.env.DEV ? '' : `${getHttpProtocol()}://${host}:${port}`,
        wsBase: `${getWsProtocol()}://${host}:${port}`,
    }
}
