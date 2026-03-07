// [SERVIDOR] decoder.rs - Parser para o formato CSV da E-Racing
//
// FORMATO DO CSV:
//   Linha de GRUPO:  "Nome do grupo", 0xCANID, 8B, type, min, max, ...
//   Linha de SINAL:  , nome_sinal, bit(0-1) ou byte(1) ou bit(0), tipo, ...
//   Linha vazia:     separador entre grupos
//
// POSIÇÕES:
//   bit(0-1)   → start_bit=0, length=2
//   bit(0)     → start_bit=0, length=1
//   byte(1)    → start_bit=8, length=8
//   byte(4-5)  → start_bit=32, length=16
//   bit(16-31) → start_bit=16, length=16

use std::collections::HashMap;
use std::fs;
use std::path::Path;

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone)]
pub struct SignalConfig {
    pub signal_name: String,
    pub start_bit: usize,
    pub length: usize,
    pub factor: f64,
    pub offset: f64,
    pub unit: String,
    pub value_type: String, // "int", "float", "bool"
}

pub type DecoderMap = HashMap<u32, Vec<SignalConfig>>;

// ==================== CARREGAR CSVs ====================

pub fn load_can_mappings<P: AsRef<Path>>(
    csv_dir: P,
) -> Result<DecoderMap, Box<dyn std::error::Error>> {
    let mut decoder_map: DecoderMap = HashMap::new();

    let entries = fs::read_dir(csv_dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("csv") {
            println!("📄 Carregando: {:?}", path);
            parse_csv_file(&path, &mut decoder_map)?;
        }
    }

    Ok(decoder_map)
}

fn parse_csv_file(
    path: &Path,
    decoder_map: &mut DecoderMap,
) -> Result<(), Box<dyn std::error::Error>> {
    let content = fs::read_to_string(path)?;
    let mut current_can_id: Option<u32> = None;

    for line in content.lines() {
        // Dividir linha em campos respeitando aspas
        let fields = split_csv_line(line);

        if fields.is_empty() {
            continue;
        }

        let first = fields[0].trim();

        // Linha vazia → fim do grupo atual
        if first.is_empty() && fields.iter().all(|f| f.trim().is_empty()) {
            current_can_id = None;
            continue;
        }

        // Linha de GRUPO: primeiro campo não vazio e segundo campo começa com 0x
        if !first.is_empty() {
            if fields.len() >= 2 && fields[1].trim().starts_with("0x") {
                let id_str = fields[1].trim();
                match parse_hex_id(id_str) {
                    Ok(id) => {
                        current_can_id = Some(id);
                        decoder_map.entry(id).or_insert_with(Vec::new);
                    }
                    Err(_) => {
                        current_can_id = None;
                    }
                }
            }
            continue;
        }

        // Linha de SINAL: primeiro campo vazio, segundo campo é o nome
        if first.is_empty() {
            let can_id = match current_can_id {
                Some(id) => id,
                None => continue,
            };

            if fields.len() < 8 {
                continue;
            }

            let signal_name = fields[1].trim().to_string();
            let position_str = fields[2].trim();
            let value_type = fields[3].trim().to_string();
            let factor: f64 = fields[6].trim().parse().unwrap_or(1.0);
            let offset: f64 = fields[7].trim().parse().unwrap_or(0.0);
            let unit = fields[8].trim().to_string();

            if signal_name.is_empty() || position_str.is_empty() {
                continue;
            }

            // Parsear posição: bit(X), bit(X-Y), byte(X), byte(X-Y)
            if let Some((start_bit, length)) = parse_position(position_str) {
                let config = SignalConfig {
                    signal_name,
                    start_bit,
                    length,
                    factor,
                    offset,
                    unit,
                    value_type,
                };
                decoder_map
                    .entry(can_id)
                    .or_insert_with(Vec::new)
                    .push(config);
            }
        }
    }

    Ok(())
}

// ==================== PARSE POSIÇÃO ====================
// bit(0)     → start=0,  length=1
// bit(0-1)   → start=0,  length=2
// bit(16-31) → start=16, length=16
// byte(1)    → start=8,  length=8
// byte(4-5)  → start=32, length=16

