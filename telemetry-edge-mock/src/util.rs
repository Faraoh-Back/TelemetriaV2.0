pub fn clamp_i16(v: f64) -> i16 {
    v.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
}

pub fn write_i16_le(dst: &mut [u8; 8], offset: usize, value: i16) {
    dst[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
