"""
getTrajetoria.py
================
Reconstrução de trajetória 2D por dead reckoning com fusão IMU + RPM.

VISÃO GERAL
-----------
Combina a velocidade longitudinal estimada pelos RPMs dos inversores com a
aceleração longitudinal da IMU (VENTOR_LINEAR_ACC_X) e o heading acumulado a
partir da velocidade angular do giroscópio (VENTOR_ANGULAR_SPEED_Z) para
reconstruir a posição x, y do veículo no plano da pista ao longo do tempo.

PIPELINE DE PROCESSAMENTO
-------------------------
  1. CARGA E VALIDAÇÃO
     Carrega ACT_SPEED_A13.csv/ACT_SPEED_B13.csv, VENTOR_LINEAR_ACC_X.csv e
     VENTOR_ANGULAR_SPEED_Z.csv do mesmo diretório de sessão. Se RPM ou ACC_X
     estiverem ausentes, usa como fallback a velocidade integrada por
     getVelocidade.py.

  2. CORREÇÃO DE BIAS DO GIROSCÓPIO
     Estima o offset estático do giroscópio pela média das amostras com
     menor magnitude absoluta (percentil 5% — mesmo mecanismo do
     getVelocidade.py). Bias não corrigido acumula erro de heading
     linearmente e distorce toda a trajetória.

  3. FILTRO BUTTERWORTH PASSA-BAIXA
     Remove ruído de alta frequência do giroscópio antes de integrar.
     Parâmetros: 4ª ordem, cutoff 2 Hz, filtfilt (fase zero).
     Cutoff menor que o de ACC (3 Hz) porque o heading é mais sensível
     a ruído — qualquer componente espúrio se integra duas vezes
     (ω → θ → posição).

  4. FUSÃO DE VELOCIDADE
     Converte RPM do motor em velocidade linear da roda:
         rpm_roda = rpm_motor / 11.72
         v_rpm = (rpm_roda / 60) × circunferência_roda
     Usa ACC_X para prever variações rápidas e corrige continuamente a
     estimativa com RPM para impedir drift acumulado entre voltas.

  5. INTEGRAÇÃO DO HEADING
     Integra VENTOR_ANGULAR_SPEED_Z → heading θ por método trapezoidal
     com timestamps reais:
         θ[i] = θ[i-1] + 0.5 × (ω[i] + ω[i-1]) × Δt[i]
     θ₀ = 0 (heading inicial arbitrário — norte local).

  6. DECOMPOSIÇÃO EM WORLD FRAME
     Projeta a velocidade escalar longitudinal nas componentes do world
     frame usando o heading acumulado:
         vx[i] = vel[i] × cos(θ[i])
         vy[i] = vel[i] × sin(θ[i])

  7. INTEGRAÇÃO DE POSIÇÃO
     Integra vx, vy → x, y por método trapezoidal com timestamps reais.

  8. MAPA BASE + TRACKING
     Estima o período de volta pela autocorrelação da velocidade fundida.
     A primeira volta integral define o MAPA_BASE; depois disso o código não
     gera novas geometrias de pista. Ele apenas rastreia a posição do veículo
     sobre esse mapa fixo por progresso de distância. Desative com --no-track-map
     ou fixe o período com --lap-period-sec T.

  9. MÉTRICAS DE QUALIDADE
     Calcula e exibe o erro de fechamento — distância euclidiana entre
     o ponto inicial e final da trajetória. Para sessões em pista fechada,
     esse erro é a principal métrica de qualidade do dead reckoning.

  10. SALVAMENTO
     Salva TRAJETORIA_X.csv e TRAJETORIA_Y.csv no mesmo diretório dos
     arquivos de entrada, no formato padrão da pipeline.

CONVENÇÃO DE SINAL DO YAW
--------------------------
O sentido positivo de VENTOR_ANGULAR_SPEED_Z (horário ou anti-horário
visto de cima) depende da orientação de montagem da IMU no chassi e ainda
não foi confirmado empiricamente. Se a trajetória gerada aparecer espelhada
em relação ao esperado (curvas à direita resultando em curvatura à esquerda
no mapa), negue o sinal usando a flag --negar-yaw:

    python3 src/getTrajetoria.py data/processed/candump-xyz/ --negar-yaw

Após confirmar o sentido, registre a convenção no TRAJECTORY.md e remova
a necessidade da flag atualizando o sinal diretamente em SINAIS_CANDUMP.

USO
---
  # Um diretório:
  python3 src/getTrajetoria.py data/processed/candump-1999-12-31/

  # Múltiplos diretórios:
  python3 src/getTrajetoria.py data/processed/candump-*/

  # Com negação do yaw (se a trajetória sair espelhada):
  python3 src/getTrajetoria.py data/processed/candump-xyz/ --negar-yaw

  # Período de volta conhecido (pula detecção por autocorrelação):
  python3 src/getTrajetoria.py data/processed/candump-xyz/ --lap-period-sec 45

  # Trajetória bruta sem rastrear no mapa da primeira volta:
  python3 src/getTrajetoria.py data/processed/candump-xyz/ --no-track-map

SAÍDA
-----
  data/processed/<pasta>/TRAJETORIA_X.csv
  data/processed/<pasta>/TRAJETORIA_Y.csv
  data/processed/<pasta>/MAPA_BASE_X.csv
  data/processed/<pasta>/MAPA_BASE_Y.csv
"""

