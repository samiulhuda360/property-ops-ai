"""Arrears-risk model for Property Ops AI.

Generates a synthetic 24-month rent-payment history for 60 tenancies, trains a
logistic-regression model that predicts which tenancies go 30+ days behind in
the three months after a cutoff, backtests it on the held-out final quarter and
exports the weights to JSON so the Node server can score tenancies without
Python at runtime.

Subcommands: generate, train, score, all. Default paths resolve from the repo
root (two levels above this file). Everything is seeded, so repeated runs write
byte-identical files.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "risk"
REPORT = ROOT / "eval" / "results" / "risk.md"
SEED = 20261
STAMP = "2026-10-23"  # fixed so re-runs are byte-identical; override with --stamp
FIRST_MONTH = (2024, 10)
MONTH_COUNT = 24
CUTOFF = "2026-06"
LABEL_MONTHS = ["2026-07", "2026-08", "2026-09"]
TRAIN_CUTOFFS = ["2025-09", "2025-12", "2026-03"]
FEATURES = [
    "late_share_6", "avg_days_late_6", "late_trend", "partial_count_6",
    "missed_count_12", "max_days_late_12", "prior_arrears", "tenancy_months",
    "rent_ratio", "balance_ratio",
]
BANDS = {"high": 0.5, "medium": 0.25}
PROFILE_COUNTS = {
    "reliable": 23, "occasional_late": 12, "chronic_late": 7, "partial_payer": 6,
    "seasonal": 4, "deteriorating": 5, "shock": 3,
}

# code, first, last, address, suburb, city, weekly rent, weekly market, start, beds, baths
Spec = tuple[str, str, str, str, str, str, int, int, str, int, float]
ACME: list[Spec] = [
    ("MTE14", "Aroha", "Ngata", "14 Kowhai Road", "Mount Eden", "Auckland", 720, 740, "2025-02-10", 3, 1.5),
    ("PON7", "Daniel", "Kim", "7 Vine Street", "Ponsonby", "Auckland", 650, 640, "2024-11-04", 2, 1),
    ("GLN22", "Mele", "Fifita", "22 Ash Street", "Glen Innes", "Auckland", 610, 600, "2025-06-02", 3, 1),
    ("HND5", "Ben", "Carter", "5 Rimu Crescent", "Henderson", "Auckland", 680, 700, "2023-09-18", 4, 2),
    ("TAK9", "Sophie", "Clarke", "9 Totara Avenue", "Takapuna", "Auckland", 780, 790, "2025-01-13", 3, 2),
    ("ONE3", "Tom", "Wright", "3/41 Arthur Street", "Onehunga", "Auckland", 560, 540, "2026-03-02", 2, 1),
    ("PAP18", "Ana", "Tupou", "18 Matai Road", "Papatoetoe", "Auckland", 590, 580, "2024-07-22", 3, 1),
    ("NLN11", "Liam", "O'Brien", "11 Kauri Lane", "New Lynn", "Auckland", 540, 520, "2025-10-06", 2, 1),
    ("MRB6", "Hannah", "Lee", "6 Tui Terrace", "Mairangi Bay", "Auckland", 850, 860, "2024-04-15", 4, 2),
    ("AVD25", "Wiremu", "Parata", "25 Puriri Street", "Avondale", "Auckland", 600, 590, "2025-08-25", 3, 1),
    ("RMU8", "Lucy", "Bennett", "8 Fern Road", "Remuera", "Auckland", 880, 870, "2022-03-14", 3, 2),
    ("GLF12", "Max", "Thompson", "12 Harbour View Road", "Glenfield", "Auckland", 640, 650, "2023-05-08", 3, 1),
    ("MTR31", "Chloe", "Walker", "31 Pine Street", "Mount Roskill", "Auckland", 590, 560, "2021-08-02", 3, 1),
    ("BKL4", "Ethan", "Hughes", "4 Lagoon Drive", "Blockhouse Bay", "Auckland", 620, 610, "2024-01-15", 2, 1),
    ("PKR19", "Grace", "Mitchell", "19 Manukau Road", "Parnell", "Auckland", 760, 770, "2025-04-07", 2, 1),
    ("HWK27", "Jacob", "Reid", "27 Seaview Terrace", "Howick", "Auckland", 700, 690, "2022-11-21", 4, 2),
    ("MNG6", "Olivia", "Scott", "6 Kahikatea Lane", "Mangere", "Auckland", 520, 480, "2021-04-12", 3, 1),
    ("PKG15", "Noah", "Foster", "15 Bay Road", "Pakuranga", "Auckland", 690, 700, "2023-02-27", 3, 1.5),
    ("EPS3", "Emily", "Dawson", "3/18 Ranfurly Road", "Epsom", "Auckland", 820, 830, "2024-08-19", 3, 2),
    ("MNW21", "Charlie", "Baker", "21 Rata Street", "Manurewa", "Auckland", 480, 470, "2022-06-06", 3, 1),
    ("BRW9", "Amber", "Hart", "9 Orchard Road", "Browns Bay", "Auckland", 710, 720, "2025-11-17", 3, 1),
    ("PTC13", "Lachlan", "Price", "13 Elm Street", "Point Chevalier", "Auckland", 750, 740, "2021-10-04", 3, 1),
    ("GRL44", "Mia", "Robinson", "44 Willow Avenue", "Grey Lynn", "Auckland", 790, 730, "2023-07-10", 2, 1),
    ("FLB7", "Henry", "Marsh", "7 Mahoe Road", "Flat Bush", "Auckland", 660, 670, "2024-03-04", 4, 2),
    ("TTH2", "Isabella", "Grant", "2/9 Beach Road", "Titirangi", "Auckland", 600, 590, "2026-02-09", 2, 1),
    ("ALB16", "Oscar", "Jennings", "16 Rosedale Road", "Albany", "Auckland", 730, 740, "2022-09-19", 3, 2),
    ("PKA28", "Ruby", "Lawson", "28 Great South Road", "Papakura", "Auckland", 470, 460, "2023-12-11", 2, 1),
    ("MLB10", "Leo", "Fletcher", "10 Kohe Street", "Mount Albert", "Auckland", 670, 680, "2025-09-01", 3, 1),
    ("SNY5", "Zoe", "Harper", "5 Harbour Street", "Sandringham", "Auckland", 630, 620, "2021-02-15", 2, 1),
    ("MLW33", "Alfie", "Cooper", "33 Birch Grove", "Massey", "Auckland", 450, 430, "2024-06-24", 2, 1),
]
KESTREL: list[Spec] = [
    ("DID14", "Oliver", "Brooks", "14 Burton Road", "Didsbury", "Manchester", 265, 270, "2024-09-02", 2, 1),
    ("ANC7B", "Amelia", "Hughes", "Flat 7B, 3 Mill Street", "Ancoats", "Manchester", 230, 225, "2025-03-10", 1, 1),
    ("HEA22", "George", "Turner", "22 Heaton Moor Road", "Heaton Moor", "Stockport", 300, 310, "2023-11-06", 3, 1),
    ("HDG9", "Isla", "Morgan", "9 Cardigan Road", "Headingley", "Leeds", 390, 380, "2025-07-01", 4, 2),
    ("SAL41", "Harry", "Evans", "41 Washway Road", "Sale", "Manchester", 285, 290, "2024-05-20", 3, 1.5),
    ("CHO18", "Freya", "Collins", "18 Beech Road", "Chorlton", "Manchester", 275, 265, "2026-01-12", 2, 1),
    ("PRE5", "Jack", "Murphy", "5 Bury Old Road", "Prestwich", "Manchester", 255, 260, "2024-02-05", 3, 1),
    ("WTH12", "Charlotte", "Bell", "12 Palatine Road", "Withington", "Manchester", 240, 245, "2022-04-11", 2, 1),
    ("FAL3", "James", "Pearce", "3 Crescent Road", "Fallowfield", "Manchester", 215, 210, "2023-09-04", 2, 1),
    ("LEV27", "Megan", "Ward", "27 Barlow Moor Road", "Levenshulme", "Manchester", 205, 200, "2021-06-14", 2, 1),
    ("CHE8", "William", "Hayes", "8 Oak Lane", "Cheadle", "Stockport", 290, 300, "2024-04-01", 3, 1),
    ("BRM15", "Ella", "Richardson", "15 Wellington Road", "Bramhall", "Stockport", 340, 350, "2022-10-17", 3, 2),
    ("URM21", "Thomas", "Grey", "21 Station Road", "Urmston", "Manchester", 250, 235, "2021-11-08", 2, 1),
    ("CHP9", "Daisy", "Nolan", "9 Harrogate Road", "Chapel Allerton", "Leeds", 310, 320, "2023-03-13", 3, 1),
    ("RND4", "Samuel", "Watts", "4 Park Avenue", "Roundhay", "Leeds", 360, 370, "2025-05-12", 3, 2),
    ("HYD17", "Lily", "Barnes", "17 Victoria Road", "Hyde Park", "Leeds", 230, 215, "2024-09-30", 2, 1),
    ("MRP6", "Joseph", "Carr", "6 Lime Walk", "Marple", "Stockport", 270, 280, "2022-01-24", 2, 1),
    ("NQT11", "Poppy", "Sheridan", "Apartment 11, 7 Tib Street", "Northern Quarter", "Manchester", 410, 400, "2025-02-03", 2, 2),
    ("ECC33", "Edward", "Lowe", "33 Monton Road", "Eccles", "Manchester", 195, 205, "2021-03-01", 2, 1),
    ("STR19", "Florence", "Dyer", "19 Park Road", "Stretford", "Manchester", 235, 240, "2023-06-19", 2, 1),
    ("HOR5", "Arthur", "Kane", "5 Stanningley Road", "Horsforth", "Leeds", 300, 290, "2024-11-10", 3, 1),
    ("ALT24", "Martha", "Quinn", "24 Dunham Road", "Altrincham", "Manchester", 395, 410, "2022-07-04", 4, 2),
    ("GTN7", "Louis", "Fraser", "7 Nelstrop Road", "Gorton", "Manchester", 185, 190, "2021-09-20", 2, 1),
    ("DRS2", "Evie", "Shaw", "2 Chatsworth Road", "Droylsden", "Manchester", 200, 185, "2023-01-16", 2, 1),
    ("MSH14", "Alexander", "Bright", "14 Moss Lane", "Moston", "Manchester", 190, 195, "2026-04-06", 1, 1),
    ("KRK26", "Rosie", "Hale", "26 Abbey Road", "Kirkstall", "Leeds", 245, 250, "2024-07-15", 2, 1),
    ("DDS31", "Freddie", "Wells", "31 Gatley Road", "Didsbury", "Manchester", 330, 335, "2022-12-05", 3, 1),
    ("WDL9", "Isabel", "Moss", "9 Woodley Lane", "Woodley", "Stockport", 225, 230, "2025-12-01", 2, 1),
    ("ARM16", "Theo", "Lambert", "16 Ridge Road", "Armley", "Leeds", 180, 175, "2021-05-10", 1, 1),
    ("MDL8", "Harriet", "Stone", "8 Middleton Road", "Middleton", "Manchester", 210, 220, "2026-03-02", 2, 1),
]


@dataclass
class Tenancy:
    id: str
    company: str
    code: str
    firstName: str
    lastName: str
    address: str
    suburb: str
    city: str
    weeklyRent: int
    weeklyMarketRent: int
    start: str
    bedrooms: int
    bathrooms: float


@dataclass
class Row:
    month: str
    dueDate: str
    rentDue: float
    paidAmount: float
    paidDate: str | None
    daysLate: int
    arrears30: bool


def monthly(weekly: float) -> float:
    return round(weekly * 52 / 12, 2)


def month_key(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7])


def month_list() -> list[str]:
    y, m = FIRST_MONTH
    return [f"{y + (m - 1 + i) // 12:04d}-{(m - 1 + i) % 12 + 1:02d}" for i in range(MONTH_COUNT)]


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


# ----------------------------------------------------------------------------- generate
def build_roster() -> list[Tenancy]:
    out: list[Tenancy] = []
    for company, specs in (("acme", ACME), ("kestrel", KESTREL)):
        for code, first, last, addr, suburb, city, rent, market, start, beds, baths in specs:
            out.append(Tenancy(f"{company}-{code}", company, code, first, last, addr, suburb,
                               city, rent, market, start, beds, baths))
    assert len(out) == 60 and len({t.id for t in out}) == 60
    return out


def simulate(t: Tenancy, profile: str, months: list[str], rng: np.random.Generator) -> list[Row]:
    """Simulate one tenancy's monthly payments from its hidden profile."""
    rent = monthly(t.weeklyRent)
    active = [m for m in months if month_key(m) >= month_key(t.start[:7])]
    last_idx = len(months) - 1
    break_at = last_idx - int(rng.integers(3, 7)) + 1  # deteriorating: first arrears month
    shock_at = last_idx - int(rng.integers(0, 4))      # shock: the missed month
    rows: list[Row] = []
    shortfall = 0.0
    for m in active:
        gi = months.index(m)
        mon = int(m[5:7])
        winter = mon in (12, 1)
        late, paid, missed = 0, rent, False
        if profile == "reliable":
            if rng.random() < 0.10 + (0.08 if winter else 0):
                late = int(rng.integers(1, 5))
        elif profile == "occasional_late":
            if rng.random() < 0.30 + (0.10 if winter else 0):
                late = int(rng.integers(3, 13))
        elif profile == "chronic_late":
            u = rng.random()
            if u < 0.04:                      # the odd month skipped outright
                missed, late = True, 60
            elif u < 0.85:
                late = int(rng.integers(25, 36)) if rng.random() < 0.18 else int(rng.integers(5, 21))
        elif profile == "partial_payer":
            u = rng.random()
            if u < 0.35:                      # two parts, second part late
                late = int(rng.integers(5, 21))
            elif u < 0.55:                    # short month
                paid = round(rent * float(rng.uniform(0.5, 0.8)), 2)
            elif shortfall > 0 and u < 0.75:  # catch-up over-payment
                paid = round(rent + min(shortfall, rent * 0.25), 2)
        elif profile == "deteriorating":
            if gi >= break_at:
                missed = rng.random() < 0.3
                late = 60 if missed else int(rng.integers(30, 46))
            else:
                ramp = max(0.0, 1 - (break_at - gi) / 6)
                if ramp > 0:
                    late = int(round(ramp * 25 + rng.uniform(0, 3)))
                elif rng.random() < 0.1:
                    late = int(rng.integers(1, 4))
        elif profile == "seasonal":
            if mon in (12, 1, 2):
                if rng.random() < 0.9:
                    late = int(rng.integers(6, 17))
            elif rng.random() < 0.05:
                late = int(rng.integers(1, 4))
        elif profile == "shock":
            if gi == shock_at:
                missed = True
                late = 60
            elif gi > shock_at:
                late = int(rng.integers(10, 26))
            elif rng.random() < 0.08:
                late = int(rng.integers(1, 4))
        if winter and late > 0 and not missed:
            late += 2
        if missed:
            paid = 0.0
        due = date(int(m[:4]), mon, 1)
        if missed:
            paid_date = None
        elif late > 0:
            paid_date = due + timedelta(days=late)
        else:
            paid_date = due - timedelta(days=int(rng.integers(0, 3)))
        shortfall = max(0.0, shortfall + rent - paid)
        flag = late >= 30 or paid == 0 or shortfall >= rent
        rows.append(Row(m, due.isoformat(), rent, paid, paid_date.isoformat() if paid_date else None,
                        late, bool(flag)))
    return rows


