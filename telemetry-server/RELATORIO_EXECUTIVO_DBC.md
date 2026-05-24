# Relatório Executivo: Migração CAN CSV -> DBC (Backend Rust)

Data: 2026-05-24
Responsável técnico: Telemetria Backend

## 1) Resumo executivo

A migração da leitura CAN de CSV para DBC no backend Rust foi iniciada e já está funcional em ambiente de desenvolvimento, com DBC como padrão de carga.

Status atual:

- Leitura DBC implementada no backend Rust.
- Decodificação adaptada para `Intel/Motorola` e `signed/unsigned` por definição DBC.
- Fallback para CSV mantido para rollback controlado.
- Varredura inicial de cobertura concluída entre legado CSV e DBC atual.

Resultado da varredura inicial:

- CAN IDs no CSV: `38`
- CAN IDs no DBC: `340`
- Interseção: `18`
- Presentes no CSV e ausentes nos DBCs atuais: `20`
- Divergências de parâmetro identificadas: `6` sinais

Conclusão executiva:

- A base técnica da migração está pronta.
- O que falta é fechamento de cobertura e validação operacional para concluir a transição com segurança.

## 2) Impacto para o negócio

Ganhos esperados:

1. Padronização do contrato CAN (redução de erro manual de mapeamento).
2. Escalabilidade para múltiplos módulos (BMS, inversores, VCU e futuros).
3. Menor custo de manutenção e menor risco de drift entre times.
4. Melhor rastreabilidade de mudanças por versão de DBC.

Risco de não concluir:

1. Permanência de inconsistências entre mapeamentos legados.
2. Maior chance de decodificação incorreta em sinais críticos.
3. Aumento de tempo de integração entre software e calibração/eletrônica.

## 3) Escopo entregue

Entregas técnicas já realizadas:

1. Runtime Rust com seleção de fonte CAN por ambiente (`DBC` padrão, `CSV` fallback).
2. Loader DBC multi-arquivo no backend.
3. Decodificação com suporte a byte order e signed por sinal.
4. Script de varredura CSV x DBC com relatório de cobertura.
5. Documentação técnica de workflow e decisões arquiteturais.

## 4) Gaps atuais (priorizados)

### 4.1 Cobertura

- `20` CAN IDs do legado CSV ainda não encontrados nos DBCs atualmente consolidados.
- Prioridade: classificar criticidade operacional desses IDs (segurança, powertrain, BMS, telemetria auxiliar).

### 4.2 Divergências de definição

- `6` sinais com diferença de parâmetros na interseção atual.
- Parte das diferenças é nomenclatura; parte é diferença real de decode (escala/signed/unidade).
- Prioridade: homologar parâmetros dos sinais críticos com referência elétrica/campo.

### 4.3 Validação operacional

- Falta validação final em execução de telemetria real com DBC como padrão em ambiente alvo.

## 5) Plano de execução proposto

Fase 1 — Fechamento de cobertura (curto prazo)

1. Validar os 20 IDs faltantes: confirmar se são obsoletos ou pendentes de DBC.
2. Atualizar pacote DBC oficial e rerodar varredura.
3. Publicar lista final de IDs críticos cobertos.

Fase 2 — Homologação de decodificação (curto prazo)

1. Resolver as 6 divergências de parâmetro em sinais críticos.
2. Rodar teste comparativo com amostras reais.
3. Validar consistência de valores físicos no dashboard/armazenamento.

Fase 3 — Go-live controlado (curto prazo)

1. Operar com `CAN_MAP_SOURCE=dbc` como padrão.
2. Manter fallback CSV por janela de segurança definida.
3. Encerrar fallback após janela sem incidentes.

## 6) Critérios de Go/No-Go

Go para produção DBC-only (ou DBC-default sem exceção) quando:

1. 100% dos CAN IDs críticos estiverem cobertos no DBC oficial.
2. 0 divergência aberta de decode em sinais críticos.
3. Execução estável em teste real de telemetria durante janela acordada.
4. Equipe de operação validando rollback controlado e não acionado.

## 7) Decisão solicitada à diretoria

Solicitamos aprovação para:

1. Priorizar o fechamento dos gaps de cobertura e homologação de decode.
2. Reservar janela de validação operacional em campo.
3. Autorizar transição oficial para DBC como padrão de produção, mantendo CSV apenas como contingência temporária.

## 8) Referências internas

- Relatório técnico de cobertura: `/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/reports/can-coverage-report.md`
- Workflow técnico DBC: `/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/DBC_WORKFLOW.md`
- Plano técnico de migração: `/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/rust-dbc-migration-plan.md`
