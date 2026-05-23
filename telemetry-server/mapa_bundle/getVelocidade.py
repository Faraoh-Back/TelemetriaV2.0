"""
getVelocidade.py
================
Integrador de velocidade a partir de sinais de aceleração IMU.

VISÃO GERAL
-----------
Recebe um ou mais CSVs de aceleração no formato padrão da pipeline e gera
um CSV de velocidade no mesmo formato, pronto para o plotador.

A aceleração bruta de uma IMU nunca pode ser integrada diretamente: ruído
de sensor, vibrações mecânicas e offsets de fabricação acumulam erro rapidamente,
resultando em uma velocidade que deriva para infinito (problema clássico de
"integration drift"). Este módulo implementa um pipeline de três etapas para
mitigar esses problemas:

PIPELINE DE PROCESSAMENTO
-------------------------
  1. CORREÇÃO DE BIAS
     Estima o offset estático do sensor calculando a média das amostras com
     menor magnitude absoluta (percentil 5%). Em momentos de quasi-repouso,
     a aceleração real é ~0; qualquer resíduo é erro do sensor (bias).
     O bias estimado é subtraído de todas as amostras.

  2. FILTRO PASSA-BAIXA (Butterworth 4ª ordem, cutoff 3 Hz)
     Remove ruído de alta frequência (vibrações, EMI, quantização do ADC)
     que seria amplificado pela integração. O cutoff de 3 Hz preserva a
     dinâmica longitudinal e lateral de interesse (aceleração/frenagem de
     veículo), que raramente excede 1–2 Hz em manobras normais.
     Usa filtfilt (zero-phase) para não introduzir defasagem de fase.

  3. DETECÇÃO DE JANELA DE MOVIMENTO
     Antes de integrar, descarta os trechos em que a aceleração filtrada
     fica próxima de zero de forma sustentada — indicando que o carro está
     parado. A lógica segue a orientação do diretor: olhar a aceleração e
     identificar onde ela começa a ficar positiva/negativa (saiu do zero) —
     esse é o início do movimento. O inverso vale para o fim: onde ela volta
     a ficar próxima de zero de forma sustentada marca onde o carro parou.
     Tudo fora dessa janela é descartado antes da integração.

  4. INTEGRAÇÃO TRAPEZOIDAL
     Integra a aceleração filtrada com o método trapezoidal, que é de segunda
     ordem em precisão para sinais suaves, usando os timestamps reais de cada
     amostra (lida diretamente do CSV, sem assumir taxa constante):
         vel[i] = vel[i-1] + 0.5 × (acc[i] + acc[i-1]) × Δt[i]

  5. REMOÇÃO DE DRIFT RESIDUAL
     Após a integração, subtrai uma rampa linear do início ao fim do sinal.
     Assume que a velocidade média da sessão deve ser ~0 (trajetória fechada
     ou movimento sem deslocamento líquido). Essa hipótese é razoável para
     testes em pista ou bancada, mas deve ser revista para trajetórias abertas.

CONVENÇÃO DE NOMES
------------------
  VENTOR_LINEAR_ACC_X  →  VENTOR_LINEAR_VEL_X
  VENTOR_LINEAR_ACC_Y  →  VENTOR_LINEAR_VEL_Y
  qualquer outro nome  →  <NOME_ORIGINAL>_VEL

USO
---
  # Um arquivo:
  python3 src/getVelocidade.py data/processed/candump-1999-12-31/VENTOR_LINEAR_ACC_Y.csv

  # Múltiplos arquivos com glob:
  python3 src/getVelocidade.py data/processed/candump-xyz/VENTOR_LINEAR_ACC_*.csv

SAÍDA
-----
  Mesmo diretório do arquivo de entrada:
  data/processed/<pasta>/<SINAL_VEL>.csv
"""

import sys
import re
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.signal import butter, filtfilt


# ── Parâmetros de detecção de janela de movimento ────────────────────────────

# Magnitude máxima da aceleração filtrada (m/s²) para considerar que o carro
# está parado. O diretor orienta: olhar onde a aceleração começa a ficar
# positiva/negativa saindo do zero (início) e onde volta a ficar próxima de
# zero (fim). Ajuste se o sensor tiver ruído residual alto após o filtro.
LIMIAR_REPOUSO = 0.05   # m/s²

