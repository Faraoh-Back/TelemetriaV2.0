# Plano de migracao Rust: CSV -> DBC (telemetria em alta velocidade)

## Objetivo

Migrar a configuracao CAN de `csv_data/*.csv` para um modelo padronizado em `.dbc`, sem perder desempenho de telemetria e sem acoplamento a um unico arquivo (ex.: BMS).

O alvo e suportar varios DBCs em paralelo (BMS, VCU, IMU, etc.) com fonte unica de verdade e processo de auditoria de cobertura.

## Escopo

1. manter pipeline atual de ingestao em tempo real:
- ler frame bruto (`can_id`, `timestamp`, `raw_data`)
- buscar sinais por `can_id`
- decodificar
- persistir e publicar no WS

2. trocar apenas a fonte de configuracao CAN:
- de CSV manual/legado
- para DBC padronizado e versionado

3. preparar base para multiplos DBCs, nao apenas BMS.

## Estado atual (codigo)

- Loader atual: `src/decoder.rs` (`load_can_mappings` via CSV).
- Runtime atual: `src/main.rs` (`handle_client` usa `decoder_map.get(&can_id)` + `decode_signal`).
- Decoder atual assume extracao estilo Intel/LSB e inferencia de signed por texto (`value_type`).

## Requisito critico: performance

A migracao para DBC **nao pode** introduzir parsing por frame.

Regra de ouro:

- parse de DBC acontece **somente no boot** (ou em hot-reload controlado);
- runtime usa estruturas precompiladas (`HashMap<u32, MessageConfig>`) com lookup O(1);
- em cada frame, o custo deve ser equivalente ao atual: `get(can_id)` + loop de sinais + decode.

### Diretrizes de desempenho

1. **Zero regex no hot path**: parser DBC pode usar regex no boot, nunca durante `handle_client`.
2. **Sem alocacao desnecessaria por frame**:
- evitar `String` nova na decodificacao;
- sinal deve reaproveitar metadado ja carregado.
3. **Pre-validacao no boot**:
- descartar sinais invalidos no parse;
- evitar checks caros em runtime.
4. **Benchmarks**:
- adicionar benchmark simples de decode (N frames x M sinais) para comparar CSV vs DBC.

## Padronizacao DBC (multi-arquivo)

Em vez de um unico arquivo fixo, usar diretorio de DBCs, por exemplo:

- `./dbc_data/*.dbc`

Fluxo:

1. ler todos os `.dbc` do diretorio;
2. montar `DecoderMap` unificado por `can_id`;
3. detectar conflitos de definicao;
4. falhar no boot se houver conflito critico.

### Regra de conflito (obrigatoria)

Se o mesmo `can_id` aparecer em mais de um DBC com definicoes divergentes de sinal (`start_bit/len/byte_order/signed/factor/offset`), marcar como erro de configuracao.

Isso evita decodificacao ambigua em pista.

## Mudancas necessarias na decodificacao

Sim, precisa mudar para suportar DBC corretamente.

1. `byte_order`:
- suportar Intel (`@1`) e Motorola (`@0`).

2. signed:
- usar `+/-` do DBC (`is_signed`) e nao inferir por texto.

3. estrutura de mensagem:
- guardar `dlc` para validacao logica (mesmo que frame de transporte siga com 8 bytes).

## Modelo sugerido (Rust)

```rust
pub enum ByteOrder {
    Intel,
    Motorola,
}

pub struct SignalConfig {
    pub signal_name: String,
    pub start_bit: usize,
    pub length: usize,
    pub factor: f64,
    pub offset: f64,
    pub unit: String,
    pub is_signed: bool,
    pub byte_order: ByteOrder,
}

pub struct MessageConfig {
    pub can_id: u32,
    pub dlc: usize,
    pub signals: Vec<SignalConfig>,
    pub source_file: String,
    pub message_name: String,
}

pub type DecoderMap = HashMap<u32, MessageConfig>;
```

## Loader DBC

Adicionar:

- `load_can_mappings_from_dbc_dir(path: &Path) -> Result<DecoderMap, Error>`

Capacidades:

1. parse de `BO_` e `SG_`;
2. merge de multiplos arquivos;
3. deteccao de conflitos;
4. relatorio final de carga:
- total de arquivos
- total de mensagens
- total de sinais
- conflitos encontrados

## Compatibilidade e rollout seguro

Adicionar `CAN_MAP_SOURCE`:

