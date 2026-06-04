// [SERVIDOR] decoder.rs - Parser CAN para CSV legado e DBC

use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub enum ByteOrder {
    Intel,
    Motorola,
}

#[derive(Debug, Clone)]
pub struct SignalConfig {
    pub signal_name: String,
    pub start_bit: usize,
    pub length: usize,
    pub factor: f64,
    pub offset: f64,
    pub unit: String,
    pub value_type: String, // legado CSV
    pub is_signed: bool,
    pub byte_order: ByteOrder,
}

#[derive(Debug, Clone)]
pub struct DecodeTrace {
    pub raw_unsigned: u64,
    pub raw_signed: Option<i64>,
    pub raw_physical_input: f64,
    pub factor: f64,
    pub offset: f64,
    pub physical_value: f64,
}

pub type DecoderMap = HashMap<u32, Vec<SignalConfig>>;

// ==================== CARREGAR CSVs (LEGADO) ====================

pub fn load_can_mappings<P: AsRef<Path>>(
    csv_dir: P,
) -> Result<DecoderMap, Box<dyn std::error::Error>> {
    let mut decoder_map: DecoderMap = HashMap::new();
    let entries = fs::read_dir(csv_dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("csv") {
            println!("📄 Carregando CSV: {:?}", path);
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
        let fields = split_csv_line(line);
        if fields.is_empty() {
            continue;
        }

        let first = fields[0].trim();

        if first.is_empty() && fields.iter().all(|f| f.trim().is_empty()) {
            current_can_id = None;
            continue;
        }

        if !first.is_empty() {
            if fields.len() >= 2 && fields[1].trim().starts_with("0x") {
                let id_str = fields[1].trim();
                match parse_hex_id(id_str) {
                    Ok(id) => {
                        current_can_id = Some(id);
                        decoder_map.entry(id).or_default();
                    }
                    Err(_) => {
                        current_can_id = None;
                    }
                }
            }
            continue;
        }

        let can_id = match current_can_id {
            Some(id) => id,
            None => continue,
        };

        if fields.len() < 9 {
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

        if let Some((start_bit, length)) = parse_position(position_str) {
            decoder_map.entry(can_id).or_default().push(SignalConfig {
                signal_name,
                start_bit,
                length,
                factor,
                offset,
                unit,
                value_type: value_type.clone(),
                is_signed: value_type.to_lowercase().contains("int") && length > 1,
                byte_order: ByteOrder::Intel,
            });
        }
    }

    Ok(())
}

// ==================== CARREGAR DBCs ====================

pub fn load_can_mappings_from_dbc_dir<P: AsRef<Path>>(
    dbc_dir: P,
) -> Result<DecoderMap, Box<dyn std::error::Error>> {
    let mut decoder_map: DecoderMap = HashMap::new();
    let entries = fs::read_dir(dbc_dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("dbc") {
            println!("📘 Carregando DBC: {:?}", path);
            parse_dbc_file(&path, &mut decoder_map)?;
        }
    }

    Ok(decoder_map)
}

fn parse_dbc_file(
    path: &Path,
    decoder_map: &mut DecoderMap,
) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let content = String::from_utf8_lossy(&bytes);
    let mut current_can_id: Option<u32> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        if let Some(rest) = trimmed.strip_prefix("BO_ ") {
            let mut parts = rest.split_whitespace();
            let id_str = match parts.next() {
                Some(v) => v,
                None => continue,
            };
            let raw_id: u32 = match id_str.parse() {
                Ok(v) => v,
                Err(_) => continue,
            };

            // DBC usa bit 31 como flag de extended frame.
            let can_id = raw_id & 0x1FFF_FFFF;
            current_can_id = Some(can_id);
            decoder_map.entry(can_id).or_default();
            continue;
        }

        if !trimmed.starts_with("SG_ ") {
            continue;
        }

        let can_id = match current_can_id {
            Some(id) => id,
            None => continue,
        };

        let after_prefix = &trimmed[4..];
        let (left, right) = match after_prefix.split_once(':') {
            Some(v) => v,
            None => continue,
        };

        let signal_name = left
            .trim()
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();
        if signal_name.is_empty() {
            continue;
        }

        let bit_spec = match right.trim().split_whitespace().next() {
            Some(v) => v,
            None => continue,
        };

        let (start_bit, length, byte_order, is_signed) = match parse_dbc_bit_spec(bit_spec) {
            Some(v) => v,
            None => continue,
        };

        let (factor, offset) = parse_dbc_factor_offset(right).unwrap_or((1.0, 0.0));
        let unit = parse_dbc_unit(right).unwrap_or_default();

        decoder_map.entry(can_id).or_default().push(SignalConfig {
            signal_name,
            start_bit,
            length,
            factor,
            offset,
            unit,
            value_type: if is_signed { "int" } else { "float" }.to_string(),
            is_signed,
            byte_order,
        });
    }

    Ok(())
}