# Número mínimo de frames consecutivos abaixo do limiar para confirmar repouso.
# Evita que um vale momentâneo no meio do movimento seja interpretado como parada.
JANELA_REPOUSO = 10     # frames


# ── Helpers de extração do campo 'dado' ──────────────────────────────────────

def extrair_valor_numerico(texto: str) -> float | None:
    """
    Extrai o valor numérico (incluindo sinal negativo) do campo 'dado'.
    Exemplo: '-0.29 m/s²' → -0.29
    """
    match = re.search(r"-?\d+\.?\d*", str(texto))
    return float(match.group()) if match else None


def extrair_unidade(texto: str) -> str:
    """
    Extrai a unidade do campo 'dado'.
    Exemplo: '-0.29 m/s²' → 'm/s²'
    """
    partes = str(texto).strip().split()
    return partes[1] if len(partes) > 1 else ""


def derivar_nome_velocidade(nome_sinal_acc: str) -> str:
    """
    Converte o nome de um sinal de aceleração no nome correspondente de velocidade.

    Segue a convenção de nomenclatura VENTOR:
      VENTOR_LINEAR_ACC_X → VENTOR_LINEAR_VEL_X
      VENTOR_LINEAR_ACC_Y → VENTOR_LINEAR_VEL_Y
      OUTRO_SINAL         → OUTRO_SINAL_VEL
    """
    nome_upper = nome_sinal_acc.upper()
    if "_ACC_" in nome_upper:
        sufixo = nome_upper.split("_ACC_")[-1]  # 'X' ou 'Y'
        return f"VENTOR_LINEAR_VEL_{sufixo}"
    return f"{nome_upper}_VEL"


def montar_linha_csv(
    nome_sinal: str,
    timestamp: float,
    can_id: str,
    prioridade: int,
    valor: float,
    unidade: str,
) -> dict:
    """Retorna um dicionário no formato padrão do CSV de saída da pipeline."""
    return {
        "names":      nome_sinal,
        "timestamp":  round(timestamp, 6),
        "id_can":     can_id,
        "prioridade": prioridade,
        "dado":       f"{valor:.4f} {unidade}",
    }


# ── Detecção de janela de movimento ──────────────────────────────────────────

def detectar_janela_movimento(
    acc_filtrada: np.ndarray,
    limiar: float = LIMIAR_REPOUSO,
    janela: int = JANELA_REPOUSO,
) -> tuple[int, int]:
    """
    Retorna (inicio_idx, fim_idx) da janela em que o carro está em movimento.

    INÍCIO: avança do começo do sinal enquanto encontrar blocos de `janela`
    frames consecutivos com magnitude abaixo de `limiar` (repouso). O primeiro
    frame onde esse padrão não se repete é o início do movimento — onde a
    aceleração começa a se afastar do zero de forma sustentada.

    FIM: mesma lógica varrendo de trás para frente. O último trecho onde a
    aceleração volta a ficar próxima de zero de forma sustentada marca onde
    o carro parou.

    Se a janela resultante for menor que 10 amostras, retorna o sinal completo
    sem corte (sinal todo em repouso ou detecção inconclusiva).
    """
    magnitude = np.abs(acc_filtrada)
    n = len(magnitude)

    # Início: avança enquanto houver repouso sustentado
    inicio_idx = 0
    for i in range(n - janela):
        if np.all(magnitude[i : i + janela] <= limiar):
            inicio_idx = i + janela
        else:
            break

    # Fim: recua enquanto houver repouso sustentado
    fim_idx = n
    for i in range(n - janela, inicio_idx, -1):
        if np.all(magnitude[i : i + janela] <= limiar):
            fim_idx = i
        else:
            break

    if fim_idx - inicio_idx < 10:
        print("  [warn] Janela de movimento não detectada; usando sinal completo.")
        return 0, n

    return inicio_idx, fim_idx


# ── Pipeline de integração ────────────────────────────────────────────────────

