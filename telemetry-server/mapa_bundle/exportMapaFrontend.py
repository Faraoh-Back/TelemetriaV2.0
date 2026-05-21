"""
exportMapaFrontend.py
=====================
Exporta artefatos de mapa/tracking para consumo de frontend.

Para cada sessão em data/processed:
  - lê MAPA_BASE_X/Y (preferencial) ou TRAJETORIA_X/Y (fallback);
  - renderiza uma imagem da pista (track_map.png);
  - gera um JSON com timeline de posição no mapa (track_timeline.json).

Saída:
  data/processed/<sessao>/frontend/track_map.png
  data/processed/<sessao>/frontend/track_timeline.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


DIR_BASE = Path(__file__).resolve().parent.parent
DIR_PROCESSADO = DIR_BASE / "data" / "processed"


def _ler_valores_csv(caminho: Path) -> tuple[np.ndarray, np.ndarray] | None:
    if not caminho.exists():
        return None
    df = pd.read_csv(caminho)
    if df.empty or "dado" not in df.columns or "timestamp" not in df.columns:
        return None
    valores = df["dado"].astype(str).str.extract(r"([-\d.]+)", expand=False).astype(float).to_numpy()
    t = pd.to_numeric(df["timestamp"], errors="coerce").to_numpy()
    if len(valores) < 2:
        return None
    return t, valores


def _normalizar_xy(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    min_x, max_x = float(np.min(x)), float(np.max(x))
    min_y, max_y = float(np.min(y)), float(np.max(y))
    dx = max(max_x - min_x, 1e-9)
    dy = max(max_y - min_y, 1e-9)
    nx = (x - min_x) / dx
    ny = (y - min_y) / dy
    return nx, ny, {"minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y}


def exportar_sessao(pasta: Path) -> bool:
    mapa_x_csv = pasta / "MAPA_BASE_X.csv"
    mapa_y_csv = pasta / "MAPA_BASE_Y.csv"
    traj_x_csv = pasta / "TRAJETORIA_X.csv"
    traj_y_csv = pasta / "TRAJETORIA_Y.csv"

    # Mapa exibido no frontend: primeira volta quando disponível.
    dados_mx = _ler_valores_csv(mapa_x_csv)
    dados_my = _ler_valores_csv(mapa_y_csv)
    if dados_mx is not None and dados_my is not None:
        _, mapa_x = dados_mx
        _, mapa_y = dados_my
        fonte_mapa = "MAPA_BASE"
    else:
        dados_tx = _ler_valores_csv(traj_x_csv)
        dados_ty = _ler_valores_csv(traj_y_csv)
        if dados_tx is None or dados_ty is None:
            print(f"  [skip] {pasta.name}: sem MAPA_BASE nem TRAJETORIA para export.")
            return False
        _, mapa_x = dados_tx
        _, mapa_y = dados_ty
        fonte_mapa = "TRAJETORIA_FALLBACK"

    dados_tx = _ler_valores_csv(traj_x_csv)
    dados_ty = _ler_valores_csv(traj_y_csv)
    if dados_tx is None or dados_ty is None:
        print(f"  [skip] {pasta.name}: sem TRAJETORIA_X/Y para timeline.")
        return False

    t_traj, traj_x = dados_tx
    _, traj_y = dados_ty

    n_mapa = min(len(mapa_x), len(mapa_y))
    n_traj = min(len(traj_x), len(traj_y), len(t_traj))
    mapa_x, mapa_y = mapa_x[:n_mapa], mapa_y[:n_mapa]
    traj_x, traj_y, t_traj = traj_x[:n_traj], traj_y[:n_traj], t_traj[:n_traj]

    if n_mapa < 2 or n_traj < 2:
        print(f"  [skip] {pasta.name}: amostras insuficientes.")
        return False

    frontend_dir = pasta / "frontend"
    frontend_dir.mkdir(exist_ok=True)

    # Render do mapa para o painel atual do cockpit (que recebe imagem).
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.plot(mapa_x, mapa_y, color="#f2cc60", linewidth=2.6)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.tight_layout(pad=0)
    map_png = frontend_dir / "track_map.png"
    fig.savefig(map_png, dpi=180, bbox_inches="tight", pad_inches=0.02, facecolor="#0b1220")
    plt.close(fig)

    # JSON para evolução futura do backend/frontend com posição no mapa.
    n_muest = min(2000, n_traj)
    idx = np.linspace(0, n_traj - 1, n_muest).astype(int)
    tx = traj_x[idx]
    ty = traj_y[idx]
    tt = t_traj[idx]
    nx, ny, bounds = _normalizar_xy(mapa_x, mapa_y)
    pnx, pny, _ = _normalizar_xy(tx, ty)

    timeline = []
    for i in range(len(idx)):
        timeline.append(
            {
                "t": float(tt[i]),
                "vehicle": {"x": float(pnx[i]), "y": float(pny[i])},
            }
        )

    payload = {
        "session": pasta.name,
        "mapSource": fonte_mapa,
        "track": {
            "points": [[float(nx[i]), float(ny[i])] for i in range(len(nx))],
            "bounds": bounds,
        },
        "timeline": timeline,
    }

    json_path = frontend_dir / "track_timeline.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"  [ok] {pasta.name}: frontend/track_map.png + frontend/track_timeline.json ({fonte_mapa})")
    return True


def main() -> None:
    filtro = sys.argv[1].strip() if len(sys.argv) > 1 else None
    if not DIR_PROCESSADO.exists():
        print("[ERRO] data/processed/ não encontrado.")
        return

    pastas = sorted(
        p for p in DIR_PROCESSADO.iterdir()
        if p.is_dir() and (filtro is None or filtro in p.name)
    )
    if not pastas:
        print("[ERRO] Nenhuma sessão encontrada.")
        return

    print("=" * 60)
    print("  EXPORTAÇÃO FRONTEND — MAPA/TRACKING")
    print("=" * 60)
    ok = 0
    for p in pastas:
        if exportar_sessao(p):
            ok += 1
    print(f"\nConcluído: {ok}/{len(pastas)} sessão(ões) exportadas.")


if __name__ == "__main__":
    main()