def cmd_generate(stamp: str, seed: int) -> None:
    rng = np.random.default_rng(seed)
    roster = build_roster()
    months = month_list()
    profiles = [p for p, n in PROFILE_COUNTS.items() for _ in range(n)]
    assert len(profiles) == len(roster)
    order = rng.permutation(len(profiles))
    tenancies: list[dict[str, Any]] = []
    truth: dict[str, bool] = {}
    for i, t in enumerate(roster):
        profile = profiles[order[i]]
        rows = simulate(t, profile, months, rng)
        truth[t.id] = any(r.arrears30 for r in rows if r.month in LABEL_MONTHS)
        tenancies.append({
            "id": t.id, "company": t.company, "code": t.code, "profile": profile,
            "rentMonthly": monthly(t.weeklyRent), "marketMonthly": monthly(t.weeklyMarketRent),
            "start": t.start, "months": [asdict(r) for r in rows],
        })
    write_json(DATA / "roster.json", {"generatedAt": stamp, "tenancies": [asdict(t) for t in roster]})
    write_json(DATA / "history.json", {
        "seed": seed, "months": months, "cutoff": CUTOFF, "labelMonths": LABEL_MONTHS,
        "tenancies": tenancies, "truth": truth,
    })
    print(f"generate: 60 tenancies, {sum(truth.values())} positive in {LABEL_MONTHS[0]}..{LABEL_MONTHS[-1]}")