import sys
import re
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.signal import butter, filtfilt
from scipy.interpolate import interp1d
from mapaRegraNegocio import (
    N_RESAMPLE_MAPA,
    estimar_periodo_volta_segundos,
    rastrear_no_mapa_primeira_volta,
)


# ── Parâmetros do filtro do giroscópio ───────────────────────────────────────

# Ordem e cutoff menores que os de ACC porque o heading é duplamente sensível
# a ruído: qualquer componente espúrio se integra duas vezes (ω → θ → posição).
FILTRO_ORDEM  = 4
FILTRO_CUTOFF = 2.0   # Hz

# ── Parâmetros da fusão RPM + IMU ────────────────────────────────────────────

RAIO_RODA_POLEGADAS       = 10.0
METROS_POR_POLEGADA       = 0.0254
RAIO_RODA_M               = RAIO_RODA_POLEGADAS * METROS_POR_POLEGADA
CIRCUNFERENCIA_RODA_M     = 2.0 * np.pi * RAIO_RODA_M
FATOR_REDUCAO_PLANETARIA  = 11.72
RPM_MOTOR_PARA_MPS        = CIRCUNFERENCIA_RODA_M / (60.0 * FATOR_REDUCAO_PLANETARIA)

# Peso da correção absoluta por RPM em cada frame. ACC_X prevê transientes; RPM
# ancora a velocidade e evita que a integração livre carregue erro volta a volta.
PESO_CORRECAO_RPM = 0.35


# ── Helpers de parsing do campo 'dado' ───────────────────────────────────────

def extrair_valor(texto: str) -> float | None:
    """Extrai o valor numérico (com sinal) do campo 'dado'. Ex: '-0.29 m/s²' → -0.29"""
    match = re.search(r"-?\d+\.?\d*", str(texto))
    return float(match.group()) if match else None


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


def velocidade_por_rpm(rpm_motor: np.ndarray) -> np.ndarray:
    """Converte RPM do motor em velocidade escalar linear da roda em m/s."""
    return np.abs(rpm_motor) * RPM_MOTOR_PARA_MPS


# ── Carregamento de CSVs ──────────────────────────────────────────────────────

def carregar_sinal(caminho: Path) -> pd.DataFrame | None:
    """
    Carrega um CSV de sinal da pipeline e extrai timestamps e valores numéricos.

    Retorna DataFrame com colunas [timestamp, valor] ordenado por timestamp,
    ou None se o arquivo não existir ou tiver dados insuficientes.
    """
    if not caminho.exists():
        print(f"  [ERRO] Arquivo não encontrado: {caminho.name}")
        return None

    df = pd.read_csv(caminho)
    df["timestamp"] = pd.to_numeric(df["timestamp"], errors="coerce")
    df["valor"]     = df["dado"].apply(extrair_valor)
    df = df.dropna(subset=["timestamp", "valor"]).sort_values("timestamp").reset_index(drop=True)

    if len(df) < 10:
        print(f"  [ERRO] {caminho.name} tem amostras insuficientes ({len(df)} < 10).")
        return None

    return df


