use crate::models::Claims;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};

pub const ROLE_ADMIN: &str = "admin";
pub const ROLE_MEMBER: &str = "member";
pub const PERMISSION_TELEMETRY_START: &str = "telemetry:start";
pub const PERMISSION_TELEMETRY_STOP: &str = "telemetry:stop";
pub const PERMISSION_LOGS_READ: &str = "logs:read";
pub const PERMISSION_LOGS_DOWNLOAD: &str = "logs:download";

pub fn default_member_role() -> String {
    ROLE_MEMBER.to_string()
}

pub fn normalize_role(role: &str) -> &'static str {
    if role.eq_ignore_ascii_case("admin") {
        ROLE_ADMIN
    } else {
        ROLE_MEMBER
    }
}

pub fn permissions_for_role(role: &str) -> Vec<String> {
    match role {
        ROLE_ADMIN => vec![
            PERMISSION_TELEMETRY_START.to_string(),
            PERMISSION_TELEMETRY_STOP.to_string(),
            PERMISSION_LOGS_READ.to_string(),
            PERMISSION_LOGS_DOWNLOAD.to_string(),
        ],
        ROLE_MEMBER => vec![PERMISSION_LOGS_READ.to_string()],
        _ => vec![],
    }
}

pub fn claims_has_permission(claims: &Claims, permission: &str) -> bool {
    claims.permissions.iter().any(|p| p == permission)
}

pub fn generate_jwt(username: &str, role: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::hours(crate::config::JWT_EXPIRY_HOURS);

    let norm_role = normalize_role(role);
    let perms = permissions_for_role(norm_role);

    let claims = Claims {
        sub: username.to_string(),
        role: norm_role.to_string(),
        permissions: perms,
        iat: now.timestamp(),
        exp: exp.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(crate::config::get_jwt_secret().as_bytes()),
    )
}

pub fn validate_jwt_claims(token: &str) -> Option<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(crate::config::get_jwt_secret().as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .ok()
}

pub fn validate_jwt(token: &str) -> bool {
    validate_jwt_claims(token).is_some()
}

pub async fn request_has_permission(request: &str, permission: &str) -> bool {
    let token = if let Some(t) = extract_bearer_token(request) {
        t
    } else if let Some(t) = extract_query_token(request) {
        t
    } else {
        return false;
    };

    if let Some(claims) = validate_jwt_claims(&token) {
        claims_has_permission(&claims, permission)
    } else {
        false
    }
}

pub fn extract_bearer_token(request: &str) -> Option<String> {
    for line in request.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with("authorization:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 3 && parts[1].eq_ignore_ascii_case("bearer") {
                return Some(parts[2].to_string());
            }
        }
    }
    None
}

pub fn extract_query_token(request: &str) -> Option<String> {
    if let Some(first_line) = request.lines().next() {
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            let path = parts[1];
            if let Some(q_idx) = path.find('?') {
                let qs = &path[q_idx + 1..];
                for param in qs.split('&') {
                    if let Some((k, v)) = param.split_once('=') {
                        if k == "token" {
                            return Some(v.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}
