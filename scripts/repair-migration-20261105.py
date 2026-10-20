#!/usr/bin/env python3
"""Finish a half-applied 20261105000000_bench_suites migration on a SQLite database.

Prisma runs SQLite migrations statement by statement without a transaction, so a failure leaves the earlier
statements applied: `migrate resolve --rolled-back` followed by `migrate deploy` would then fail on the columns
and tables that already exist. This script looks at what is there, applies only what is missing (in one
transaction, foreign keys off so redefining a table never cascades), checks foreign keys, and leaves the
`prisma migrate resolve --applied` step to you.

    pm2 stop <app>                                          # SQLite: nothing else may write meanwhile
    python3 scripts/repair-migration-20261105.py [data/sinobee.db] [--dry-run]
    npx prisma migrate resolve --applied 20261105000000_bench_suites
    npx prisma migrate status && pm2 start <app>

A backup copy (data/sinobee.db.bak-<time>) is written before anything changes.
"""
import os
import re
import sqlite3
import sys
import time

NAME = "20261105000000_bench_suites"
HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(HERE, "..", "prisma", "sqlite", "migrations", NAME, "migration.sql")


def tables(c):
    return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def cols(c, t):
    return {r[1] for r in c.execute(f'PRAGMA table_info("{t}")')}


def statements():
    text = "\n".join(l for l in open(SQL, encoding="utf-8").read().splitlines() if not l.strip().startswith("--"))
    return [s.strip() for s in text.split(";") if s.strip() and not s.strip().upper().startswith("PRAGMA")]


def plan(c):
    """The statements still needed, in the migration's order, with a note for each."""
    have, out, redefine = tables(c), [], {}
    for s in statements():
        m = re.match(r'(CREATE TABLE|INSERT INTO|DROP TABLE|ALTER TABLE) "new_(\w+)"|DROP TABLE "(\w+)"', s)
        target = m and (m.group(2) or m.group(3))
        if s.startswith('ALTER TABLE "SkillVersion" ADD COLUMN "securityReport"'):
            if "securityReport" not in cols(c, "SkillVersion"):
                out.append(("add SkillVersion.securityReport", s))
        elif s.startswith('CREATE TABLE "BenchSuite"'):
            if "BenchSuite" not in have:
                out.append(("create BenchSuite", s))
        elif target in ("Skill", "BenchEval"):
            redefine.setdefault(target, []).append(s)
            if s.startswith(f'ALTER TABLE "new_{target}" RENAME'):
                out += redefine_steps(c, have, target, redefine[target])
        elif s.startswith("CREATE UNIQUE INDEX") or s.startswith("CREATE INDEX"):
            out.append((None, re.sub(r"^CREATE (UNIQUE )?INDEX", r"CREATE \1INDEX IF NOT EXISTS", s)))
        else:
            raise SystemExit(f"unexpected statement in {NAME}, not touching the database:\n{s[:200]}")
    return out


def redefine_steps(c, have, t, stmts):
    marker = {"Skill": "kind", "BenchEval": "visibility"}[t]
    if t in have and marker in cols(c, t):
        return [(f"drop leftover new_{t}", f'DROP TABLE "new_{t}"')] if f"new_{t}" in have else []
    if t not in have and f"new_{t}" in have:  # stopped between DROP and RENAME
        return [(f"rename new_{t} to {t}", stmts[-1])]
    if t not in have:
        raise SystemExit(f'neither "{t}" nor "new_{t}" exists - restore the backup and ask for help')
    steps = [(f"drop leftover new_{t}", f'DROP TABLE "new_{t}"')] if f"new_{t}" in have else []
    return steps + [(f"redefine {t} (adds {marker})", s) for s in stmts]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    db = args[0] if args else os.environ.get("SQLITE_PATH") or os.path.join(HERE, "..", "data", "sinobee.db")
    dry = "--dry-run" in sys.argv
    if not os.path.exists(db):
        raise SystemExit(f"no database at {db}")
    c = sqlite3.connect(db, isolation_level=None, timeout=5)
    row = c.execute("SELECT finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE migration_name=?",
                    (NAME,)).fetchone()
    if not row:
        raise SystemExit(f"{NAME} was never started on this database - just run `npx prisma migrate deploy`")
    if row[0]:
        raise SystemExit(f"{NAME} is already recorded as applied - nothing to repair")
    print("== Prisma's log of the failed run:\n" + (row[2] or "(none)").strip()[:1500] + "\n")
    todo = plan(c)
    named = list(dict.fromkeys(n for n, _ in todo if n))
    print("== Still missing: " + (", ".join(named) if named else "nothing (only indexes are re-checked)"))
    if dry:
        return
    try:
        c.execute("BEGIN IMMEDIATE")
        c.execute("ROLLBACK")
    except sqlite3.OperationalError as e:
        raise SystemExit(f"the database is busy ({e}) - stop the app first (pm2 stop <app>)")
    backup = f"{db}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
    dst = sqlite3.connect(backup)
    c.backup(dst)
    dst.close()
    print(f"== Backup: {backup}")
    counts = {t: c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in ("Skill", "SkillVersion", "BenchEval")
              if t in tables(c)}
    c.execute("PRAGMA foreign_keys=OFF")
    c.execute("BEGIN")
    try:
        for _, s in todo:
            c.execute(s)
        bad = c.execute("PRAGMA foreign_key_check").fetchall()
        if bad:
            raise RuntimeError(f"foreign key check failed: {bad[:5]}")
        after = {t: c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in counts}
        if after != counts:
            raise RuntimeError(f"row counts changed {counts} -> {after}")
        c.execute("COMMIT")
    except Exception as e:
        c.execute("ROLLBACK")
        raise SystemExit(f"repair failed and was rolled back, the database is unchanged: {e}")
    finally:
        c.execute("PRAGMA foreign_keys=ON")
    ok = ("kind" in cols(c, "Skill") and "visibility" in cols(c, "BenchEval") and "BenchSuite" in tables(c)
          and "securityReport" in cols(c, "SkillVersion"))
    print(f"== Done ({counts}). Schema complete: {ok}")
    print(f"Next: npx prisma migrate resolve --applied {NAME} && npx prisma migrate status")


if __name__ == "__main__":
    main()