def carregar_sinal_opcional(caminho: Path) -> pd.DataFrame | None:
    """Carrega um sinal quando existir, sem registrar erro em caso de ausência."""
    return carregar_sinal(caminho) if caminho.exists() else None


# ── Correção de bias ──────────────────────────────────────────────────────────

def corrigir_bias(valores: np.ndarray, percentil: float = 5.0) -> tuple[np.ndarray, float]:
    """
    Estima e remove o offset estático de um sinal de sensor.

    O bias é a média das amostras com magnitude abaixo do percentil 5%
    (momentos de quasi-repouso). Em repouso, o sinal real deve ser ~0;
    qualquer resíduo é erro do sensor.

    Retorna o array corrigido e o bias estimado.
    """
    magnitude      = np.abs(valores)
    limiar         = np.percentile(magnitude, percentil)
    amostras_repouso = valores[magnitude <= limiar]
    bias           = amostras_repouso.mean() if len(amostras_repouso) > 0 else 0.0
    return valores - bias, bias


def corrigir_bias_bordas(
    timestamps: np.ndarray,
    valores: np.ndarray,
    segundos: float,
) -> tuple[np.ndarray, float]:
    """
    Estima bias do giroscópio pela média das amostras nos primeiros e últimos
    ``segundos`` do log (pressupõe repouso ou baixa dinâmica nas bordas).
    Se o trecho for curto demais, cai no método do percentil 5%.
    """
    t0 = float(timestamps[0])
    t1 = float(timestamps[-1])
    dur = t1 - t0
    if dur < 2.0 * segundos + 0.5:
        return corrigir_bias(valores, percentil=5.0)
    mascara = (timestamps <= t0 + segundos) | (timestamps >= t1 - segundos)
    if int(np.sum(mascara)) < 5:
        return corrigir_bias(valores, percentil=5.0)
    bias = float(np.mean(valores[mascara]))
    return valores - bias, bias


# ── Filtro passa-baixa ────────────────────────────────────────────────────────

def aplicar_filtro_butterworth(
    valores: np.ndarray,
    taxa_amostragem: float,
    cutoff: float = FILTRO_CUTOFF,
    ordem: int = FILTRO_ORDEM,
) -> np.ndarray:
    """
    Aplica filtro Butterworth passa-baixa de fase zero (filtfilt).

    Usa frequência de Nyquist derivada da taxa de amostragem real do sinal.
    """
    nyquist = 0.5 * taxa_amostragem
    padlen_minimo = 3 * (ordem + 1)
    if taxa_amostragem <= 0 or cutoff >= nyquist or len(valores) <= padlen_minimo:
        return valores
    coef_b, coef_a = butter(ordem, cutoff / nyquist, btype="low")
    return filtfilt(coef_b, coef_a, valores)


# ── Integração trapezoidal ────────────────────────────────────────────────────

def integrar_trapezio(valores: np.ndarray, timestamps: np.ndarray, valor_inicial: float = 0.0) -> np.ndarray:
    """
    Integra um sinal por método trapezoidal usando timestamps reais.

    Robusto a taxas de amostragem irregulares e lacunas no log.
    Fórmula: integral[i] = integral[i-1] + 0.5 × (val[i] + val[i-1]) × Δt[i]
    """
    resultado    = np.zeros(len(valores))
    resultado[0] = valor_inicial
    for i in range(1, len(valores)):
        delta_t      = timestamps[i] - timestamps[i - 1]
        media        = 0.5 * (valores[i] + valores[i - 1])
        resultado[i] = resultado[i - 1] + media * delta_t
    return resultado