- `dbc` (novo padrao)
- `csv` (fallback)

E opcional:

- `CAN_DBC_DIR=./dbc_data`

Rollout:

1. ativar `dbc` em homologacao;
2. rodar comparacao paralela contra `csv`;
3. ativar em producao;
4. remover csv quando estabilizar.

## Missao adicional: varredura de cobertura CSV x DBC

Como voce descreveu, precisamos mapear o status de migracao por sistema (BMS e outros).

### Objetivo da varredura

Responder com evidencia:

1. quais CAN IDs existem no legado CSV;
2. quais CAN IDs ja existem em DBC;
3. quais faltam migrar para DBC;
4. quais existem em DBC mas nao no CSV;
5. quais IDs batem, mas com divergencia de sinais/escala/unidade.

### Entregavel da varredura

Gerar relatorio versionado (ex.: `reports/can-coverage-report.md`) com:

1. resumo geral por data;
2. tabela por arquivo/sistema;
3. lista de gaps priorizados;
4. lista de conflitos de definicao;
5. status por item: `migrado`, `parcial`, `nao iniciado`.

### Metodologia sugerida

1. extrair inventario CSV:
- set de `can_id`
- sinais por `can_id`

2. extrair inventario DBC (todos os arquivos):
- set de `can_id`
- sinais por `can_id`
- metadados de decode

3. comparar em 3 niveis:
- nivel 1: existencia do `can_id`
- nivel 2: existencia de sinal por nome
- nivel 3: igualdade de parametros (`start_bit`, `len`, `byte_order`, `signed`, `factor`, `offset`, `unit`)

4. classificar diferencas:
- `missing_in_dbc`
- `missing_in_csv`
- `param_mismatch`
- `name_mismatch`

## Criticos de qualidade antes de fechar migracao

1. sem conflito de `can_id` entre DBCs ativos;
2. sinais criticos de operacao presentes (BMS/VCU/seguranca);
3. latencia e throughput sem regressao perceptivel;
4. regressao de valor aprovada em amostras reais.

## Sequencia recomendada

1. implementar loader DBC multi-arquivo com validacoes;
2. ajustar decode para Intel/Motorola + signed por DBC;
3. adicionar fallback por `CAN_MAP_SOURCE`;
4. implementar ferramenta de varredura CSV x DBC;
5. publicar primeiro relatorio de cobertura;
6. migrar por blocos (BMS, depois demais sistemas);
7. virar default para DBC e descontinuar CSV legado.

## Checklist

- [ ] parser DBC multi-arquivo funcionando
- [ ] conflitos de `can_id` detectados no boot
- [ ] decode Intel e Motorola testado
- [ ] signed baseado em DBC implementado
- [ ] benchmark sem regressao relevante
- [ ] varredura CSV x DBC implementada
- [ ] relatorio de cobertura atualizado
- [ ] fallback CSV disponivel para rollback rapido

## DBCs recebidos (status atual)

Arquivos ja recebidos para padronizacao DBC:

- [x] `/Users/joaogabriel/Downloads/EMUS-G1-BMS-DBC-v1_0_2.dbc` (BMS)
- [x] `/Users/joaogabriel/Downloads/Inversor_Private.dbc`
- [x] `/Users/joaogabriel/Downloads/Inversor_Public.dbc`
- [x] `/Users/joaogabriel/Downloads/VCU_GERAL.dbc`

Proximo passo dessa trilha:

1. consolidar esses arquivos em `./dbc_data/` no backend;
2. rodar varredura CSV x DBC com os quatro arquivos;
3. publicar primeiro `can-coverage-report.md` com gaps por sistema.

## Execução inicial da varredura (2026-05-24)

Relatórios gerados:

- `/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/reports/can-coverage-report.md`
- `/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/reports/can-coverage-report.json`

Resumo inicial:

- CSV files: `7`
- DBC files: `4`
- CAN IDs no CSV: `38`
- CAN IDs no DBC: `340`
- Interseção: `18`
- Faltando no DBC (vs CSV): `20`
- Só no DBC: `322`

Leitura desse resultado:

1. A padronização DBC já cobre uma área muito maior que o legado CSV.
2. Ainda há lacunas de migração para IDs do CSV que não apareceram nos DBCs atuais.
3. Parte relevante das diferenças na interseção é de nomenclatura (`_` vs espaço/sufixo), exigindo regra de normalização antes de classificar como incompatibilidade real de decode.
