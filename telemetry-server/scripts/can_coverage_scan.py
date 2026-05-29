#!/usr/bin/env python3
import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set, Tuple

CSV_DIR = Path('/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/csv_data')
DBC_DIR = Path('/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/dbc_data')
REPORT_MD = Path('/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/reports/can-coverage-report.md')
REPORT_JSON = Path('/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/reports/can-coverage-report.json')

BO_RE = re.compile(r'^BO_\s+(\d+)\s+([^:]+):\s+(\d+)\s+')
SG_RE = re.compile(r'^SG_\s+([^:]+?)\s*:\s*(\d+)\|(\d+)@(0|1)([+-])\s*\(([^,]+),([^\)]+)\).*?"([^"]*)"')

@dataclass(frozen=True)
class Sig:
    name: str
    start_bit: int
    length: int
    factor: str
    offset: str
    unit: str
    byte_order: str
    signed: bool


def normalize_signal_name(name: str) -> str:
    n = name.strip().lower()
    n = n.replace('_', ' ')
    n = re.sub(r'\s+', ' ', n).strip()
    n = re.sub(r'\s+\d+$', '', n)
    n = re.sub(r'_(\d+)$', '', n)
    return n


def norm_num_str(s: str) -> str:
    try:
        return f"{float(s):.12g}"
    except Exception:
        return s.strip()


def parse_csv_inventory() -> Dict[int, List[Sig]]:
    inv: Dict[int, List[Sig]] = {}
    for path in sorted(CSV_DIR.glob('*.csv')):
        rows = path.read_text(errors='replace').splitlines()
        current_can = None
        for line in rows:
            cols = next(csv.reader([line])) if line else []
            if not cols:
                continue
            first = cols[0].strip() if len(cols) > 0 else ''
            second = cols[1].strip() if len(cols) > 1 else ''

            if first and second.startswith('0x'):
                try:
                    current_can = int(second, 16)
                    inv.setdefault(current_can, [])
                except ValueError:
                    current_can = None
                continue

            if first == '' and current_can is not None and len(cols) >= 9:
                name = cols[1].strip()
                pos = cols[2].strip().lower()
                vtype = cols[3].strip().lower()
                factor = norm_num_str(cols[6])
                offset = norm_num_str(cols[7])
                unit = cols[8].strip()
                if not name or not pos:
                    continue
                parsed = parse_csv_pos(pos)
                if not parsed:
                    continue
                sb, ln = parsed
                inv[current_can].append(Sig(
                    name=name,
                    start_bit=sb,
                    length=ln,
                    factor=factor,
                    offset=offset,
                    unit=unit,
                    byte_order='intel',
                    signed=('int' in vtype and ln > 1),
                ))
    return inv


def parse_csv_pos(pos: str):
    if pos.startswith('bit(') and pos.endswith(')'):
        inner = pos[4:-1]
        return parse_range(inner, 1)
    if pos.startswith('byte(') and pos.endswith(')'):
        inner = pos[5:-1]
        return parse_range(inner, 8)
    return None


def parse_range(inner: str, mult: int):
    if '-' in inner:
        a, b = inner.split('-', 1)
        try:
            a_i = int(a.strip())
            b_i = int(b.strip())
        except ValueError:
            return None
        return a_i * mult, (b_i - a_i + 1) * mult
    try:
        i = int(inner.strip())
    except ValueError:
        return None
    return i * mult, mult