def montar_velocidade_rpm(
    df_rpm_a: pd.DataFrame | None,
    df_rpm_b: pd.DataFrame | None,
) -> tuple[np.ndarray, np.ndarray] | None:
    """
    Constrói uma série de velocidade linear a partir dos RPMs disponíveis.

    Quando A13 e B13 existem, interpola ambos na grade do sinal mais denso e
    usa a média dos dois motores. Se só um lado existir, usa esse lado.
    """
    sinais = [df for df in (df_rpm_a, df_rpm_b) if df is not None]
    if not sinais:
        return None

    df_base = max(sinais, key=len)
    t_base = df_base["timestamp"].to_numpy()
    velocidades = []

    for df in sinais:
        t = df["timestamp"].to_numpy()
        rpm = df["valor"].to_numpy()
        mascara = (t_base >= t[0]) & (t_base <= t[-1])
        if mascara.sum() < 10:
            continue
        interp_rpm = interp1d(t, rpm, kind="linear", bounds_error=False, fill_value=np.nan)
        vel = velocidade_por_rpm(interp_rpm(t_base))
        velocidades.append(vel)

    if not velocidades:
        return None

    matriz_vel = np.vstack(velocidades)
    vel_media = np.nanmean(matriz_vel, axis=0)
    mascara_valida = np.isfinite(vel_media)
    if mascara_valida.sum() < 10:
        return None

    return t_base[mascara_valida], vel_media[mascara_valida]


def fundir_velocidade_acc_rpm(
    timestamps: np.ndarray,
    acc_x: np.ndarray,
    vel_rpm: np.ndarray,
    peso_rpm: float = PESO_CORRECAO_RPM,
) -> np.ndarray:
    """
    Fusão complementar: ACC_X prediz a próxima velocidade; RPM corrige drift.

    v_pred = v[i-1] + integral(acc_x)
    v[i]   = (1 - peso_rpm) * v_pred + peso_rpm * v_rpm[i]
    """
    velocidade = np.zeros(len(timestamps))
    velocidade[0] = vel_rpm[0]

    for i in range(1, len(timestamps)):
        delta_t = timestamps[i] - timestamps[i - 1]
        acc_media = 0.5 * (acc_x[i] + acc_x[i - 1])
        vel_predita = velocidade[i - 1] + acc_media * delta_t
        velocidade[i] = (1.0 - peso_rpm) * vel_predita + peso_rpm * vel_rpm[i]

    return velocidade


# ── Tracking no mapa base: primeira volta vira mapa fixo ─────────────────────
# Regra de negócio modularizada em mapaRegraNegocio.py


# ── Pipeline principal ────────────────────────────────────────────────────────

