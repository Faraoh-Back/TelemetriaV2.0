/**
 * Helpers de autenticacao.
 *
 * Isola detalhes de JWT/localStorage/fetch para que as telas apenas expressem
 * o fluxo de produto: autenticar, manter sessao valida e encerrar sessao.
 */

import { getServerConfig } from '../config/serverConfig.js'
import {
    ROLES,
    getDefaultPermissions,
    normalizePermissions,
    normalizeRole,
} from './permissions.js'

const TOKEN_KEY = 'jwt'

export function decodeJwtPayload(token) {
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

function getLegacyDevSession(username, token) {
    return {
        token,
        username,
        role: ROLES.admin,
        permissions: getDefaultPermissions(ROLES.admin),
        mode: 'live',
    }
}

export function buildSessionFromAuthData(data, fallbackUsername) {
    const token = data?.token
    const payload = token ? decodeJwtPayload(token) : null
    const user = data?.user ?? {}
    const fallbackRole = import.meta.env.DEV ? ROLES.admin : ROLES.member
    const role = normalizeRole(user.role ?? payload?.role ?? fallbackRole)
    const username =
        user.username ??
        payload?.username ??
        payload?.sub ??
        fallbackUsername

    return {
        token,
        username,
        role,
        permissions: normalizePermissions(
            user.permissions ?? payload?.permissions,
            role
        ),
        mode: 'live',
    }
}

export function buildSessionFromToken(token, fallbackUsername = 'eracing') {
    try {
        return buildSessionFromAuthData({ token }, fallbackUsername)
    } catch (_) {
        return import.meta.env.DEV ? getLegacyDevSession(fallbackUsername, token) : null
    }
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
    try {
        return buildSessionFromAuthData(data, username)
    } catch (_) {
        if (import.meta.env.DEV) return getLegacyDevSession(username, data.token)
        throw new Error('Sessao invalida retornada pelo servidor.')
    }
}