fn parse_position(pos: &str) -> Option<(usize, usize)> {
    let pos = pos.trim().to_lowercase();

    if pos.starts_with("bit(") {
        let inner = pos.strip_prefix("bit(")?.strip_suffix(')')?;
        parse_range(inner, 1) // multiplicador 1 (bits)
    } else if pos.starts_with("byte(") {
        let inner = pos.strip_prefix("byte(")?.strip_suffix(')')?;
        parse_range(inner, 8) // multiplicador 8 (bytes → bits)
    } else {
        None
    }
}

fn parse_range(inner: &str, multiplier: usize) -> Option<(usize, usize)> {
    if let Some((start_s, end_s)) = inner.split_once('-') {
        let start: usize = start_s.trim().parse().ok()?;
        let end: usize = end_s.trim().parse().ok()?;
        let start_bit = start * multiplier;
        let length = (end - start + 1) * multiplier;
        Some((start_bit, length))
    } else {
        let index: usize = inner.trim().parse().ok()?;
        let start_bit = index * multiplier;
        Some((start_bit, multiplier))
    }
}

// ==================== PARSE HEX ID ====================

fn parse_hex_id(hex_str: &str) -> Result<u32, Box<dyn std::error::Error>> {
    let cleaned = hex_str
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    Ok(u32::from_str_radix(cleaned, 16)?)
}

// ==================== SPLIT CSV RESPEITANDO ASPAS ====================

fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current);
    fields
}

// ==================== EXTRAÇÃO DE BITS ====================

pub fn extract_bits(data: &[u8], start_bit: usize, length: usize) -> u64 {
    let mut value: u64 = 0;
    for i in 0..length {
        let global_bit = start_bit + i;
        let byte_index = global_bit / 8;
        let bit_index = global_bit % 8;
        if byte_index < data.len() {
            let bit = (data[byte_index] >> bit_index) & 1;
            value |= (bit as u64) << i;
        }
    }
    value
}

// ==================== DECODIFICAÇÃO DO SINAL ====================

pub fn decode_signal(raw_data: &[u8], config: &SignalConfig) -> f64 {
    let mut raw_val = extract_bits(raw_data, config.start_bit, config.length);

    // Signed: aplicar sign extension
    let vt = config.value_type.to_lowercase();
    if vt.contains("int") && config.length > 1 {
        let sign_bit = 1u64 << (config.length - 1);
        if (raw_val & sign_bit) != 0 {
            let mask = !0u64 << config.length;
            raw_val |= mask;
        }
    }

    let raw_f64 = if vt.contains("int") && config.length > 1 {
        (raw_val as i64) as f64
    } else {
        raw_val as f64
    };

    raw_f64 * config.factor + config.offset
}

// ==================== TESTES ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_position_bit_range() {
        let (start, len) = parse_position("bit(0-1)").unwrap();
        assert_eq!(start, 0);
        assert_eq!(len, 2);
    }

    #[test]
    fn test_parse_position_bit_single() {
        let (start, len) = parse_position("bit(0)").unwrap();
        assert_eq!(start, 0);
        assert_eq!(len, 1);
    }

    #[test]
    fn test_parse_position_byte_single() {
        let (start, len) = parse_position("byte(1)").unwrap();
        assert_eq!(start, 8);
        assert_eq!(len, 8);
    }

    #[test]
    fn test_parse_position_byte_range() {
        let (start, len) = parse_position("byte(4-5)").unwrap();
        assert_eq!(start, 32);
        assert_eq!(len, 16);
    }

    #[test]
    fn test_parse_position_bit_wide() {
        // bit(16-31) → start=16, length=16
        let (start, len) = parse_position("bit(16-31)").unwrap();
        assert_eq!(start, 16);
        assert_eq!(len, 16);
    }

    #[test]
    fn test_decode_unsigned() {
        let config = SignalConfig {
            signal_name: "test".to_string(),
            start_bit: 0,
            length: 8,
            factor: 4.0,
            offset: 0.0,
            unit: "V".to_string(),
            value_type: "int".to_string(),
        };
        let data = [0x0A]; // 10
        let val = decode_signal(&data, &config);
        assert_eq!(val, 40.0); // 10 * 4 = 40
    }
}