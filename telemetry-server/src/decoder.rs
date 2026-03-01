// [SERVIDOR] decoder.rs - VERSÃO MELHORADA
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use csv::Reader;
use serde::Deserialize;

// ==================== ESTRUTURAS ====================

#[derive(Debug, Clone, Deserialize)]
pub struct SignalConfig {
    #[serde(rename = "Signal Name")]
    pub signal_name: String,
    
    #[serde(rename = "Start Bit")]
    pub start_bit: usize,
    
    #[serde(rename = "Length")]
    pub length: usize,
    
    #[serde(rename = "Factor")]
    pub factor: f64,
    
    #[serde(rename = "Offset")]
    pub offset: f64,
    
    #[serde(rename = "Unit")]
    pub unit: String,
    
    #[serde(rename = "CAN ID")]
    pub can_id_hex: String,
    
    #[serde(rename = "Byte Order", default)]
    pub byte_order: String, // "Intel" (Little Endian) ou "Motorola" (Big Endian)
    
    #[serde(rename = "Value Type", default)]
    pub value_type: String, // "Signed" ou "Unsigned"
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
            
            let mut rdr = Reader::from_path(&path)?;
            
            for result in rdr.deserialize() {
                let signal: SignalConfig = result?;
                
                // Converter CAN ID de hex string para u32
                let can_id = parse_hex_id(&signal.can_id_hex)?;
                
                decoder_map
                    .entry(can_id)
                    .or_insert_with(Vec::new)
                    .push(signal);
            }
        }
    }
    
    Ok(decoder_map)
}

// ==================== PARSE HEX ID ====================

fn parse_hex_id(hex_str: &str) -> Result<u32, Box<dyn std::error::Error>> {
    let cleaned = hex_str.trim().trim_start_matches("0x").trim_start_matches("0X");
    Ok(u32::from_str_radix(cleaned, 16)?)
}

// ==================== EXTRAÇÃO DE BITS ====================

pub fn extract_bits(data: &[u8], start_bit: usize, length: usize, byte_order: &str) -> u64 {
    match byte_order {
        "Motorola" | "Big Endian" => extract_bits_motorola(data, start_bit, length),
        _ => extract_bits_intel(data, start_bit, length), // Default: Intel/Little Endian
    }
}

// Intel (Little Endian) - Comum na maioria das ECUs
fn extract_bits_intel(data: &[u8], start_bit: usize, length: usize) -> u64 {
    let mut value: u64 = 0;
    
    for i in 0..length {
        let global_bit_pos = start_bit + i;
        let byte_index = global_bit_pos / 8;
        let bit_index = global_bit_pos % 8;
        
        if byte_index < data.len() {
            let bit = (data[byte_index] >> bit_index) & 1;
            value |= (bit as u64) << i;
        }
    }
    
    value
}

// Motorola (Big Endian) - Menos comum
fn extract_bits_motorola(data: &[u8], start_bit: usize, length: usize) -> u64 {
    let mut value: u64 = 0;
    
    // Motorola: bits contados da direita para esquerda em cada byte
    let start_byte = start_bit / 8;
    let start_bit_in_byte = 7 - (start_bit % 8);
    
    let mut bits_read = 0;
    let mut current_byte = start_byte;
    let mut current_bit = start_bit_in_byte;
    
    while bits_read < length && current_byte < data.len() {
        let bit = (data[current_byte] >> current_bit) & 1;
        value |= (bit as u64) << (length - 1 - bits_read);
        
        bits_read += 1;
        
        if current_bit == 0 {
            current_byte += 1;
            current_bit = 7;
        } else {
            current_bit -= 1;
        }
    }
    
    value
}

// ==================== DECODIFICAÇÃO DO SINAL ====================

pub fn decode_signal(raw_data: &[u8], config: &SignalConfig) -> f64 {
    // Extrair valor bruto
    let mut raw_val = extract_bits(
        raw_data,
        config.start_bit,
        config.length,
        &config.byte_order,
    );
    
    // Tratar signed integers
    if config.value_type.to_lowercase().contains("signed") {
        let sign_bit = 1u64 << (config.length - 1);
        
        if (raw_val & sign_bit) != 0 {
            // Número negativo - extend sign
            let mask = !0u64 << config.length;
            raw_val |= mask;
        }
    }
    
    // Converter para signed se necessário
    let raw_as_f64 = if config.value_type.to_lowercase().contains("signed") {
        (raw_val as i64) as f64
    } else {
        raw_val as f64
    };
    
    // Aplicar fator e offset
    let physical_value = raw_as_f64 * config.factor + config.offset;
    
    physical_value
}

// ==================== TESTES ====================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_bits_intel() {
        // Exemplo: 16 bits começando no bit 0 de [0xFF, 0x12]
        // Esperado: 0x12FF (little endian)
        let data = [0xFF, 0x12];
        let value = extract_bits_intel(&data, 0, 16);
        assert_eq!(value, 0x12FF);
    }
    
    #[test]
    fn test_extract_bits_motorola() {
        // Exemplo: 8 bits começando no bit 7 de [0xFF]
        // Esperado: 0xFF
        let data = [0xFF];
        let value = extract_bits_motorola(&data, 7, 8);
        assert_eq!(value, 0xFF);
    }
    
    #[test]
    fn test_decode_signal_unsigned() {
        let config = SignalConfig {
            signal_name: "test".to_string(),
            start_bit: 0,
            length: 16,
            factor: 0.1,
            offset: 0.0,
            unit: "V".to_string(),
            can_id_hex: "0x100".to_string(),
            byte_order: "Intel".to_string(),
            value_type: "Unsigned".to_string(),
        };
        
        let data = [0x50, 0x0F]; // 3920 em little endian
        let value = decode_signal(&data, &config);
        assert_eq!(value, 392.0); // 3920 * 0.1 = 392.0
    }
    
    #[test]
    fn test_decode_signal_signed() {
        let config = SignalConfig {
            signal_name: "temperature".to_string(),
            start_bit: 0,
            length: 16,
            factor: 0.1,
            offset: -40.0,
            unit: "°C".to_string(),
            can_id_hex: "0x200".to_string(),
            byte_order: "Intel".to_string(),
            value_type: "Signed".to_string(),
        };
        
        // Testar com número negativo
        let data = [0x9C, 0xFF]; // -100 em little endian signed 16-bit
        let value = decode_signal(&data, &config);
        assert!(value < 0.0); // Deve ser negativo
    }
}