# ----------------------------------------------------------------------------- features
def features(t: dict[str, Any], cutoff: str) -> dict[str, float] | None:
    """Feature vector as of a cutoff month; None when the tenancy has no rows yet."""
    rows = [r for r in t["months"] if r["month"] <= cutoff]
    n = len(rows)
    if n == 0:
        return None
    last6, last12, last3 = rows[-6:], rows[-12:], rows[-3:]
    trend = 0.0
    if n >= 4:
        before = rows[-6:-3]
        trend = float(np.mean([r["daysLate"] for r in last3]) - np.mean([r["daysLate"] for r in before]))
    months_in = month_key(cutoff) - month_key(t["start"][:7]) + 1
    market = t["marketMonthly"]
    balance = max(0.0, sum(r["rentDue"] - r["paidAmount"] for r in rows))
    return {
        "late_share_6": sum(1 for r in last6 if r["daysLate"] > 0) / min(6, n),
        "avg_days_late_6": float(np.mean([r["daysLate"] for r in last6])),
        "late_trend": trend,
        "partial_count_6": float(sum(1 for r in last6 if 0 < r["paidAmount"] < r["rentDue"])),
        "missed_count_12": float(sum(1 for r in last12 if r["paidAmount"] == 0)),
        "max_days_late_12": float(max(r["daysLate"] for r in last12)),
        "prior_arrears": 1.0 if any(r["arrears30"] for r in rows) else 0.0,
        "tenancy_months": float(min(60, max(1, months_in))),
        "rent_ratio": t["rentMonthly"] / market if market else 1.0,
        "balance_ratio": balance / t["rentMonthly"],
    }