def processar_csv_aceleracao(
    caminho_csv: Path,
    sem_janela_movimento: bool = False,
    sem_rampa_drift: bool = False,
) -> None:
    """
    Executa o pipeline completo de integração para um arquivo de aceleração.

    Etapas:
      1. Carrega e valida o CSV.
      2. Estima e remove o bias estático do sensor.
      3. Aplica filtro Butterworth passa-baixa (4ª ordem, 3 Hz).
      4. Detecta e corta a janela de movimento (descarta repouso inicial e final),
         salvo se ``sem_janela_movimento`` (útil quando o ACC já foi cortado à mão).
      5. Integra por método trapezoidal com timestamps reais.
      6. Remove drift linear residual (rampa), salvo se ``sem_rampa_drift``
         (p.ex. trecho aberto ou corte manual já alinhado).
      7. Salva o CSV de velocidade.
    """
    print(f"\n[velo] {caminho_csv.name}")

    # ── Etapa 1: Carregar e preparar o DataFrame ──────────────────────────────
    df = pd.read_csv(caminho_csv)
    df["timestamp"] = pd.to_numeric(df["timestamp"], errors="coerce")
    df["aceleracao"] = df["dado"].apply(extrair_valor_numerico)

    # Remove linhas com timestamp ou aceleração inválidos e ordena cronologicamente
    df = (df
          .dropna(subset=["timestamp", "aceleracao"])
          .sort_values("timestamp")
          .reset_index(drop=True))

    if len(df) < 10:
        print("  [skip] Amostras insuficientes para integração confiável (mínimo: 10).")
        return

    # Extrai metadados do sinal de origem para propagar nos CSVs de saída
    nome_sinal_acc = str(df["names"].iloc[0])
    can_id         = str(df["id_can"].iloc[0])
    prioridade     = int(df["prioridade"].iloc[0])
    unidade_acc    = extrair_unidade(df["dado"].iloc[0])
    nome_sinal_vel = derivar_nome_velocidade(nome_sinal_acc)

    # ── Etapa 2: Correção de bias estático ────────────────────────────────────
    # O bias é estimado como a média das amostras com menor magnitude absoluta
    # (percentil 5%). Em quasi-repouso, acc_real ≈ 0; o resíduo é erro do sensor.
    magnitude_absoluta = df["aceleracao"].abs()
    limiar_repouso     = np.percentile(magnitude_absoluta, 5)
    amostras_repouso   = df.loc[magnitude_absoluta < limiar_repouso, "aceleracao"]
    bias_estimado      = amostras_repouso.mean()

    df["acc_corrigida"] = df["aceleracao"] - bias_estimado
    print(f"  Bias estimado    : {bias_estimado:.6f} {unidade_acc}")

    # ── Etapa 3: Filtro Butterworth passa-baixa ───────────────────────────────
    # Estima a taxa de amostragem a partir dos intervalos de tempo reais.
    # cutoff = 3 Hz captura dinâmica de veículo sem amplificar ruído de alta freq.
    intervalo_medio_s = df["timestamp"].diff().mean()
    taxa_amostragem   = 1.0 / intervalo_medio_s
    cutoff_hz         = 3.0
    frequencia_nyquist = 0.5 * taxa_amostragem

    # Coeficientes do filtro Butterworth de 4ª ordem
    coef_b, coef_a = butter(4, cutoff_hz / frequencia_nyquist, btype="low")

    # filtfilt aplica o filtro duas vezes (ida e volta) → fase zero, sem atraso
    df["acc_filtrada"] = filtfilt(coef_b, coef_a, df["acc_corrigida"])
    print(f"  Fs detectada     : {taxa_amostragem:.2f} Hz  |  Cutoff filtro: {cutoff_hz} Hz")

    # ── Etapa 4: Detecção e corte da janela de movimento ─────────────────────
    n_total = len(df)
    if sem_janela_movimento:
        print("  Janela movimento : [flag] --sem-janela-movimento — usa todo o trecho do CSV (sem recorte automático).")
        inicio_idx, fim_idx = 0, n_total
    else:
        inicio_idx, fim_idx = detectar_janela_movimento(df["acc_filtrada"].to_numpy())
        n_janela = fim_idx - inicio_idx
        t_inicio = df["timestamp"].iloc[inicio_idx]
        t_fim    = df["timestamp"].iloc[fim_idx - 1]
        print(f"  Janela movimento : {t_inicio:.2f}s → {t_fim:.2f}s  [{n_janela}/{n_total} amostras]")
        df = df.iloc[inicio_idx:fim_idx].reset_index(drop=True)

    # ── Etapa 5: Integração trapezoidal ──────────────────────────────────────
    # Usa timestamps reais para lidar corretamente com taxas de amostragem
    # irregulares ou lacunas no log. Método trapezoidal é de 2ª ordem.
    velocidade = np.zeros(len(df))
    for i in range(1, len(df)):
        delta_t        = df["timestamp"][i] - df["timestamp"][i - 1]
        media_acc      = 0.5 * (df["acc_filtrada"][i] + df["acc_filtrada"][i - 1])
        velocidade[i]  = velocidade[i - 1] + media_acc * delta_t

    df["velocidade"] = velocidade

    # ── Etapa 6: Remoção de drift linear residual ─────────────────────────────
    if sem_rampa_drift:
        print("  Rampa drift      : [flag] --sem-rampa-drift — não aplica rampa linear (só ancora v(0)=0).")
        df["velocidade"] = df["velocidade"] - df["velocidade"].iloc[0]
    else:
        rampa_drift      = np.linspace(0, df["velocidade"].iloc[-1], len(df))
        df["velocidade"] = df["velocidade"] - rampa_drift
        df["velocidade"] = df["velocidade"] - df["velocidade"].iloc[0]  # ancora em zero

    print(f"  Velocidade final : {df['velocidade'].iloc[-1]:.4f} m/s")

    # ── Etapa 7: Salvar CSV de velocidade ─────────────────────────────────────
    timestamps = df["timestamp"].to_numpy()
    valores_vel = df["velocidade"].to_numpy()

    linhas_csv = [
        montar_linha_csv(nome_sinal_vel, timestamps[i], can_id, prioridade, valores_vel[i], "m/s")
        for i in range(len(df))
    ]

    caminho_saida = caminho_csv.parent / f"{nome_sinal_vel}.csv"
    pd.DataFrame(linhas_csv).to_csv(caminho_saida, index=False)
    print(f"  → Salvo em: {caminho_saida.name}")


