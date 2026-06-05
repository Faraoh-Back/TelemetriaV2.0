/**
 * Helpers de autenticacao.
 *
 * Isola detalhes de JWT/localStorage/fetch para que as telas apenas expressem
 * o fluxo de produto: autenticar, manter sessao valida e encerrar sessao.
 */

import { getServerConfig } from '../config/serverConfig.js'
import {
    ROLES,
    normalizePermissions,
    normalizeRole,
} from './permissions.js'

const TOKEN_KEY = 'jwt'
const DEV_LOGIN_USERNAME = 'admin'
const DEV_LOGIN_PASSWORD = 'admin123'

function encodeBase64Url(value) {
    return btoa(JSON.stringify(value))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function buildDevToken(username) {
    const now = Math.floor(Date.now() / 1000)
    return [
        encodeBase64Url({ alg: 'none', typ: 'JWT' }),
        encodeBase64Url({
            sub: username,
            username,
            role: ROLES.admin,
            permissions: normalizePermissions(null, ROLES.admin),
            iat: now,
            exp: now + 8 * 60 * 60,
        }),
        'dev',
    ].join('.')
}

function buildDevSession(username) {
    const token = buildDevToken(username)
    storeToken(token)
    return buildSessionFromAuthData({
        token,
        user: {
            username,
            role: ROLES.admin,
            permissions: normalizePermissions(null, ROLES.admin),
        },
    }, username)
}

function canUseDevLogin(username, password) {
    return (
        import.meta.env.DEV &&
        username === DEV_LOGIN_USERNAME &&
        password === DEV_LOGIN_PASSWORD
    )
}

export function decodeJwtPayload(token) {
    const [, rawPayload] = token.split('.')
    if (!rawPayload) return null

    const normalizedPayload = rawPayload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(rawPayload.length / 4) * 4, '=')

    return JSON.parse(atob(normalizedPayload))
}

function getJwtPayload(token) {
    try {
        return decodeJwtPayload(token)
    } catch (_) {
        return null
    }
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

    const payload = getJwtPayload(token)
    return Boolean(payload?.exp && payload.exp * 1000 > Date.now())
}

export function getValidStoredToken() {
    const token = getStoredToken()

    if (isTokenValid(token)) return token

    clearStoredToken()
    return null
}

export function buildSessionFromAuthData(data, fallbackUsername) {
    const token = data?.token
    const payload = token ? getJwtPayload(token) : null
    const user = data?.user ?? {}
    const role = normalizeRole(user.role ?? payload?.role ?? ROLES.member)
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
        return null
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
        if (canUseDevLogin(username, password)) {
            return buildDevSession(username)
        }

        throw new Error('Servidor inacessivel. Verifique a rede.')
    }

    const data = await response.json().catch(() => ({}))

    if (!response.ok || !data.ok || !data.token) {
        if (canUseDevLogin(username, password)) {
            return buildDevSession(username)
        }

        throw new Error(data.message || 'Credenciais invalidas.')
    }

    storeToken(data.token)
    try {
        return buildSessionFromAuthData(data, username)
    } catch (_) {
        throw new Error('Sessao invalida retornada pelo servidor.')
    }
}