def label_after(t: dict[str, Any], cutoff: str) -> bool:
    key = month_key(cutoff)
    return any(r["arrears30"] for r in t["months"] if key < month_key(r["month"]) <= key + 3)


def dataset(tenancies: Sequence[dict[str, Any]], cutoff: str, min_rows: int,
            labels: dict[str, bool] | None = None) -> tuple[list[str], np.ndarray, np.ndarray]:
    ids: list[str] = []
    X: list[list[float]] = []
    y: list[bool] = []
    for t in tenancies:
        f = features(t, cutoff)
        if f is None or sum(1 for r in t["months"] if r["month"] <= cutoff) < min_rows:
            continue
        ids.append(t["id"])
        X.append([f[k] for k in FEATURES])
        y.append(labels[t["id"]] if labels is not None else label_after(t, cutoff))
    return ids, np.array(X, dtype=float), np.array(y, dtype=int)


# ----------------------------------------------------------------------------- metrics
def probs_from_model(model: dict[str, Any], X: np.ndarray) -> np.ndarray:
    z = (X - np.array(model["mean"])) / np.array(model["scale"])
    logit = z @ np.array(model["coef"]) + model["intercept"]
    return 1.0 / (1.0 + np.exp(-logit))


def top_k(y: np.ndarray, score: np.ndarray, k: int) -> dict[str, float]:
    pick = np.argsort(-score, kind="stable")[:k]  # ties keep roster order
    hits = int(y[pick].sum())
    return {f"precisionAt{k}": hits / k, f"recallAt{k}": hits / int(y.sum())}


