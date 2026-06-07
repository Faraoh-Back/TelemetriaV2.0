use crate::decoder::{ByteOrder, DecoderMap};
use tokio::net::TcpStream;
use super::http::send_json;

pub(super) async fn handle_can_map(
    stream: &mut TcpStream,
    decoder_map: &DecoderMap,
) {
    let mut obj = serde_json::Map::new();

    for (can_id, signals) in decoder_map {
        let signals_json: Vec<serde_json::Value> = signals
            .iter()
            .map(|s| {
                serde_json::json!({
                    "n":      s.signal_name,
                    "sb":     s.start_bit,
                    "len":    s.length,
                    "bo":     match s.byte_order {
                                  ByteOrder::Motorola => "Motorola",
                                  ByteOrder::Intel    => "Intel",
                              },
                    "f":      s.factor,
                    "o":      s.offset,
                    "u":      s.unit,
                    "t":      s.value_type,
                    "signed": s.is_signed,
                })
            })
            .collect();

        obj.insert(can_id.to_string(), serde_json::Value::Array(signals_json));
    }

    let body = serde_json::Value::Object(obj).to_string();
    send_json(stream, 200, &body).await;
}