def processar_diretorio(
    diretorio: Path,
    negar_yaw: bool = False,
    lap_period_sec: float | None = None,
    usar_track_map: bool = True,
    bias_yaw_bordas_sec: float | None = None,
) -> None:
    """
    Executa a reconstrução de trajetória 2D para um diretório de sessão.

    Preferencialmente espera encontrar ACT_SPEED_A13/B13, VENTOR_LINEAR_ACC_X
    e VENTOR_ANGULAR_SPEED_Z no diretório informado. Se RPM/ACC_X faltarem,
    tenta usar VENTOR_LINEAR_VEL_X ou VENTOR_LINEAR_VEL_Y como fallback.

    Tracking no mapa (opcional): após integrar x,y, estima o período de volta
    pela autocorrelação da velocidade (ou usa ``lap_period_sec``), congela a
    primeira volta como mapa base e projeta as posições seguintes nesse mapa.
    """
    print(f"\n{'─' * 60}")
    print(f"  [trajetoria] {diretorio.name}")
    print(f"{'─' * 60}")

    # ── Etapa 1: Carregar sinais ──────────────────────────────────────────────
    df_rpm_a = carregar_sinal_opcional(diretorio / "ACT_SPEED_A13.csv")
    df_rpm_b = carregar_sinal_opcional(diretorio / "ACT_SPEED_B13.csv")
    df_acc_x = carregar_sinal_opcional(diretorio / "VENTOR_LINEAR_ACC_X.csv")
    df_vel_x = carregar_sinal_opcional(diretorio / "VENTOR_LINEAR_VEL_X.csv")
    df_vel_y = carregar_sinal_opcional(diretorio / "VENTOR_LINEAR_VEL_Y.csv")
    df_yaw   = carregar_sinal(diretorio / "VENTOR_ANGULAR_SPEED_Z.csv")

    if df_yaw is None:
        print("  [skip] Sinal de yaw ausente. Execute extratorCandumpFiles.py antes.")
        return

    t_yaw = df_yaw["timestamp"].to_numpy()
    yaw   = df_yaw["valor"].to_numpy()

    # Lê metadados do sinal de yaw para propagar no CSV de saída
    can_id_yaw    = str(df_yaw["id_can"].iloc[0])
    prioridade_yaw = int(df_yaw["prioridade"].iloc[0])

    print(f"  YAW   : {len(yaw)} pts  |  Δt={t_yaw[-1]-t_yaw[0]:.1f}s")

    if negar_yaw:
        yaw = -yaw
        print("  [flag] --negar-yaw ativo: sinal do giroscópio invertido.")

    # ── Etapa 2: Correção de bias do giroscópio ───────────────────────────────
    if bias_yaw_bordas_sec is not None and bias_yaw_bordas_sec > 0:
        yaw_corrigido, bias_yaw = corrigir_bias_bordas(t_yaw, yaw, bias_yaw_bordas_sec)
        print(f"  Bias yaw (bordas): {bias_yaw:.6f} rad/s  (média nos primeiros/últimos {bias_yaw_bordas_sec:.1f}s)")
    else:
        yaw_corrigido, bias_yaw = corrigir_bias(yaw)
        print(f"  Bias yaw estimado : {bias_yaw:.6f} rad/s  (percentil 5%)")

    # ── Etapa 3: Filtro passa-baixa no giroscópio ─────────────────────────────
    intervalo_medio_yaw = np.diff(t_yaw).mean()
    fs_yaw              = 1.0 / intervalo_medio_yaw
    yaw_filtrado        = aplicar_filtro_butterworth(yaw_corrigido, fs_yaw)
    print(f"  Fs yaw detectada  : {fs_yaw:.2f} Hz  |  Cutoff filtro: {FILTRO_CUTOFF} Hz")

    # ── Etapa 4: Velocidade longitudinal ─────────────────────────────────────
    velocidade_rpm = montar_velocidade_rpm(df_rpm_a, df_rpm_b)
    usar_fusao_rpm = velocidade_rpm is not None and df_acc_x is not None

    if usar_fusao_rpm:
        t_rpm, vel_rpm = velocidade_rpm
        t_acc = df_acc_x["timestamp"].to_numpy()
        acc_x = df_acc_x["valor"].to_numpy()

        intervalo_medio_acc = np.diff(t_acc).mean()
        fs_acc = 1.0 / intervalo_medio_acc
        acc_x_corrigido, bias_acc_x = corrigir_bias(acc_x)
        acc_x_filtrado = aplicar_filtro_butterworth(acc_x_corrigido, fs_acc, cutoff=3.0)

        t_inicio_comum = max(t_rpm[0], t_acc[0], t_yaw[0])
        t_fim_comum = min(t_rpm[-1], t_acc[-1], t_yaw[-1])
        mascara_base = (t_rpm >= t_inicio_comum) & (t_rpm <= t_fim_comum)

        if mascara_base.sum() < 10:
            print("  [ERRO] Sobreposição temporal entre RPM, ACC_X e YAW é insuficiente (< 10 amostras).")
            print("         Verifique se os arquivos pertencem à mesma sessão.")
            return

        t_vel_comum = t_rpm[mascara_base]
        vel_rpm_comum = vel_rpm[mascara_base]

        interp_acc_x = interp1d(t_acc, acc_x_filtrado, kind="linear", bounds_error=False, fill_value=0.0)
        acc_x_interpolado = interp_acc_x(t_vel_comum)
        vel_comum = fundir_velocidade_acc_rpm(t_vel_comum, acc_x_interpolado, vel_rpm_comum)

        print(f"  Modo velocidade   : fusão RPM + ACC_X")
        print(f"  RPM→m/s           : raio={RAIO_RODA_POLEGADAS:.1f}pol  redução={FATOR_REDUCAO_PLANETARIA:.2f}  fator={RPM_MOTOR_PARA_MPS:.6f}")
        print(f"  ACC_X bias        : {bias_acc_x:.6f} m/s²  |  peso correção RPM: {PESO_CORRECAO_RPM:.2f}")
        print(f"  VEL_RPM média     : {np.nanmean(np.abs(vel_rpm_comum)):.2f} m/s  |  VEL_fusão média: {np.nanmean(np.abs(vel_comum)):.2f} m/s")
    else:
        df_vel = df_vel_x if df_vel_x is not None else df_vel_y
        if df_vel is None:
            print("  [skip] Sem RPM+ACC_X e sem VENTOR_LINEAR_VEL_X/Y para fallback.")
            return

        t_vel = df_vel["timestamp"].to_numpy()
        vel = df_vel["valor"].to_numpy()
        t_inicio_comum = max(t_vel[0], t_yaw[0])
        t_fim_comum = min(t_vel[-1], t_yaw[-1])
        mascara_vel = (t_vel >= t_inicio_comum) & (t_vel <= t_fim_comum)

        if mascara_vel.sum() < 10:
            print("  [ERRO] Sobreposição temporal entre VEL e YAW é insuficiente (< 10 amostras).")
            print("         Verifique se os arquivos pertencem à mesma sessão.")
            return

        t_vel_comum = t_vel[mascara_vel]
        vel_comum = vel[mascara_vel]
        print(f"  Modo velocidade   : fallback {df_vel['names'].iloc[0]} + yaw")

    # Interpolação linear do giroscópio filtrado nos timestamps da velocidade.
    interp_yaw     = interp1d(t_yaw, yaw_filtrado, kind="linear", bounds_error=False, fill_value=0.0)
    yaw_interpolado = interp_yaw(t_vel_comum)

    n_amostras = len(t_vel_comum)
    duracao    = t_vel_comum[-1] - t_vel_comum[0]
    print(f"  Grade comum       : {n_amostras} pts  |  {duracao:.1f}s  |  sobreposição [{t_inicio_comum:.2f}, {t_fim_comum:.2f}]")

    # ── Etapa 5: Integração do heading ────────────────────────────────────────
    # θ₀ = 0 (heading inicial arbitrário — norte local do sistema de coords)
    theta = integrar_trapezio(yaw_interpolado, t_vel_comum, valor_inicial=0.0)

    theta_min_deg = np.degrees(theta.min())
    theta_max_deg = np.degrees(theta.max())
    print(f"  Heading range     : [{theta_min_deg:.1f}°, {theta_max_deg:.1f}°]  (rotação total: {np.degrees(theta[-1]):.1f}°)")

    # ── Etapa 6: Decomposição em world frame ──────────────────────────────────
    vx = vel_comum * np.cos(theta)
    vy = vel_comum * np.sin(theta)

    # ── Etapa 7: Integração de posição ───────────────────────────────────────
    x = integrar_trapezio(vx, t_vel_comum, valor_inicial=0.0)
    y = integrar_trapezio(vy, t_vel_comum, valor_inicial=0.0)

    # ── Etapa 8: mapa base (1ª volta) + tracking de posição ──────────────────
    t_lap_efetivo: float | None = lap_period_sec
    if usar_track_map and lap_period_sec is None:
        t_auto, motivo = estimar_periodo_volta_segundos(t_vel_comum, vel_comum)
        t_lap_efetivo = t_auto
        if t_lap_efetivo is None:
            print(f"  Mapa/Tracking     : off — período não estimado ({motivo})")
        else:
            print(f"  Mapa/Tracking     : período auto {t_lap_efetivo:.2f}s ({motivo})")
    elif usar_track_map and lap_period_sec is not None:
        print(f"  Mapa/Tracking     : período fixo {t_lap_efetivo:.2f}s (CLI)")
    else:
        print("  Mapa/Tracking     : off (--no-track-map)")

    meta_track: dict = {}
    mapa_base = np.empty((0, 2))
    if usar_track_map and t_lap_efetivo is not None:
        x, y, mapa_base, meta_track = rastrear_no_mapa_primeira_volta(
            t_vel_comum, x, y, vel_comum, t_lap_efetivo
        )
        if meta_track.get("track_map"):
            print(
                "  Mapa/Tracking     : mapa fixo da 1ª volta "
                f"({meta_track['comprimento_mapa_m']:.1f}m, fechamento {meta_track['fechamento_primeira_volta_m']:.1f}m); "
                f"posição rastreada por {meta_track['n_voltas']} volta(s)"
            )
        elif meta_track.get("nota"):
            print(f"  Mapa/Tracking     : trajetória bruta ({meta_track['nota']})")

    # ── Etapa 9: Métricas de qualidade ───────────────────────────────────────
    erro_fechamento = np.sqrt((x[-1] - x[0])**2 + (y[-1] - y[0])**2)
    x_range = x.max() - x.min()
    y_range = y.max() - y.min()
    print(f"  Extensão trajetória : X=[{x.min():.1f}, {x.max():.1f}]m  Y=[{y.min():.1f}, {y.max():.1f}]m")
    print(f"  Erro de fechamento  : {erro_fechamento:.2f}m  (sobre extensão aprox. {max(x_range, y_range):.0f}m)")

    # ── Etapa 10: Salvar CSVs de trajetória ───────────────────────────────────
    # Usa o can_id do sinal de yaw como referência (origem da posição é a IMU)
    linhas_x = [
        montar_linha_csv("TRAJETORIA_X", t_vel_comum[i], can_id_yaw, prioridade_yaw, x[i], "m")
        for i in range(n_amostras)
    ]
    linhas_y = [
        montar_linha_csv("TRAJETORIA_Y", t_vel_comum[i], can_id_yaw, prioridade_yaw, y[i], "m")
        for i in range(n_amostras)
    ]

    caminho_x = diretorio / "TRAJETORIA_X.csv"
    caminho_y = diretorio / "TRAJETORIA_Y.csv"

    pd.DataFrame(linhas_x).to_csv(caminho_x, index=False)
    pd.DataFrame(linhas_y).to_csv(caminho_y, index=False)

    print(f"  → {caminho_x.name}")
    print(f"  → {caminho_y.name}")

    if len(mapa_base) > 0:
        t_mapa = np.linspace(t_vel_comum[0], t_vel_comum[0] + float(t_lap_efetivo), len(mapa_base))
        linhas_mapa_x = [
            montar_linha_csv("MAPA_BASE_X", t_mapa[i], can_id_yaw, prioridade_yaw, mapa_base[i, 0], "m")
            for i in range(len(mapa_base))
        ]
        linhas_mapa_y = [
            montar_linha_csv("MAPA_BASE_Y", t_mapa[i], can_id_yaw, prioridade_yaw, mapa_base[i, 1], "m")
            for i in range(len(mapa_base))
        ]
        caminho_mapa_x = diretorio / "MAPA_BASE_X.csv"
        caminho_mapa_y = diretorio / "MAPA_BASE_Y.csv"
        pd.DataFrame(linhas_mapa_x).to_csv(caminho_mapa_x, index=False)
        pd.DataFrame(linhas_mapa_y).to_csv(caminho_mapa_y, index=False)
        print(f"  → {caminho_mapa_x.name}")
        print(f"  → {caminho_mapa_y.name}")


