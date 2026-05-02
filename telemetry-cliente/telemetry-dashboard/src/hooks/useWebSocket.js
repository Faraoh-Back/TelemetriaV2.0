/**
 * @file useWebSocket.js
 * @description Hook que gerencia a conexão WebSocket com o servidor Rust.
 *
 * Responsabilidades:
 *   - Conectar ao WS autenticado via JWT (query param ?token=)
 *   - Parsear cada frame JSON recebido e repassar ao signalStore via ingestFrame()
 *   - Reconectar automaticamente em 3s em caso de queda
 *   - Detectar expiração do JWT e chamar onExpired() antes de tentar reconectar
 *
 * Padrão de refs:
 *   Todo valor externo (token, wsUrl, callbacks) é espelhado em uma ref.
 *   Isso permite que o useEffect principal rode apenas uma vez ([] vazio)
 *   sem capturar valores stale em closures — a função connect() interna
 *   sempre lê o valor atual via ref.
 *
 * Uso:
 *   const { status, reconnect } = useWebSocket(token, 'ws://192.168.1.1:8081/ws', onExpired)
 */

import { useEffect, useRef, useState } from 'react'
import { useSignalStore } from '../store/signalStore'

/** Delay de reconexão automática após queda do WS */
const RECONNECT_DELAY_MS = 3000

    /**
     * Status possíveis da conexão — use esses valores na UI (TopBar).
     * @enum {string}
     */
    export const WS_STATUS = {
        CONNECTING:   'connecting',
        CONNECTED:    'connected',
        DISCONNECTED: 'disconnected',
        ERROR:        'error',
    }

    /**
     * Decodifica o payload do JWT sem verificar assinatura.
     * Seguro para uso client-side — serve apenas para checar o campo exp.
     *
     * @param {string} token
     * @returns {{ exp: number } | null}
     */
    function decodeJwtPayload(token) {
        try {
            return JSON.parse(atob(token.split('.')[1]))
        } catch { return null }
    }

    /**
     * Verifica se o JWT já passou da data de expiração.
     * @param {string} token
     * @returns {boolean}
     */
    function isTokenExpired(token) {
        const payload = decodeJwtPayload(token)
        if (!payload?.exp) return true
        return Date.now() / 1000 > payload.exp
    }

    /**
     * Hook principal de WebSocket.
     *
     * @param {string|null} token     - JWT obtido no login. null = não conectar.
     * @param {string}      wsUrl     - URL base do WS (ex: 'ws://192.168.1.1:8081/ws')
     * @param {() => void}  onExpired - Chamado quando o token expirar — deve redirecionar para login
     * @returns {{ status: string, reconnect: () => void }}
     */
    export function useWebSocket(token, wsUrl, onExpired) {
    const [status, setStatus] = useState(WS_STATUS.DISCONNECTED)

    const wsRef      = useRef(null)   // instância atual do WebSocket
    const timerRef   = useRef(null)   // timer de reconexão pendente
    const mountedRef = useRef(false)  // false = componente desmontado, abortar reconexão

    // Pega ingestFrame do store — função estável, não muda entre renders
    const ingestFrame = useSignalStore(s => s.ingestFrame)

    // Espelha cada prop em uma ref para que connect() sempre leia o valor atual
    // sem precisar estar nos deps do useEffect principal
    const tokenRef     = useRef(token)
    const wsUrlRef     = useRef(wsUrl)
    const onExpiredRef = useRef(onExpired)
    const ingestRef    = useRef(ingestFrame)

    useEffect(() => { tokenRef.current     = token      }, [token])
    useEffect(() => { wsUrlRef.current     = wsUrl      }, [wsUrl])
    useEffect(() => { onExpiredRef.current = onExpired  }, [onExpired])
    useEffect(() => { ingestRef.current    = ingestFrame }, [ingestFrame])

    useEffect(() => {
        mountedRef.current = true

        /**
         * Abre uma conexão WebSocket e configura os handlers.
         * Chamada na montagem e automaticamente após cada queda.
         */
        function connect() {
            if (!mountedRef.current) return

            const t = tokenRef.current
            if (!t) return

            // Checa expiração antes de tentar conectar — evita erro 401 desnecessário
            if (isTokenExpired(t)) {
                onExpiredRef.current?.()
                return
            }

            setStatus(WS_STATUS.CONNECTING)

            const ws = new WebSocket(`${wsUrlRef.current}?token=${t}`)
            wsRef.current = ws

            // Conexão estabelecida com sucesso
            ws.onopen = () => {
                if (!mountedRef.current) { ws.close(); return }
                setStatus(WS_STATUS.CONNECTED)
            }

            // Frame recebido — parseia JSON e entrega ao signalStore
            ws.onmessage = (event) => {
                try { ingestRef.current(JSON.parse(event.data)) } catch { /* frame malformado — ignorar */ }
            }

            // Erro de rede — onclose será chamado logo após
            ws.onerror = () => setStatus(WS_STATUS.ERROR)

            // Conexão encerrada — agenda reconexão automática
            ws.onclose = () => {
                if (!mountedRef.current) return
                setStatus(WS_STATUS.DISCONNECTED)
                timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
            }
        }

        connect()

        // Cleanup: cancela reconexão pendente e fecha WS ao desmontar
        return () => {
        mountedRef.current = false
        clearTimeout(timerRef.current)
        wsRef.current?.close()
        }
    }, []) // deps vazios — tudo acessa estado externo via refs

    /**
     * Força reconexão manual imediata (ex: botão na TopBar).
     * Fecha o WS atual — o onclose vai disparar o connect() normalmente.
     */
    const reconnect = () => {
        clearTimeout(timerRef.current)
        wsRef.current?.close()
    }

    return { status, reconnect }
}