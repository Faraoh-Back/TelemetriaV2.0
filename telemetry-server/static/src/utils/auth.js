/**
 * Helpers de autenticacao.
 *
 * Isola detalhes de JWT/localStorage/fetch para que as telas apenas expressem
 * o fluxo de produto: autenticar, manter sessao valida e encerrar sessao.
 */

import { getServerConfig } from '../config/serverConfig.js'

const TOKEN_KEY = 'jwt'
const UI_SESSION_KEY = 'ui-session'

function decodeJwtPayload(token) {
    const [, rawPayload] = token.split('.')
    if (!rawPayload) return null

    const normalizedPayload = rawPayload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(rawPayload.length / 4) * 4, '=')

    return JSON.parse(atob(normalizedPayload))
}

export function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY)
}

export function storeToken(token) {
    localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken() {
    localStorage.removeItem(TOKEN_KEY)
}

export function getStoredUiSession() {
    try {
        return JSON.parse(localStorage.getItem(UI_SESSION_KEY))
    } catch (_) {
        return null
    }
}

export function storeUiSession(session) {
    localStorage.setItem(UI_SESSION_KEY, JSON.stringify(session))
}

export function clearStoredUiSession() {
    localStorage.removeItem(UI_SESSION_KEY)
}

export function createUiSession(username = 'eracing') {
    const session = {
        token: 'ui-preview-session',
        username,
        mode: 'ui',
    }

    storeUiSession(session)
    return session
}

export function isTokenValid(token) {
    if (!token) return false

    try {
        const payload = decodeJwtPayload(token)
        return Boolean(payload?.exp && payload.exp * 1000 > Date.now())
    } catch (_) {
        return false
    }
}

export function getValidStoredToken() {
    const token = getStoredToken()

    if (isTokenValid(token)) return token

    clearStoredToken()
    return null
}

export async function login(username, password) {
    const { apiBase } = getServerConfig()

    let response
    try {
        response = await fetch(`${apiBase}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        })
    } catch (_) {
        throw new Error('Servidor inacessivel. Verifique a rede.')
    }

    const data = await response.json().catch(() => ({}))

    if (!response.ok || !data.ok || !data.token) {
        throw new Error(data.message || 'Credenciais invalidas.')
    }

    storeToken(data.token)
    return data.token
}
