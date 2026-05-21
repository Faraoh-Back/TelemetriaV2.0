"""
mapaRegraNegocio.py
===================
Regra de negócio do mapa de pista:
  - detectar período de volta;
  - congelar a 1ª volta como MAPA_BASE;
  - rastrear a posição do veículo no mapa fixo por progresso escalar.
"""

from __future__ import annotations

import numpy as np

N_RESAMPLE_MAPA = 512


def resample_polyline_arclength(xy: np.ndarray, n_out: int) -> np.ndarray:
    if len(xy) < 2:
        return np.repeat(xy[:1], n_out, axis=0)
    d = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(d)])
    if s[-1] < 1e-9:
        return np.repeat(xy[:1], n_out, axis=0)
    u = np.linspace(0.0, s[-1], n_out)
    xp = np.interp(u, s, xy[:, 0])
    yp = np.interp(u, s, xy[:, 1])
    return np.column_stack([xp, yp])


def comprimento_arco(xy: np.ndarray) -> np.ndarray:
    if len(xy) < 2:
        return np.zeros(len(xy))
    d = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


def interpolar_por_arco(xy: np.ndarray, s_query: np.ndarray) -> np.ndarray:
    s = comprimento_arco(xy)
    if len(xy) == 0:
        return np.empty((0, 2))
    if s[-1] < 1e-9:
        return np.repeat(xy[:1], len(s_query), axis=0)
    s_clip = np.clip(s_query, 0.0, s[-1])
    xp = np.interp(s_clip, s, xy[:, 0])
    yp = np.interp(s_clip, s, xy[:, 1])
    return np.column_stack([xp, yp])


def distancia_acumulada_por_velocidade(t: np.ndarray, vel: np.ndarray) -> np.ndarray:
    s = np.zeros(len(t))
    for i in range(1, len(t)):
        delta_t = t[i] - t[i - 1]
        v_media = 0.5 * (abs(vel[i]) + abs(vel[i - 1]))
        s[i] = s[i - 1] + v_media * delta_t
    return s


def estimar_periodo_volta_segundos(t: np.ndarray, vel: np.ndarray) -> tuple[float | None, str]:
    if len(vel) < 100:
        return None, "poucas_amostras"
    dt = float(np.median(np.diff(t)))
    if dt <= 0:
        return None, "dt_invalido"
    sig = vel - float(np.mean(vel))
    n = len(sig)
    full = np.correlate(sig, sig, mode="full")
    mid = n - 1
    ac = full[mid:]
    min_lag = max(3, int(12.0 / dt))
    max_lag = min(n - 2, int(min(360.0 / dt, (t[-1] - t[0]) * 0.48 / dt)))
    if max_lag <= min_lag + 10:
        return None, "duracao_ou_fs_insuficiente"
    janela = ac[min_lag:max_lag]
    pico_rel = int(np.argmax(janela))
    pico_lag = min_lag + pico_rel
    if ac[0] <= 1e-18:
        return None, "sinal_plano"
    if janela[pico_rel] < 0.22 * ac[0]:
        return None, "pico_autocorr_fraco"
    t_lap = pico_lag * dt
    if (t[-1] - t[0]) < t_lap * 1.28:
        return None, "menos_de_duas_voltas_aprox"
    return float(t_lap), "ok"


def rastrear_no_mapa_primeira_volta(
    t: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    vel: np.ndarray,
    t_lap: float,
    n_resample: int = N_RESAMPLE_MAPA,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    meta: dict = {"track_map": False, "T_lap": float(t_lap), "n_voltas": 0, "nota": ""}
    t0 = float(t[0])
    dur = float(t[-1] - t0)
    if dur < t_lap * 1.25:
        meta["nota"] = "duracao_curta_para_multiplas_voltas"
        return x, y, np.empty((0, 2)), meta

    idx_mapa = np.flatnonzero((t >= t0) & (t <= t0 + t_lap))
    if len(idx_mapa) < 30:
        meta["nota"] = "primeira_volta_curta"
        return x, y, np.empty((0, 2)), meta

    mapa_raw = np.column_stack([x[idx_mapa], y[idx_mapa]])
    fechamento = float(np.linalg.norm(mapa_raw[-1] - mapa_raw[0]))
    mapa_fechado = np.vstack([mapa_raw, mapa_raw[0]])
    mapa = resample_polyline_arclength(mapa_fechado, n_resample)
    comprimento_mapa = float(comprimento_arco(mapa)[-1])
    if comprimento_mapa < 1e-6:
        meta["nota"] = "mapa_base_degenerado"
        return x, y, np.empty((0, 2)), meta

    s_total = distancia_acumulada_por_velocidade(t, vel)
    s_mapa = np.mod(s_total, comprimento_mapa)
    xy_track = interpolar_por_arco(mapa, s_mapa)

    meta["track_map"] = True
    meta["n_voltas"] = int(np.floor(s_total[-1] / comprimento_mapa)) + 1
    meta["comprimento_mapa_m"] = comprimento_mapa
    meta["fechamento_primeira_volta_m"] = fechamento
    meta["nota"] = "ok"
    return xy_track[:, 0], xy_track[:, 1], mapa, meta