# ── Ponto de entrada ──────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  RECONSTRUÇÃO DE TRAJETÓRIA — DEAD RECKONING")
    print("=" * 60)

    # Parse de argumentos
    raw = sys.argv[1:]
    negar_yaw = "--negar-yaw" in raw
    usar_track_map = "--no-track-map" not in raw and "--no-mini-slam" not in raw
    lap_period_sec: float | None = None
    bias_yaw_bordas_sec: float | None = None

    filtrado: list[str] = []
    i = 0
    while i < len(raw):
        a = raw[i]
        if a.startswith("--lap-period-sec="):
            try:
                v = float(a.split("=", 1)[1])
            except ValueError:
                print(f"\n[ERRO] Valor inválido em {a}")
                return
            if v <= 0:
                print(f"\n[ERRO] Período de volta deve ser positivo: {a}")
                return
            lap_period_sec = v
        elif a == "--lap-period-sec":
            if i + 1 >= len(raw):
                print("\n[ERRO] --lap-period-sec requer um número em seguida (ex.: --lap-period-sec 52.5)")
                return
            try:
                v = float(raw[i + 1])
            except ValueError:
                print(f"\n[ERRO] Valor inválido após --lap-period-sec: {raw[i + 1]}")
                return
            if v <= 0:
                print("\n[ERRO] --lap-period-sec deve ser positivo.")
                return
            lap_period_sec = v
            i += 1
        elif a.startswith("--bias-yaw-bordas-sec="):
            try:
                bv = float(a.split("=", 1)[1])
            except ValueError:
                print(f"\n[ERRO] Valor inválido em {a}")
                return
            if bv <= 0:
                print(f"\n[ERRO] --bias-yaw-bordas-sec deve ser positivo: {a}")
                return
            bias_yaw_bordas_sec = bv
        elif a == "--bias-yaw-bordas-sec":
            if i + 1 >= len(raw):
                print("\n[ERRO] --bias-yaw-bordas-sec requer um número (ex.: --bias-yaw-bordas-sec 3)")
                return
            try:
                bv = float(raw[i + 1])
            except ValueError:
                print(f"\n[ERRO] Valor inválido após --bias-yaw-bordas-sec: {raw[i + 1]}")
                return
            if bv <= 0:
                print("\n[ERRO] --bias-yaw-bordas-sec deve ser positivo.")
                return
            bias_yaw_bordas_sec = bv
            i += 1
        else:
            filtrado.append(a)
        i += 1

    caminhos = [a for a in filtrado if not a.startswith("--")]

    if not caminhos:
        print("\nUso: python3 getTrajetoria.py <dir> [--negar-yaw] [--no-track-map] [--lap-period-sec=T]")
        print("\nExemplos:")
        print("  python3 src/getTrajetoria.py data/processed/candump-1999-12-31/")
        print("  python3 src/getTrajetoria.py data/processed/candump-*/")
        print("  python3 src/getTrajetoria.py data/processed/candump-xyz/ --negar-yaw")
        print("  python3 src/getTrajetoria.py data/processed/candump-xyz/ --lap-period-sec 52.5")
        print("\nEspera encontrar no diretório:")
        print("  ACT_SPEED_A13/B13, VENTOR_LINEAR_ACC_X, VENTOR_ANGULAR_SPEED_Z (preferencial)")
        print("  ou VENTOR_LINEAR_VEL_X/Y + VENTOR_ANGULAR_SPEED_Z (fallback)")
        print("\n--negar-yaw: inverte o sinal do giroscópio (use se a trajetória sair espelhada).")
        print("--no-track-map: não projeta a posição no mapa da primeira volta (trajetória bruta contínua).")
        print("--no-mini-slam: alias legado de --no-track-map.")
        print("--lap-period-sec T ou --lap-period-sec=T: período de volta em segundos (substitui detecção automática).")
        print("--bias-yaw-bordas-sec S: bias do gyro pela média nos primeiros/últimos S segundos (repouso nas pontas).")
        return

    # Expande globs e resolve caminhos
    diretorios_processados = []
    for argumento in caminhos:
        caminho = Path(argumento)
        if caminho.is_dir():
            diretorios_processados.append(caminho)
        else:
            # Tenta glob relativo ao cwd
            expandidos = sorted(Path().glob(argumento))
            for p in expandidos:
                if p.is_dir():
                    diretorios_processados.append(p)

    if not diretorios_processados:
        print("\n[ERRO] Nenhum diretório válido encontrado nos argumentos fornecidos.")
        return

    for diretorio in diretorios_processados:
        processar_diretorio(
            diretorio,
            negar_yaw=negar_yaw,
            lap_period_sec=lap_period_sec,
            usar_track_map=usar_track_map,
            bias_yaw_bordas_sec=bias_yaw_bordas_sec,
        )

    print("\n" + "=" * 60)
    print("  TRAJETÓRIA CONCLUÍDA")
    print("=" * 60)
    print("  CSVs gerados: TRAJETORIA_X.csv, TRAJETORIA_Y.csv (+ MAPA_BASE_X/Y quando houver volta de referência)")
    print("  Execute o plotador para visualizar os resultados.")
    print("  Verifique o erro de fechamento — quanto menor, melhor a qualidade.\n")


if __name__ == "__main__":
    main()
