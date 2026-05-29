export const ROLES = {
    admin: 'admin',
    member: 'member',
}

export const PERMISSIONS = {
    telemetryStart: 'telemetry:start',
    telemetryStop: 'telemetry:stop',
    logsRead: 'logs:read',
    logsDownload: 'logs:download',
}

export const ROLE_PERMISSIONS = {
    [ROLES.admin]: Object.values(PERMISSIONS),
    [ROLES.member]: [
        PERMISSIONS.logsRead,
        PERMISSIONS.logsDownload,
    ],
}

export function normalizeRole(role) {
    return Object.values(ROLES).includes(role) ? role : ROLES.member
}

export function getDefaultPermissions(role) {
    return ROLE_PERMISSIONS[normalizeRole(role)] ?? ROLE_PERMISSIONS[ROLES.member]
}

export function normalizePermissions(permissions, role) {
    if (Array.isArray(permissions)) {
        return permissions.filter((permission) =>
            Object.values(PERMISSIONS).includes(permission)
        )
    }

    return getDefaultPermissions(role)
}

export function hasPermission(session, permission) {
    return Boolean(session?.permissions?.includes(permission))
}

export function canControlTelemetry(session) {
    return hasPermission(session, PERMISSIONS.telemetryStart) &&
        hasPermission(session, PERMISSIONS.telemetryStop)
}