def parse_dbc_inventory() -> Dict[int, List[Sig]]:
    inv: Dict[int, List[Sig]] = {}
    for path in sorted(DBC_DIR.glob('*.dbc')):
        cur_can = None
        for raw in path.read_text(errors='replace').splitlines():
            line = raw.strip()
            m_bo = BO_RE.match(line)
            if m_bo:
                raw_id = int(m_bo.group(1))
                can_id = raw_id & 0x1FFFFFFF
                cur_can = can_id
                inv.setdefault(cur_can, [])
                continue
            if cur_can is None:
                continue
            m_sg = SG_RE.match(line)
            if not m_sg:
                continue
            name = m_sg.group(1).strip().split()[0]
            start_bit = int(m_sg.group(2))
            length = int(m_sg.group(3))
            bo = 'motorola' if m_sg.group(4) == '0' else 'intel'
            signed = (m_sg.group(5) == '-')
            factor = norm_num_str(m_sg.group(6))
            offset = norm_num_str(m_sg.group(7))
            unit = m_sg.group(8).strip()
            inv[cur_can].append(Sig(
                name=name,
                start_bit=start_bit,
                length=length,
                factor=factor,
                offset=offset,
                unit=unit,
                byte_order=bo,
                signed=signed,
            ))
    return inv


def to_name_map(sigs: List[Sig]) -> Dict[str, Sig]:
    out = {}
    for s in sigs:
        out[s.name] = s
    return out


def to_norm_name_map(sigs: List[Sig]) -> Dict[str, Sig]:
    out = {}
    for s in sigs:
        key = normalize_signal_name(s.name)
        if key and key not in out:
            out[key] = s
    return out