def evaluate(y: np.ndarray, score: np.ndarray) -> dict[str, float]:
    out = {"auc": float(roc_auc_score(y, score)), "brier": float(brier_score_loss(y, score))}
    out.update(top_k(y, score, 10))
    out.update(top_k(y, score, 15))
    return out


def calibration(y: np.ndarray, p: np.ndarray) -> list[dict[str, float | int | str]]:
    edges = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0001]
    bins: list[dict[str, float | int | str]] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi)
        n = int(mask.sum())
        bins.append({"bin": f"{lo:.1f}-{min(hi, 1.0):.1f}", "count": n,
                     "meanPredicted": float(p[mask].mean()) if n else 0.0,
                     "observedRate": float(y[mask].mean()) if n else 0.0})
    return bins


def rule_score(X: np.ndarray, tenancies: Sequence[dict[str, Any]], ids: list[str], cutoff: str) -> np.ndarray:
    """Baseline: late in 2 of the last 3 months, or any prior arrears."""
    by_id = {t["id"]: t for t in tenancies}
    out = np.zeros(len(ids))
    for i, tid in enumerate(ids):
        rows = [r for r in by_id[tid]["months"] if r["month"] <= cutoff][-3:]
        late = sum(1 for r in rows if r["daysLate"] > 0)
        out[i] = 1.0 if late >= 2 or X[i, FEATURES.index("prior_arrears")] == 1 else 0.0
    return out


