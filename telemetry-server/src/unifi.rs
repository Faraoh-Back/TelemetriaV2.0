use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tracing::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiStats {
    pub rssi: Option<i32>,
    pub tx_rate: Option<u64>,
    pub rx_rate: Option<u64>,
    pub tx_retries: Option<u64>,
    pub cu_total: Option<u32>,
    pub noise_floor: Option<i32>,
    pub channel_width: Option<String>,
    pub uptime: Option<u64>,
    pub last_seen: Option<u64>,
}

#[derive(Deserialize)]
struct UnifiResponse {
    data: Option<Vec<UnifiDevice>>,
}

#[derive(Deserialize)]
struct UnifiDevice {
    name: Option<String>,
    uptime: Option<u64>,
    last_seen: Option<u64>,
    uplink: Option<UnifiUplink>,
    radio_table_stats: Option<Vec<UnifiRadioStats>>,
}

#[derive(Deserialize)]
struct UnifiUplink {
    rssi: Option<i32>,
    rx_rate: Option<u64>,
    tx_rate: Option<u64>,
}

#[derive(Deserialize)]
struct UnifiRadioStats {
    radio: Option<String>,
    ht: Option<String>,
    cu_total: Option<u32>,
    tx_retries: Option<u64>,
    noise_floor: Option<i32>,
}

pub type SharedUnifiStats = Arc<RwLock<Option<UnifiStats>>>;

/// Inicia a tarefa em background que faz polling da API do UniFi Controller a cada 3 segundos.
pub fn start_unifi_poller(shared_stats: SharedUnifiStats) {
    let unifi_ip = std::env::var("UNIFI_IP").unwrap_or_else(|_| "192.168.10.1".to_string());
    let api_key = std::env::var("UNIFI_API_KEY")
        .unwrap_or_else(|_| "yz6B2yD1bEISOj_7DrBWTDQbChCok7S5".to_string());
    let device_name = std::env::var("UNIFI_DEVICE_NAME").unwrap_or_else(|_| "AC_car_laranja".to_string());

    tokio::spawn(async move {
        info!("📶 Poller UniFi iniciado. Monitorando dispositivo '{}' no IP '{}'", device_name, unifi_ip);
        
        let client_res = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_millis(1000))
            .build();

        let client = match client_res {
            Ok(c) => c,
            Err(e) => {
                error!("❌ Erro ao construir cliente HTTP reqwest para UniFi: {:?}", e);
                return;
            }
        };

        let mut use_direct_path = false;
        let mut interval = tokio::time::interval(Duration::from_secs(3));

        loop {
            interval.tick().await;

            let url = if use_direct_path {
                format!("https://{}/api/s/default/stat/device", unifi_ip)
            } else {
                format!("https://{}/proxy/network/api/s/default/stat/device", unifi_ip)
            };

            let req = client.get(&url)
                .header("Accept", "application/json")
                .header("X-API-Key", &api_key)
                .header("Authorization", format!("Bearer {}", &api_key));

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.json::<UnifiResponse>().await {
                            Ok(payload) => {
                                if let Some(devices) = payload.data {
                                    let car_device = devices.iter().find(|d| {
                                        d.name.as_deref() == Some(&device_name)
                                    });

                                    if let Some(dev) = car_device {
                                        // Puxa as estatísticas de uplink
                                        let (rssi, rx_rate, tx_rate) = if let Some(ref up) = dev.uplink {
                                            (up.rssi, up.rx_rate, up.tx_rate)
                                        } else {
                                            (None, None, None)
                                        };

                                        // Puxa as estatísticas de rádio (5 GHz, normalmente marcado como "na")
                                        let mut ht = None;
                                        let mut cu_total = None;
                                        let mut tx_retries = None;
                                        let mut noise_floor = None;

                                        if let Some(ref radios) = dev.radio_table_stats {
                                            if let Some(r5g) = radios.iter().find(|r| r.radio.as_deref() == Some("na")) {
                                                ht = r5g.ht.clone();
                                                cu_total = r5g.cu_total;
                                                tx_retries = r5g.tx_retries;
                                                noise_floor = r5g.noise_floor;
                                            }
                                        }

                                        let stats = UnifiStats {
                                            rssi,
                                            tx_rate,
                                            rx_rate,
                                            tx_retries,
                                            cu_total,
                                            noise_floor,
                                            channel_width: ht,
                                            uptime: dev.uptime,
                                            last_seen: dev.last_seen,
                                        };

                                        // Atualiza o estado compartilhado
                                        if let Ok(mut lock) = shared_stats.write() {
                                            *lock = Some(stats);
                                        }
                                    } else {
                                        // Dispositivo não encontrado na lista retornada
                                        if let Ok(mut lock) = shared_stats.write() {
                                            *lock = None;
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("⚠️ Falha ao deserializar JSON de dispositivos UniFi: {:?}", e);
                            }
                        }
                    } else {
                        if status == reqwest::StatusCode::NOT_FOUND && !use_direct_path {
                            warn!("⚠️ 404 no endpoint do UniFi OS. Alternando para o endpoint direto da controladora local.");
                            use_direct_path = true;
                        } else {
                            warn!("⚠️ Resposta HTTP com erro da API do UniFi: {}", status);
                            // Se receber 401 ou 403, pode indicar falha de chave expirada
                            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                                warn!("🔑 Possível chave de API do UniFi expirada ou inválida.");
                            }
                            if let Ok(mut lock) = shared_stats.write() {
                                *lock = None;
                            }
                        }
                    }
                }
                Err(e) => {
                    // Falha de conexão (offline)
                    if let Ok(mut lock) = shared_stats.write() {
                        *lock = None;
                    }
                    // Apenas loga como aviso para não poluir
                    warn!("⚠️ Conexão com UniFi Controller falhou ou expirou (timeout): {:?}", e);
                }
            }
        }
    });
}