def main():
    csv_inv = parse_csv_inventory()
    dbc_inv = parse_dbc_inventory()

    csv_ids = set(csv_inv.keys())
    dbc_ids = set(dbc_inv.keys())

    missing_in_dbc = sorted(csv_ids - dbc_ids)
    missing_in_csv = sorted(dbc_ids - csv_ids)
    common = sorted(csv_ids & dbc_ids)

    id_reports = []
    mismatch_count = 0
    for cid in common:
        c_map = to_name_map(csv_inv[cid])
        d_map = to_name_map(dbc_inv[cid])
        c_norm = to_norm_name_map(csv_inv[cid])
        d_norm = to_norm_name_map(dbc_inv[cid])
        c_names = set(c_map.keys())
        d_names = set(d_map.keys())

        only_csv_raw = sorted(c_names - d_names)
        only_dbc_raw = sorted(d_names - c_names)
        only_csv = [n for n in only_csv_raw if normalize_signal_name(n) not in d_norm]
        only_dbc = [n for n in only_dbc_raw if normalize_signal_name(n) not in c_norm]
        param_mismatch = []
        name_matched_by_normalization = []

        for name in sorted(c_names & d_names):
            c = c_map[name]
            d = d_map[name]
            diffs = []
            if c.start_bit != d.start_bit:
                diffs.append(f'start_bit csv={c.start_bit} dbc={d.start_bit}')
            if c.length != d.length:
                diffs.append(f'length csv={c.length} dbc={d.length}')
            if c.byte_order != d.byte_order:
                diffs.append(f'byte_order csv={c.byte_order} dbc={d.byte_order}')
            if c.signed != d.signed:
                diffs.append(f'signed csv={c.signed} dbc={d.signed}')
            if c.factor != d.factor:
                diffs.append(f'factor csv={c.factor} dbc={d.factor}')
            if c.offset != d.offset:
                diffs.append(f'offset csv={c.offset} dbc={d.offset}')
            if c.unit != d.unit:
                diffs.append(f'unit csv={c.unit!r} dbc={d.unit!r}')
            if diffs:
                param_mismatch.append({'signal': name, 'diffs': diffs})

        # matching by normalized names reduces false positives from naming style differences
        exact_intersection = c_names & d_names
        for n in (c_names - exact_intersection):
            nn = normalize_signal_name(n)
            if nn in d_norm and n not in only_csv:
                name_matched_by_normalization.append((n, d_norm[nn].name))

        mismatch_count += len(param_mismatch)
        id_reports.append({
            'can_id': cid,
            'can_hex': f'0x{cid:08X}',
            'signals_csv': len(c_names),
            'signals_dbc': len(d_names),
            'missing_signals_in_dbc': only_csv,
            'missing_signals_in_csv': only_dbc,
            'name_matched_by_normalization': name_matched_by_normalization,
            'param_mismatch': param_mismatch,
            'status': (
                'migrado' if not only_csv and not only_dbc and not param_mismatch
                else 'parcial'
            )
        })

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

    summary = {
        'generated_at': now,
        'csv_files': len(list(CSV_DIR.glob('*.csv'))),
        'dbc_files': len(list(DBC_DIR.glob('*.dbc'))),
        'csv_can_ids': len(csv_ids),
        'dbc_can_ids': len(dbc_ids),
        'common_can_ids': len(common),
        'missing_in_dbc': len(missing_in_dbc),
        'missing_in_csv': len(missing_in_csv),
        'param_mismatch_signals': mismatch_count,
    }

    REPORT_JSON.write_text(json.dumps({
        'summary': summary,
        'missing_in_dbc': [f'0x{x:08X}' for x in missing_in_dbc],
        'missing_in_csv': [f'0x{x:08X}' for x in missing_in_csv],
        'common_reports': id_reports,
    }, indent=2, ensure_ascii=False))

    lines = []
    lines.append('# CAN Coverage Report (CSV x DBC)')
    lines.append('')
    lines.append(f'- Gerado em: `{now}`')
    lines.append(f'- CSV files: `{summary["csv_files"]}` | DBC files: `{summary["dbc_files"]}`')
    lines.append(f'- CAN IDs CSV: `{summary["csv_can_ids"]}`')
    lines.append(f'- CAN IDs DBC: `{summary["dbc_can_ids"]}`')
    lines.append(f'- Interseção: `{summary["common_can_ids"]}`')
    lines.append(f'- Faltando no DBC: `{summary["missing_in_dbc"]}`')
    lines.append(f'- Só no DBC: `{summary["missing_in_csv"]}`')
    lines.append(f'- Divergências de parâmetros (sinais): `{summary["param_mismatch_signals"]}`')
    lines.append('')

    lines.append('## CAN IDs faltando no DBC (presentes em CSV)')
    lines.append('')
    if missing_in_dbc:
        for cid in missing_in_dbc[:120]:
            lines.append(f'- `0x{cid:08X}`')
    else:
        lines.append('- Nenhum.')
    lines.append('')

    lines.append('## CAN IDs só no DBC (não presentes em CSV)')
    lines.append('')
    if missing_in_csv:
        for cid in missing_in_csv[:120]:
            lines.append(f'- `0x{cid:08X}`')
    else:
        lines.append('- Nenhum.')
    lines.append('')

    lines.append('## Interseção: status por CAN ID')
    lines.append('')
    lines.append('| CAN ID | CSV sinais | DBC sinais | Status |')
    lines.append('|---|---:|---:|---|')
    for r in id_reports:
        lines.append(f"| `{r['can_hex']}` | {r['signals_csv']} | {r['signals_dbc']} | {r['status']} |")
    lines.append('')

    lines.append('## Divergências detalhadas (primeiras 50)')
    lines.append('')
    shown = 0
    for r in id_reports:
        if shown >= 50:
            break
        if not r['missing_signals_in_dbc'] and not r['missing_signals_in_csv'] and not r['param_mismatch']:
            continue
        lines.append(f"### {r['can_hex']}")
        if r['missing_signals_in_dbc']:
            lines.append(f"- missing_in_dbc: {', '.join(r['missing_signals_in_dbc'][:20])}")
        if r['missing_signals_in_csv']:
            lines.append(f"- missing_in_csv: {', '.join(r['missing_signals_in_csv'][:20])}")
        if r['name_matched_by_normalization']:
            pairs = [f"{a} -> {b}" for a, b in r['name_matched_by_normalization'][:10]]
            lines.append(f"- name_matched_by_normalization: {', '.join(pairs)}")
        for pm in r['param_mismatch'][:10]:
            lines.append(f"- param_mismatch `{pm['signal']}`: {'; '.join(pm['diffs'])}")
        lines.append('')
        shown += 1

    REPORT_MD.write_text('\n'.join(lines) + '\n')
    print(f'Wrote: {REPORT_MD}')
    print(f'Wrote: {REPORT_JSON}')


if __name__ == '__main__':
    main()