def band_counts(p: np.ndarray) -> dict[str, int]:
    return {"high": int((p >= BANDS["high"]).sum()),
            "medium": int(((p >= BANDS["medium"]) & (p < BANDS["high"])).sum()),
            "low": int((p < BANDS["medium"]).sum())}


# ----------------------------------------------------------------------------- train
def cmd_train(stamp: str) -> None:
    hist = read_json(DATA / "history.json")
    tenancies: list[dict[str, Any]] = hist["tenancies"]
    months: list[str] = hist["months"]
    parts = [dataset(tenancies, c, 3) for c in TRAIN_CUTOFFS]
    X_tr = np.vstack([p[1] for p in parts])
    y_tr = np.concatenate([p[2] for p in parts])
    ids, X_bt, y_bt = dataset(tenancies, CUTOFF, 1, hist["truth"])

    scaler = StandardScaler().fit(X_tr)
    lr = LogisticRegression(C=1.0, class_weight="balanced", solver="lbfgs", max_iter=1000)
    lr.fit(scaler.transform(X_tr), y_tr)
    gb = GradientBoostingClassifier(n_estimators=100, max_depth=2, random_state=0).fit(X_tr, y_tr)

    model: dict[str, Any] = {
        "version": "arrears-lr-v1", "trainedAt": stamp, "features": FEATURES,
        "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]), "bands": BANDS,
        "training": {"cutoffs": TRAIN_CUTOFFS, "rows": int(len(y_tr)), "positives": int(y_tr.sum())},
    }
    p_lr = probs_from_model(model, X_bt)
    drift = float(np.abs(p_lr - lr.predict_proba(scaler.transform(X_bt))[:, 1]).max())
    assert drift < 1e-9, f"numpy/sklearn probability mismatch {drift}"
    p_gb = gb.predict_proba(X_bt)[:, 1]
    p_rule = rule_score(X_bt, tenancies, ids, CUTOFF)
    lr_eval = evaluate(y_bt, p_lr)
    model["backtest"] = {"cutoff": CUTOFF, "rows": int(len(y_bt)), "positives": int(y_bt.sum()), **lr_eval}

    _, X_demo, _ = dataset(tenancies, months[-1], 1, hist["truth"])
    p_demo = probs_from_model(model, X_demo)
    profiles: dict[str, int] = {}
    for t in tenancies:
        profiles[t["profile"]] = profiles.get(t["profile"], 0) + 1
    metrics = {
        "trainedAt": stamp,
        "training": model["training"],
        "backtest": {"cutoff": CUTOFF, "rows": int(len(y_bt)), "positives": int(y_bt.sum())},
        "models": {
            "logistic_regression": lr_eval,
            "gradient_boosting": evaluate(y_bt, p_gb),
            "rule": {**evaluate(y_bt, p_rule), "flagged": int(p_rule.sum()),
                     "precisionFlagged": float(y_bt[p_rule == 1].mean()),
                     "recallFlagged": float(y_bt[p_rule == 1].sum() / y_bt.sum())},
            "random": {"auc": 0.5, "note": "expected value of a random ranking, not simulated"},
        },
        "calibration": {"logistic_regression": calibration(y_bt, p_lr),
                        "gradient_boosting": calibration(y_bt, p_gb)},
        "bands": {"thresholds": BANDS, "backtest": band_counts(p_lr), "demo": band_counts(p_demo)},
        "profiles": profiles,
        "numpyVsSklearnMaxAbsDiff": drift,
    }
    write_json(DATA / "model.json", model)
    write_json(DATA / "metrics.json", metrics)
    write_report(metrics, model)
    print(f"train: {len(y_tr)} rows ({int(y_tr.sum())} positive); backtest AUC {lr_eval['auc']:.3f}; "
          f"numpy vs sklearn max diff {drift:.1e}")