# ── Ponto de entrada ──────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  INTEGRADOR DE VELOCIDADE — IMU")
    print("=" * 60)

    raw = sys.argv[1:]
    sem_janela = "--sem-janela-movimento" in raw
    sem_rampa  = "--sem-rampa-drift" in raw
    arquivos   = [a for a in raw if not a.startswith("--")]

    if not arquivos:
        print("\nUso: python3 getVelocidade.py <SINAL_ACC.csv> [...] [flags]")
        print("\nExemplos:")
        print("  python3 src/getVelocidade.py data/processed/candump-1999-12-31/VENTOR_LINEAR_ACC_Y.csv")
        print("  python3 src/getVelocidade.py data/processed/candump-xyz/VENTOR_LINEAR_ACC_*.csv")
        print("\nFlags (quando o ACC já foi cortado manualmente ou a rampa distorce a sessão):")
        print("  --sem-janela-movimento  Não recorta repouso início/fim (usa todo o CSV).")
        print("  --sem-rampa-drift       Não subtrai rampa linear até v_final=0.")
        print("\nO arquivo de saída é salvo no mesmo diretório do arquivo de entrada.")
        return

    for argumento in arquivos:
        caminho = Path(argumento)
        lista_arquivos = [caminho] if caminho.exists() else sorted(Path().glob(argumento))

        for caminho_arquivo in lista_arquivos:
            if not caminho_arquivo.exists():
                print(f"\n[ERRO] Arquivo não encontrado: {caminho_arquivo}")
                continue
            processar_csv_aceleracao(
                caminho_arquivo,
                sem_janela_movimento=sem_janela,
                sem_rampa_drift=sem_rampa,
            )

    print("\nPronto.\n")


if __name__ == "__main__":
    main()