// [SERVIDOR] decoder.rs (Adicione esta função)

pub fn extract_bits(data: &[u8], start_bit: usize, length: usize) -> u64 {
    // Implementação para Little Endian (Intel format) - Comum na maioria das ECUs
    // Se sua ECU for Big Endian (Motorola), a lógica inverte.
    
    let mut value: u64 = 0;
    
    // Itera bit a bit (lento mas didático e seguro)
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

// Atualize sua função decode_signal
pub fn decode_signal(raw_data: &[u8], config: &SignalConfig) -> f64 {
    let raw_val = extract_bits(raw_data, config.start_bit, config.length);
    
    // Converte para float e aplica fator/offset
    let phys_val = (raw_val as f64) * config.factor + config.offset;
    
    // Tratamento para Signed Integers (Se o CSV disser que é signed)
    // (Implementação simplificada, assumindo unsigned por padrão)
    phys_val
}