def cmd_score() -> None:
    hist = read_json(DATA / "history.json")
    model = read_json(DATA / "model.json")
    out: dict[str, Any] = {}
    for key, cutoff in (("backtest", CUTOFF), ("demo", hist["months"][-1])):
        ids, X, _ = dataset(hist["tenancies"], cutoff, 1, hist["truth"])
        p = probs_from_model(model, X)
        out[key] = {"asOf": cutoff, "scores": {
            tid: {"probability": float(p[i]), "features": dict(zip(FEATURES, X[i].tolist()))}
            for i, tid in enumerate(ids)}}
    write_json(DATA / "scores.json", out)
    print(f"score: {len(out['demo']['scores'])} tenancies scored at {out['demo']['asOf']}")


# ----------------------------------------------------------------------------- report
def write_report(metrics: dict[str, Any], model: dict[str, Any]) -> None:
    m = metrics["models"]
    tr, bt, bands = metrics["training"], metrics["backtest"], metrics["bands"]

    def row(name: str, r: dict[str, Any]) -> str:
        return (f"| {name} | {r['auc']:.3f} | {r['precisionAt10']:.2f} | {r['recallAt10']:.2f} | "
                f"{r['precisionAt15']:.2f} | {r['recallAt15']:.2f} | {r['brier']:.3f} |")

    lines = [
        "# Arrears risk: backtest results", "",
        "## Data", "",
        "Synthetic rent-payment history for 60 tenancies (30 at Acme Property Group, Auckland; 30 at "
        "Kestrel Lettings, Manchester and Leeds), one row per tenancy per month from 2024-10 to 2026-09. "
        "Each tenancy is generated from a hidden payment profile (recorded in `data/risk/history.json`) "
        "with a fixed seed. A month counts as arrears when the payment lands 30+ days late, is missed, or "
        "the running shortfall reaches one month's rent.", "",
        "Profile counts: " + ", ".join(f"{k} {v}" for k, v in sorted(metrics["profiles"].items())) + ".", "",
        "## Method", "",
        f"Ten features are computed as of a cutoff month (defined in `server/ml/README.md`). Training rows "
        f"come from cutoffs {', '.join(tr['cutoffs'])} with the label \"any arrears in the next three "
        f"months\": {tr['rows']} rows, {tr['positives']} positive. The backtest cutoff is {bt['cutoff']} and "
        f"the label is any arrears in 2026-07 to 2026-09, which the model never sees: {bt['rows']} "
        f"tenancies, {bt['positives']} positive.", "",
        "The shipped model is logistic regression on standardised features (balanced class weights, C=1.0). "
        "Gradient boosting (100 trees, depth 2) is a comparison; the rule flags a tenancy when it paid late "
        "in two of the last three months or has any prior arrears; a random ranking has an expected AUC of 0.5.", "",
        "## Backtest (cutoff 2026-06, labels 2026-07 to 2026-09)", "",
        "| Model | AUC | P@10 | R@10 | P@15 | R@15 | Brier |", "|---|---|---|---|---|---|---|",
        row("Logistic regression (shipped)", m["logistic_regression"]),
        row("Gradient boosting", m["gradient_boosting"]),
        row("Rule: late 2 of last 3 or prior arrears", m["rule"]),
        "| Random | 0.500 | - | - | - | - | - |", "",
        f"The rule flags {m['rule']['flagged']} tenancies with precision {m['rule']['precisionFlagged']:.2f} "
        f"and recall {m['rule']['recallFlagged']:.2f}. Top-k lists break score ties in roster order, so the "
        "rule's top-k figures depend on that order. The Brier score for the rule treats its 1/0 flag as a "
        "probability.", "",
        "## Calibration (logistic regression)", "",
        "| Predicted probability | Count | Mean predicted | Observed rate |", "|---|---|---|---|",
    ]
    for b in metrics["calibration"]["logistic_regression"]:
        lines.append(f"| {b['bin']} | {b['count']} | {b['meanPredicted']:.2f} | {b['observedRate']:.2f} |")
    lines += [
        "", "With 60 backtest rows the bins hold a handful of tenancies each, so the observed rates carry "
        "wide uncertainty (one tenancy moves a bin of five by 20 points). The table shows whether the "
        "probabilities sit in the right region, not that they are calibrated to the second decimal; the "
        "bands below are the intended way to read the scores.", "",
        "## Risk bands", "",
        f"High >= {BANDS['high']}, medium >= {BANDS['medium']}, low below, applied to the logistic-regression "
        "probability.", "",
        "| Scoring point | High | Medium | Low |", "|---|---|---|---|",
        f"| Backtest ({bt['cutoff']}) | {bands['backtest']['high']} | {bands['backtest']['medium']} | "
        f"{bands['backtest']['low']} |",
        f"| Demo (2026-09) | {bands['demo']['high']} | {bands['demo']['medium']} | {bands['demo']['low']} |", "",
        "## Model weights", "",
        "| Feature | Coefficient (standardised) |", "|---|---|",
    ]
    for name, c in zip(model["features"], model["coef"]):
        lines.append(f"| {name} | {c:+.3f} |")
    lines += ["", f"Intercept {model['intercept']:+.3f}. Weights, means and scales are in "
              "`data/risk/model.json`; the Node server reproduces the probabilities from them."]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["generate", "train", "score", "all"])
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--stamp", default=STAMP, help="date written as generatedAt/trainedAt")
    args = ap.parse_args()
    if args.command in ("generate", "all"):
        cmd_generate(args.stamp, args.seed)
    if args.command in ("train", "all"):
        cmd_train(args.stamp)
    if args.command in ("score", "all"):
        cmd_score()


if __name__ == "__main__":
    main()
