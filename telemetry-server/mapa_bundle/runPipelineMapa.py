"""
runPipelineMapa.py
==================
Pipeline focada na regra de negócio do mapa:
  1) velocidade por aceleração (com corte de parado),
  2) trajetória com mapa base (1ª volta),
  3) exportação para frontend.

Uso:
  python3 src/runPipelineMapa.py
  python3 src/runPipelineMapa.py --lap-period-sec 45 --bias-yaw-bordas-sec 3
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


DIR_BASE = Path(__file__).resolve().parent.parent
DIR_SRC = DIR_BASE / "src"
DIR_PROCESSADO = DIR_BASE / "data" / "processed"

SCRIPT_GET_VELOCIDADE = DIR_SRC / "getVelocidade.py"
SCRIPT_GET_TRAJETORIA = DIR_SRC / "getTrajetoria.py"
SCRIPT_EXPORT_FRONT = DIR_SRC / "exportMapaFrontend.py"


def exec_script(script: Path, args: list[str]) -> bool:
    cmd = [sys.executable, str(script), *args]
    print(f"\n>>> {script.name} {' '.join(args)}")
    r = subprocess.run(cmd, cwd=str(DIR_BASE))
    return r.returncode == 0


def coletar_acc_csvs() -> list[Path]:
    return sorted(DIR_PROCESSADO.glob("**/VENTOR_LINEAR_ACC_*.csv"))


def coletar_sessoes_candump() -> list[Path]:
    return sorted(
        p for p in DIR_PROCESSADO.glob("candump-*")
        if p.is_dir() and (p / "VENTOR_ANGULAR_SPEED_Z.csv").exists()
    )


def extrair_flags(argv: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in {"--lap-period-sec", "--bias-yaw-bordas-sec"} and i + 1 < len(argv):
            out.extend([a, argv[i + 1]])
            i += 1
        elif a.startswith("--lap-period-sec=") or a.startswith("--bias-yaw-bordas-sec="):
            out.append(a)
        elif a in {"--no-track-map", "--negar-yaw"}:
            out.append(a)
        i += 1
    return out


def main() -> None:
    flags = extrair_flags(sys.argv[1:])
    acc_csvs = coletar_acc_csvs()
    sessoes = coletar_sessoes_candump()

    if not acc_csvs:
        print("[ERRO] Nenhum VENTOR_LINEAR_ACC_*.csv encontrado em data/processed.")
        sys.exit(1)
    if not sessoes:
        print("[ERRO] Nenhuma sessão candump com YAW encontrada em data/processed.")
        sys.exit(1)

    ok = exec_script(SCRIPT_GET_VELOCIDADE, [*(str(p) for p in acc_csvs)])
    if not ok:
        sys.exit(1)

    ok = exec_script(SCRIPT_GET_TRAJETORIA, [*(str(p) for p in sessoes), *flags])
    if not ok:
        sys.exit(1)

    ok = exec_script(SCRIPT_EXPORT_FRONT, [])
    if not ok:
        sys.exit(1)

    print("\nPipeline de mapa concluída com sucesso.")


if __name__ == "__main__":
    main()