fn parse_dbc_bit_spec(spec: &str) -> Option<(usize, usize, ByteOrder, bool)> {
    let (start_s, rest) = spec.split_once('|')?;
    let (len_s, endian_sign) = rest.split_once('@')?;

    let start_bit = start_s.trim().parse().ok()?;
    let length = len_s.trim().parse().ok()?;

    let mut chars = endian_sign.chars();
    let endian = chars.next()?;
    let sign = chars.next()?;

    let byte_order = match endian {
        '1' => ByteOrder::Intel,
        '0' => ByteOrder::Motorola,
        _ => return None,
    };

    let is_signed = match sign {
        '+' => false,
        '-' => true,
        _ => return None,
    };

    Some((start_bit, length, byte_order, is_signed))
}

fn parse_dbc_factor_offset(line: &str) -> Option<(f64, f64)> {
    let start = line.find('(')?;
    let end = line[start + 1..].find(')')? + start + 1;
    let inner = &line[start + 1..end];
    let (factor_s, offset_s) = inner.split_once(',')?;
    let factor = factor_s.trim().parse().ok()?;
    let offset = offset_s.trim().parse().ok()?;
    Some((factor, offset))
}

fn parse_dbc_unit(line: &str) -> Option<String> {
    let first = line.find('"')?;
    let rem = &line[first + 1..];
    let second = rem.find('"')?;
    Some(rem[..second].to_string())
}

// ==================== PARSE POSIÇÃO CSV ====================

fn parse_position(pos: &str) -> Option<(usize, usize)> {
    let pos = pos.trim().to_lowercase();

    if pos.starts_with("bit(") {
        let inner = pos.strip_prefix("bit(")?.strip_suffix(')')?;
        parse_range(inner, 1)
    } else if pos.starts_with("byte(") {
        let inner = pos.strip_prefix("byte(")?.strip_suffix(')')?;
        parse_range(inner, 8)
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
        Some((index * multiplier, multiplier))
    }
}

fn parse_hex_id(hex_str: &str) -> Result<u32, Box<dyn std::error::Error>> {
    let cleaned = hex_str
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    Ok(u32::from_str_radix(cleaned, 16)?)
}

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

pub fn extract_bits_intel(data: &[u8], start_bit: usize, length: usize) -> u64 {
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

pub fn extract_bits_motorola(data: &[u8], start_bit: usize, length: usize) -> u64 {
    if length == 0 {
        return 0;
    }

    let mut value: u64 = 0;
    let mut bit_index = start_bit as isize;

    for _ in 0..length {
        if bit_index < 0 {
            break;
        }

        let global_bit = bit_index as usize;
        let byte_index = global_bit / 8;
        let bit_in_byte = global_bit % 8;

        if byte_index >= data.len() {
            break;
        }

        let bit = (data[byte_index] >> bit_in_byte) & 1;
        value = (value << 1) | (bit as u64);

        bit_index = if bit_in_byte == 0 {
            bit_index + 15
        } else {
            bit_index - 1
        };
    }

    value
}

pub fn decode_signal_trace(raw_data: &[u8], config: &SignalConfig) -> DecodeTrace {
    let mut raw_val = match config.byte_order {
        ByteOrder::Intel => extract_bits_intel(raw_data, config.start_bit, config.length),
        ByteOrder::Motorola => extract_bits_motorola(raw_data, config.start_bit, config.length),
    };
    let raw_unsigned = raw_val;

    if config.is_signed && config.length > 1 {
        let sign_bit = 1u64 << (config.length - 1);
        if (raw_val & sign_bit) != 0 {
            let mask = !0u64 << config.length;
            raw_val |= mask;
        }
    }

    let raw_f64 = if config.is_signed && config.length > 1 {
        (raw_val as i64) as f64
    } else {
        raw_val as f64
    };

    let physical_value = raw_f64 * config.factor + config.offset;

    DecodeTrace {
        raw_unsigned,
        raw_signed: if config.is_signed && config.length > 1 {
            Some(raw_val as i64)
        } else {
            None
        },
        raw_physical_input: raw_f64,
        factor: config.factor,
        offset: config.offset,
        physical_value,
    }
}

pub fn decode_signal(raw_data: &[u8], config: &SignalConfig) -> f64 {
    decode_signal_trace(raw_data, config).physical_value
}

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
    fn test_parse_position_byte_range() {
        let (start, len) = parse_position("byte(4-5)").unwrap();
        assert_eq!(start, 32);
        assert_eq!(len, 16);
    }

    #[test]
    fn test_parse_dbc_bit_spec() {
        let (sb, len, bo, sign) = parse_dbc_bit_spec("39|16@0+").unwrap();
        assert_eq!(sb, 39);
        assert_eq!(len, 16);
        assert!(matches!(bo, ByteOrder::Motorola));
        assert!(!sign);
    }

    #[test]
    fn test_extract_motorola_u16() {
        let data = [0x12, 0x34, 0, 0, 0, 0, 0, 0];
        let v = extract_bits_motorola(&data, 7, 16);
        assert_eq!(v, 0x1234);
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
            is_signed: true,
            byte_order: ByteOrder::Intel,
        };
        let data = [0x0A];
        let val = decode_signal(&data, &config);
        assert_eq!(val, 40.0);
    }
}
