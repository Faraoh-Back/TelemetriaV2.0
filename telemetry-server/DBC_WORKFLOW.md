# Workflow DBC no Backend Rust

## Objetivo

Padronizar a decodificação CAN usando `.dbc` como fonte principal de verdade no backend Rust.

## Decisão principal

1. `DBC` é o padrão de carga do mapa CAN no boot.
2. `CSV` permanece apenas como fallback temporário para rollback controlado.

No `main.rs`:

- padrão: `CAN_MAP_SOURCE=dbc`
- fallback: `CAN_MAP_SOURCE=csv`

## Fluxo de execução

1. Servidor inicia.
2. Carrega mapa CAN:
- se `CAN_MAP_SOURCE=dbc`: lê `./dbc_data/*.dbc`
- se `CAN_MAP_SOURCE=csv`: lê `./csv_data/*.csv`
3. Para cada frame CAN recebido:
- lookup por `can_id`
- decode por sinal
- persistência e broadcast

## Decodificação no `decoder.rs`

A decodificação já foi adaptada para contexto DBC com:

1. `byte_order` por sinal:
- `@1` -> Intel (`ByteOrder::Intel`)
- `@0` -> Motorola (`ByteOrder::Motorola`)

2. signed/unsigned por sinal:
- `+` unsigned
- `-` signed

3. cálculo final:
- extração de bits
- sign extension (quando signed)
- `physical = raw * factor + offset`

## Leitura DBC em detalhe (como o parser funciona)

Arquivo: [decoder.rs](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/src/decoder.rs)

### 1) Entrada

- Função de carga: `load_can_mappings_from_dbc_dir(...)`
- Fonte: todos os arquivos `./dbc_data/*.dbc`

### 2) Parse de mensagem (`BO_`)

- Exemplo real (BMS):
  - `BO_ 2578776073 Battery_Volt_2_Overall_Param_Ext: 8 EMUS_BMS`
- O parser extrai:
  - `raw_id = 2578776073`
  - `can_id = raw_id & 0x1FFFFFFF` (remove flag de extended no bit 31)
- Esse `can_id` vira a chave no `DecoderMap`.

### 3) Parse de sinal (`SG_`)

- Exemplo real (BMS Motorola):
  - `SG_ VoltOverallParams_TotalVolt : 31|32@0+ (0.01,0) ... "V"`
- Exemplo real (VCU Intel):
  - `SG_ RPM_0A : 16|16@1- (1,0) ... "RPM"`

Para cada `SG_`, o parser extrai:

1. `signal_name`
2. `start_bit`
3. `length`
4. `byte_order`:
   - `@1` => `ByteOrder::Intel`
   - `@0` => `ByteOrder::Motorola`
5. `is_signed`:
   - `+` => `false`
   - `-` => `true`
6. `factor`, `offset`
7. `unit`

Observação:
- O parse do DBC ocorre somente no boot, e não por frame.

## Decodificação em detalhe (hot path)

### 1) Lookup por CAN ID

No runtime (`handle_client` em `main.rs`), para cada frame:

1. lê `can_id`, `timestamp`, `raw_data` (8 bytes)
2. faz `decoder_map.get(&can_id)`
3. para cada sinal do `can_id`, chama `decode_signal(raw_data, cfg)`

### 2) Extração Intel vs Motorola

Em `decode_signal`:

1. escolhe o extrator:
   - Intel: `extract_bits_intel(...)`
   - Motorola: `extract_bits_motorola(...)`
2. aplica sign extension quando `is_signed == true`
3. converte:
   - `valor_fisico = raw * factor + offset`

### 3) Sign extension (por que importa)

Exemplo VCU (`@1-`):
- `SG_ RPM_0A : 16|16@1- (1,0) ...`
- Se bit de sinal vier 1, sem sign extension o valor ficaria incorreto (interpretado como unsigned).

## Exemplo fim-a-fim (BMS)

Mensagem:
- `BO_ 2578776073 Battery_Volt_2_Overall_Param_Ext: 8 EMUS_BMS`

Sinal:
- `SG_ VoltOverallParams_TotalVolt : 31|32@0+ (0.01,0) ... "V"`

Interpretação:
1. `can_id` é resolvido a partir de `2578776073`
2. sinal usa Motorola (`@0`)
3. extrai 32 bits iniciando em `start_bit=31`
4. unsigned (`+`)
5. aplica escala: `raw * 0.01 + 0`

Resultado:
- valor final em volts.

## Decisões de arquitetura (resumo)

1. DBC como padrão:
   - reduz drift de mapeamento manual
2. CSV como fallback:
   - rollback rápido de operação
3. parse no boot:
   - preserva throughput no hot path
4. byte_order/signed explícitos por sinal:
   - evita erros silenciosos de decodificação

## Por que essa abordagem

1. Performance: parsing de DBC ocorre no boot, não no hot path.
2. Padronização: evita manter mapeamento manual divergente.
3. Escalabilidade: suporta múltiplos DBCs (BMS, inversor, VCU).
4. Segurança operacional: fallback CSV reduz risco de parada em pista.

## Operação

### Rodar padrão (DBC)

```bash
CAN_MAP_SOURCE=dbc ./telemetry-server
```

### Fallback (CSV)

```bash
CAN_MAP_SOURCE=csv ./telemetry-server
```

## Estado atual

- Implementado: loader DBC + decode Intel/Motorola + signed por DBC.
- Implementado: scanner CSV x DBC para cobertura.
- Pendente local: validação por `cargo test` no ambiente com toolchain Rust instalada.
