#!/usr/bin/env python3
"""Deterministic renderer for the monthly household financial report.

Turns one month's snapshot.json into a self-contained HTML page, and
regenerates the reports index. Computes nothing: it draws what the snapshot
says, and states a gap where the snapshot says nothing.

    render.py validate --snapshot <path>
    render.py render   --snapshot <path> --reports-dir <dir>

The schema is ../references/snapshot-schema.md and the rules behind each figure
are ../references/derivations.md. Standard library only; the output contains no
script tag, no stylesheet link and no external URL of any kind, because a report
written in 2027 must still open in 2035 with no network.

Test it without any real data:

    tmp=$(mktemp -d)
    mkdir -p "$tmp/2026-07" "$tmp/2026-08"
    cp fixtures/snapshot-example-prior.json "$tmp/2026-07/snapshot.json"
    cp fixtures/snapshot-example.json       "$tmp/2026-08/snapshot.json"
    render.py render --snapshot "$tmp/2026-08/snapshot.json" --reports-dir "$tmp"
    render.py render --snapshot "$tmp/2026-08/snapshot.json" --reports-dir "$tmp"
    # the second run must produce byte-identical output
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

LABELS = ("fact", "projection", "advice")
MAX_ACTIONS = 3
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
REQUIRED = (
    "month", "generated_at", "as_of", "summary", "net_worth", "flow",
    "goals", "liquidity", "allocation", "tax", "findings", "actions",
    "data_notes",
)

# ink, accent and rule colours are duplicated between page and charts on purpose
INK = "#111418"
MUTED = "#5b6570"
RULE = "#dcdfe4"
ACCENT = "#1f6feb"
GOOD = "#1f883d"
WARN = "#9a6700"


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------

def validate(snap):
    """Return a list of human-readable problems. Empty means renderable."""
    errs = []

    def fail(path, msg):
        errs.append(f"{path}: {msg}")

    if not isinstance(snap, dict):
        return ["snapshot: not a JSON object"]

    for key in REQUIRED:
        if key not in snap:
            fail(key, "missing (required)")

    month = snap.get("month")
    if not isinstance(month, str) or not MONTH_RE.match(month):
        fail("month", "expected YYYY-MM")

    labeled = (
        ("highlights", "text"),
        ("findings", "statement"),
        ("tax.observations", "text"),
    )
    for group, field in labeled:
        node = snap
        for part in group.split("."):
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                break
        if node is None:
            continue
        if not isinstance(node, list):
            fail(group, "expected a list")
            continue
        for i, item in enumerate(node):
            if not isinstance(item, dict):
                fail(f"{group}[{i}]", "expected an object")
                continue
            if item.get("label") not in LABELS:
                fail(f"{group}[{i}].label",
                     f"must be one of {', '.join(LABELS)} (got {item.get('label')!r})")
            if field not in item or not str(item.get(field, "")).strip():
                fail(f"{group}[{i}].{field}", "missing statement text")

    narrative = snap.get("narrative") or {}
    statements = narrative.get("statements")
    if statements is not None:
        if not isinstance(statements, list):
            fail("narrative.statements", "expected a list")
        else:
            for i, item in enumerate(statements):
                if item.get("label") not in LABELS:
                    fail(f"narrative.statements[{i}].label",
                         f"must be one of {', '.join(LABELS)} (got {item.get('label')!r})")
                if not str(item.get("text", "")).strip():
                    fail(f"narrative.statements[{i}].text", "missing statement text")

    for i, bucket in enumerate((snap.get("net_worth") or {}).get("buckets") or []):
        if bucket.get("basis") not in ("measured", "reconstructed", "manual", "market"):
            fail(f"net_worth.buckets[{i}].basis",
                 "must be measured, reconstructed or manual")

    for i, acct in enumerate((snap.get("flow") or {}).get("off_budget_accounts") or []):
        if acct.get("basis") not in ("measured", "manual"):
            fail(f"flow.off_budget_accounts[{i}].basis", "must be measured or manual")

    action_count = len(snap.get("actions") or [])
    if action_count > MAX_ACTIONS:
        fail("actions", f"{action_count} items; the cap is {MAX_ACTIONS}")

    return errs


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def esc(value):
    return html.escape(str(value), quote=True)


def money(value, currency="$"):
    if value is None:
        return "—"
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "—"
    sign = "-" if amount < 0 else ""
    return f"{sign}{currency}{abs(amount):,.0f}"


def short(value, currency="$"):
    amount = float(value or 0)
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    if amount >= 1_000_000:
        return f"{sign}{currency}{amount / 1_000_000:.1f}M"
    if amount >= 1_000:
        return f"{sign}{currency}{amount / 1000:.0f}k"
    return f"{sign}{currency}{amount:.0f}"


def month_label(month):
    year, mon = month.split("-")
    return f"{MONTH_NAMES[int(mon) - 1]} {year}"


def month_range(first, last):
    fy, fm = int(first[:4]), int(first[5:])
    ly, lm = int(last[:4]), int(last[5:])
    out = []
    while (fy, fm) <= (ly, lm):
        out.append(f"{fy:04d}-{fm:02d}")
        fm += 1
        if fm == 13:
            fy, fm = fy + 1, 1
    return out


def badge(label):
    return f'<span class="badge badge-{esc(label)}">{esc(label)}</span>'


def basis_mark(basis):
    if basis == "measured":
        return ""
    return f'<span class="basis">{esc(basis)}</span>'


def stale_mark(acct):
    since = acct.get("not_updated_since")
    if not since:
        return ""
    return f'<span class="stale">not updated since {esc(since)}</span>'


def gap(text):
    return f'<p class="gap">{esc(text)}</p>'


# --------------------------------------------------------------------------
# charts — hand-built inline SVG, no library, no namespace declaration
# --------------------------------------------------------------------------

def _svg(width, height, body):
    # xmlns is what makes the same markup render as a standalone file as well as
    # inline; without it a rasteriser drops the text and every label vanishes.
    #
    # height is "auto", not a pixel count, because a fixed height caps the scale
    # factor: with width="100%" the browser scales by min(box_width / width, 1), so a
    # 420-unit drawing sat at 420px inside a 736px column and the reader's complaint
    # was exact - "too small horizontally". With the height left to the viewBox aspect
    # the drawing fills whatever width it is given, on a phone and on a desktop alike.
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
            f'width="100%" height="auto" role="img" preserveAspectRatio="xMidYMid meet">'
            f'{body}</svg>')


def _wrap(text, width):
    """Greedy wrap, because a 44-character expense name is wider than the canvas.

    A word longer than the column is hard-broken rather than allowed to overhang:
    with no fonts available to measure against, the width budget is characters, and
    one long word was enough to push a label past the canvas edge.
    """
    words, line, out = [], "", []
    for word in str(text).split():
        while len(word) > width:
            words.append(word[:width])
            word = word[width:]
        words.append(word)
    for word in words:
        candidate = (line + " " + word).strip()
        if len(candidate) <= width or not line:
            line = candidate
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out[:3]


def _esc_lines(lines, x, y, anchor, size, fill, line_height=None):
    """Multi-line text. The full string rides along in a title for hover and for
    assistive tech, since the visible label may be wrapped or trimmed."""
    line_height = line_height or size + 2
    tspans = "".join(
        f'<tspan x="{x}" dy="{0 if n == 0 else line_height}">{esc(t)}</tspan>'
        for n, t in enumerate(lines)
    )
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" '
            f'fill="{fill}"><title>{esc(" ".join(lines))}</title>{tspans}</text>')


def sankey(flow, currency="$"):
    """Income -> the household -> destinations, as a three-column sankey.

    A two-column flow: income on the left, its destinations on the right, every link
    drawn straight between them. Every node is a rectangle and every link is a filled
    straight ribbon whose thickness is that link's share, so magnitude is readable
    without the labels - except for the smallest flows, which are held at a 9-unit
    floor so a $68 flow stays visible next to a $3,114 one. Measured after the
    2026-09-15 redraw: every ribbon above that floor carries the same ratio of
    thickness to value to within 0.6%.

    Two earlier versions were wrong in ways a reader caught before I did. The first
    drew bands only, all converging on one mid-line point: one large income node
    became a ~340px smear across the canvas. The second drew rectangles for the nodes
    but kept a cubic Bezier *stroke* for every link - so the flows were curved, the
    right-hand run from the hub to the destinations was only 30 units long against a
    stack several hundred units tall, and at 30% opacity the whole chart was a set of
    near-vertical smears. Cameri's verdict on it was "too small horizontally and the
    curved paths look weird", which was correct on both counts and had one root cause
    each: a fixed pixel height that capped the scale on a wide screen, and a hub that
    sat two-thirds of the way across the span instead of centred in it.

    Canvas width stays modest (420) because the report is read on a phone, where the
    scale factor is the phone width over the canvas width: a 720-unit canvas would
    render 11px text at about five physical pixels. Width is bought by compressing the
    vertical stack instead, which also lengthens the horizontal run of every ribbon.
    """
    income = flow.get("income") or []
    expense = flow.get("expense") or []
    savings = flow.get("savings") or {}
    paydown = flow.get("debt_paydown") or {}
    offbudget = flow.get("off_budget_expense") or []

    left = [(i.get("name", "income"), float(i.get("amount") or 0)) for i in income]
    right = [(i.get("name", "expense"), float(i.get("amount") or 0)) for i in expense]
    for name, value in (
        ("Debt paydown", float(paydown.get("mortgage_principal") or 0) + float(paydown.get("other") or 0)),
        ("Savings — cash", float(savings.get("cash") or 0)),
        ("Savings — assets", float(savings.get("cost_basis_assets") or 0)),
        ("Savings — liabilities", float(savings.get("liabilities") or 0)),
    ):
        if value:
            right.append((name, value))
    for item in offbudget:
        value = float(item.get("amount") or 0)
        if value:
            right.append((f"{item.get('name', 'off-budget')} (paid off-budget)", value))

    internal = float(flow.get("internal_transfers") or 0)
    in_total = sum(v for _, v in left)
    out_total = sum(v for _, v in right)
    if not left and not right:
        return gap("No flow data in this month's snapshot.") if not internal else ""

    # Geometry: two columns, links that tile their endpoints exactly.
    #
    # The invariant a sankey has to satisfy is that every link starts on the node it
    # leaves and ends on the node it reaches, at the same thickness at both ends. The
    # previous version handed the left-hand ends out across the span of BOTH columns,
    # so as soon as the destination column grew taller than the two income bars, six
    # of fourteen ribbons began in blank space below them - "some outflows don't even
    # connect to the inflows", and correctly so: the picture was creating money.
    #
    # The fix is to lay the columns out so the equality is structural rather than
    # hoped for. The right column's bars are sized from their values (with a floor, so
    # a $68 destination stays visible); the left column is then given exactly that
    # total, shared out by income value and with no gaps, so the run the links leave
    # from is precisely the run the bars cover. Both ends of every link then have the
    # same thickness by construction, and the checks below refuse to draw the diagram
    # if that ever stops being true.
    width = 420
    pad_top, pad_bottom = 28, 14
    footer = 36 if internal else 0
    # The pitch has to clear a two-line label: names wrap at label_w characters, and
    # at the old 9+5 pitch the second line of one node landed on the first line of the
    # next - "Deals" printed over "Fitness", most of a column unreadable.
    min_h, gap_px = 12.0, 11.0
    stack_top = pad_top + 18  # 18 for the totals line

    x_lab_l, x_node_l, x_node_l2 = 104, 108, 120
    x_node_r, x_node_r2, x_lab_r = 288, 300, 306
    label_w = 14

    def sized(nodes, scale):
        """Bars sized from their values: max(min_h, value * scale)."""
        return [
            {"name": name, "value": value, "h": max(min_h if value else 2.0, value * scale)}
            for name, value in nodes
        ]

    def placed(nodes, gaps):
        """Stack them from stack_top, with or without gaps between."""
        out, y = [], stack_top
        for node in nodes:
            out.append({**node, "y": y})
            y += node["h"] + (gap_px if gaps else 0.0)
        return out

    # One pass: the destination column sets the height, because its floors make it the
    # one that cannot be derived analytically from a target - so it is measured, and
    # the income column is then given the same total.
    target = max(len(left), len(right)) * (min_h + gap_px)
    rset = placed(sized(right, target / out_total if out_total else 0.0), gaps=True)
    span_h = sum(n["h"] for n in rset)
    lset = placed(
        [{"name": name, "value": value, "h": (value / in_total) * span_h if in_total else 0.0}
         for name, value in left],
        gaps=False,
    )
    height = int(stack_top + span_h + gap_px * max(0, len(rset) - 1) + pad_bottom + footer)

    def band(x0, y0, x1, y1, h, colour):
        """A straight ribbon from one node to another, h units thick.

        A filled quad, not a stroked curve: stroking a Bezier makes the ribbon's edges
        run perpendicular to the curve, so a link that drops a long way loses its
        apparent thickness and two links crossing the same region merge into a smear.
        Filled quads keep the thickness honest at both ends.
        """
        t = max(0.6, h) / 2
        return (
            f'<path d="M {x0:.1f} {y0 - t:.1f} L {x1:.1f} {y1 - t:.1f} '
            f'L {x1:.1f} {y1 + t:.1f} L {x0:.1f} {y0 + t:.1f} Z" '
            f'fill="{colour}" fill-opacity="0.45"/>'
        )

    # Income flows straight to its destinations; there is no middle node. Each link
    # takes the next run of the left column, sized to exactly the destination it feeds,
    # so the two ends match and nothing is left over at the bottom.
    links, led = [], stack_top
    for node in rset:
        h = node["h"]
        links.append({"y0": led + h / 2, "y1": node["y"] + h / 2, "h": h})
        led += h

    # The diagram is only worth drawing if it is true. These are the two ways a
    # previous version broke the reader's trust, so they are checked here rather than
    # trusted: every link inside the source column, every link on the bar it feeds.
    # Measured against the bars that will actually be drawn (their own last y + h), not
    # against span_h. Comparing with span_h only re-states the construction: a mutation
    # that shortens the source bars passed that version silently, because span_h comes
    # from the destination column and never moved. The question worth asking is whether
    # every ribbon stays inside the bars the reader can see.
    left_top = stack_top
    left_bottom = max([n["y"] + n["h"] for n in lset] or [stack_top])
    for link in links:
        if not (left_top - 1e-6 <= link["y0"] - link["h"] / 2 and link["y0"] + link["h"] / 2 <= left_bottom + 1e-6):
            raise ValueError(
                f"sankey: link from y={link['y0']:.1f} (h={link['h']:.1f}) falls outside the "
                f"source column {left_top:.1f}..{left_bottom:.1f}; the diagram would draw money "
                "from nowhere"
            )
    for link, node in zip(links, rset):
        if abs(link["y1"] - (node["y"] + node["h"] / 2)) > 1e-6 or abs(link["h"] - node["h"]) > 1e-6:
            raise ValueError(f"sankey: link does not match destination {node['name']!r}")
    if abs((led - left_bottom)) > 1e-6:
        raise ValueError(
            f"sankey: links cover {led - stack_top:.1f} of the source column's {span_h:.1f} units"
        )
    source_total = sum(n["h"] for n in lset)
    if abs(source_total - span_h) > 1e-6:
        raise ValueError(
            f"sankey: source bars cover {source_total:.1f} units against {span_h:.1f} for the links "
            "they must feed"
        )

    body = [
        f'<text x="{x_node_l}" y="{pad_top}" font-size="11" fill="{MUTED}">'
        f'in {esc(short(in_total, currency))} · out {esc(short(out_total, currency))}</text>'
    ]

    for link in links:
        body.append(band(x_node_l2, link["y0"], x_node_r, link["y1"], link["h"], GOOD))

    for node in lset:
        body.append(f'<rect x="{x_node_l}" y="{node["y"]:.1f}" width="12" height="{max(2.0, node["h"]):.1f}" rx="2" fill="{ACCENT}"/>')
        cy = node["y"] + node["h"] / 2
        lines = _wrap(node["name"], label_w)
        body.append(_esc_lines(lines, x_lab_l, cy - (len(lines) - 1) * 5.5 + 3, "end", 11, INK))
        body.append(f'<text x="{x_node_l2 + 4}" y="{cy + 3}" font-size="10" fill="{MUTED}">'
                    f'{esc(short(node["value"], currency))}</text>')

    for node in rset:
        body.append(f'<rect x="{x_node_r}" y="{node["y"]:.1f}" width="12" height="{max(2.0, node["h"]):.1f}" rx="2" fill="{GOOD}"/>')
        cy = node["y"] + node["h"] / 2
        lines = _wrap(node["name"], 14)
        body.append(_esc_lines(lines, x_lab_r, cy - (len(lines) - 1) * 6 + 3, "start", 11, INK, 12))
        body.append(f'<text x="{x_node_r - 4}" y="{cy + 3}" text-anchor="end" font-size="10" fill="{MUTED}">'
                    f'{esc(short(node["value"], currency))}</text>')

    if internal:
        band_y = height - pad_bottom - 30
        body.append(
            f'<rect x="{x_node_l}" y="{band_y}" width="{x_node_r2 - x_node_l}" height="16" rx="3" '
            f'fill="none" stroke="{RULE}" stroke-dasharray="4 3"/>'
        )
        body.append(
            f'<text x="{x_node_l}" y="{band_y + 28}" font-size="10" fill="{MUTED}">'
            f'internal transfers {esc(short(internal, currency))} — own-account movement, not spending</text>'
        )

    return _svg(width, height, "".join(body))


def net_worth_line(series, currency="$"):
    """series: [(month, total, basis)] oldest first; a missing month is a gap."""
    if not series:
        return gap("No net-worth points yet — this is the first month with a snapshot.")

    width, height = 720, 240
    left, right, top, bottom = 56, 12, 18, 34
    values = [v for _, v, _ in series]
    lo, hi = min(values), max(values)
    if hi == lo:
        hi = lo + 1
    span = hi - lo
    lo -= span * 0.1
    hi += span * 0.1
    n = len(series)
    step = (width - left - right) / max(n - 1, 1)

    def px(i):
        return left + i * step

    def py(v):
        return bottom + (height - top - bottom) * (1 - (v - lo) / (hi - lo))

    body = []
    for frac in (0.0, 0.5, 1.0):
        y = top + (height - top - bottom) * frac
        value = hi - (hi - lo) * frac
        body.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width - right}" y2="{y:.1f}" stroke="{RULE}"/>')
        body.append(f'<text x="{left - 8}" y="{y + 3:.1f}" text-anchor="end" font-size="10" fill="{MUTED}">'
                    f'{esc(short(value, currency))}</text>')

    segment = []
    for i, (_, value, _) in enumerate(series):
        segment.append(f'{px(i):.1f},{py(value):.1f}')
    if len(segment) > 1:
        body.append(f'<polyline points="{" ".join(segment)}" fill="none" stroke="{ACCENT}" stroke-width="2"/>')

    for i, (_, value, basis) in enumerate(series):
        if basis == "reconstructed":
            body.append(f'<circle cx="{px(i):.1f}" cy="{py(value):.1f}" r="3.5" fill="#fff" '
                        f'stroke="{ACCENT}" stroke-width="2"/>')
        else:
            body.append(f'<circle cx="{px(i):.1f}" cy="{py(value):.1f}" r="3.5" fill="{ACCENT}"/>')

    for i, (label, _, _) in enumerate(series):
        if n <= 8 or i in (0, n - 1):
            body.append(f'<text x="{px(i):.1f}" y="{height - 12}" text-anchor="middle" '
                        f'font-size="10" fill="{MUTED}">{esc(label[2:])}</text>')

    closest = min(series, key=lambda item: abs(item[1] - series[-1][1]))
    body.append(f'<text x="{px(series.index(closest)):.1f}" y="{py(closest[1]) - 10:.1f}" '
                f'text-anchor="middle" font-size="10" fill="{MUTED}">{esc(short(closest[1], currency))}</text>')

    return _svg(width, height, "".join(body))


def goal_bars(goals, currency="$"):
    if not goals:
        return gap("No goals in this month's snapshot.")
    rows = []
    for goal in goals:
        target = float(goal.get("target") or 0)
        current = float(goal.get("current") or 0)
        pct = 0.0 if target <= 0 else max(0.0, min(1.0, current / target))
        state = goal.get("on_track")
        note = goal.get("note") or ""
        target_date = goal.get("target_date") or ""
        rows.append(
            '<div class="goal">'
            f'<div class="goal-line"><strong>{esc(goal.get("name", "goal"))}</strong>'
            f'<span class="muted">{esc(money(current, currency))} of {esc(money(target, currency))}'
            + (f' · by {esc(target_date)}' if target_date else "")
            + (f' · {"on track" if state else "off track"}' if state is not None else "")
            + "</span></div>"
            f'<div class="track"><div class="fill" style="width:{pct * 100:.1f}%"></div></div>'
            + (f'<div class="muted small">{esc(note)}</div>' if note else "")
            + "</div>"
        )
    return "".join(rows)


def allocation_bar(allocation, currency="$"):
    if not allocation:
        return gap("No allocation data in this month's snapshot.")
    total = sum(float(a.get("value") or 0) for a in allocation) or 1.0
    palette = (ACCENT, GOOD, "#8250df", WARN, "#0969da", "#cf222e")
    bars, legend = [], []
    x = 0.0
    for i, part in enumerate(allocation):
        value = float(part.get("value") or 0)
        pct = value / total * 100
        colour = palette[i % len(palette)]
        bars.append(f'<rect x="{x:.2f}%" y="0" width="{pct:.2f}%" height="22" fill="{colour}"/>')
        x += pct
        legend.append(f'<span class="chip"><i style="background:{colour}"></i>'
                      f'{esc(part.get("name", "—"))} {pct:.0f}%</span>')
    return (_svg(100, 22, "".join(bars)).replace('viewBox="0 0 100 22"', 'viewBox="0 0 100 22"')
            + f'<div class="legend">{"".join(legend)}</div>')


# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------

def style():
    return """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 46rem; padding: 1.25rem 1rem 3rem;
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #111418; background: #fff; }
svg { width: 100%; height: auto; display: block; margin: .5rem 0; }
h1 { font-size: 1.35rem; margin: 0 0 .2rem; }
h2 { font-size: 1.05rem; margin: 1.8rem 0 .5rem; padding-bottom: .25rem;
  border-bottom: 1px solid #dcdfe4; }
h3 { font-size: .95rem; margin: 1rem 0 .35rem; }
p { margin: .45rem 0; }
.muted { color: #5b6570; }
.small { font-size: .85rem; }
.provenance { font-size: .8rem; color: #5b6570; margin-top: .2rem; }
.card { border: 1px solid #dcdfe4; border-radius: 8px; padding: .75rem .9rem; margin: .6rem 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .6rem; }
.metric { border: 1px solid #dcdfe4; border-radius: 8px; padding: .55rem .7rem; }
.metric .label { font-size: .78rem; color: #5b6570; text-transform: uppercase; letter-spacing: .03em; }
.metric .value { font-size: 1.15rem; font-variant-numeric: tabular-nums; margin-top: .15rem; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { text-align: left; padding: .4rem .3rem; border-bottom: 1px solid #dcdfe4; vertical-align: top; }
th { font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; color: #5b6570; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.badge { display: inline-block; font-size: .68rem; text-transform: uppercase; letter-spacing: .04em;
  border: 1px solid #dcdfe4; border-radius: 999px; padding: .05rem .4rem; margin-right: .35rem;
  vertical-align: .08em; color: #5b6570; }
.badge-advice { border-color: #1f6feb; color: #1f6feb; }
.badge-projection { border-color: #9a6700; color: #9a6700; }
.basis, .stale { font-size: .72rem; color: #5b6570; border: 1px dashed #dcdfe4;
  border-radius: 999px; padding: .05rem .4rem; margin-left: .3rem; white-space: nowrap; }
.stale { border-style: solid; color: #9a6700; border-color: #9a6700; }
.gap { border: 1px dashed #dcdfe4; border-radius: 8px; padding: .6rem .7rem; color: #5b6570;
  font-size: .9rem; margin: .6rem 0; }
.status { border-left: 4px solid #5b6570; }
.status-running { border-left-color: #1f6feb; }
.status-waiting { border-left-color: #9a6700; }
.status-failed { border-left-color: #cf222e; }
.status-done { border-left-color: #1f883d; }
.banner { border: 1px solid #9a6700; color: #9a6700; border-radius: 8px;
  padding: .5rem .7rem; margin: .6rem 0; font-size: .9rem; }
.goal { margin: .7rem 0; }
.goal-line { display: flex; justify-content: space-between; gap: .6rem; flex-wrap: wrap; }
.track { height: 8px; border-radius: 999px; background: #dcdfe4; margin: .3rem 0 .2rem; overflow: hidden; }
.fill { height: 100%; background: #1f6feb; }
.legend { display: flex; flex-wrap: wrap; gap: .5rem .9rem; margin-top: .5rem; font-size: .82rem; }
.chip { display: inline-flex; align-items: center; gap: .35rem; color: #5b6570; }
.chip i { width: .7rem; height: .7rem; border-radius: 2px; display: inline-block; }
footer { margin-top: 2.5rem; padding-top: .8rem; border-top: 1px solid #dcdfe4;
  font-size: .8rem; color: #5b6570; }
ul.notes { padding-left: 1.1rem; margin: .4rem 0; }
ul.notes li { margin: .3rem 0; font-size: .9rem; }
.actions li { margin: .45rem 0; }
@media (prefers-color-scheme: dark) {
  body { color: #e6e8ea; background: #0d1117; }
  /* The charts and the sankey carry their colours as SVG presentation attributes,
     which have LOWER priority than any author CSS rule - so these overrides win, and
     nothing in the SVG has to change. On 2026-09-15 Cameri photographed the report in
     dark mode and the category names were invisible: they were #111418 (1.0:1 against
     #0d1117) and the dim labels #5b6570 (3.1:1). Same intent, dark-theme values. */
  svg text { fill: #e6e8ea; }
  svg text[fill="#5b6570"] { fill: #9aa4ae; }
  svg rect[fill="#111418"] { fill: #e6e8ea; }
  svg line, svg rect[fill="none"] { stroke: #2a2f36; }
  svg circle[fill="#fff"] { fill: #0d1117; }
  h2, footer { border-color: #2a2f36; }
  .card, .metric, .gap, .metric .label, .badge, .basis, .track { border-color: #2a2f36; }
  .muted, .provenance, .metric .label, th { color: #9aa4ae; }
  th, td { border-color: #2a2f36; }
  h2 { border-color: #2a2f36; }
}
"""


def statement_list(items, field):
    out = []
    for item in items:
        out.append(f'<li>{badge(item.get("label", ""))}<span>{esc(item.get(field, ""))}</span>'
                   + (f' <span class="muted small">{esc(item.get("reasoning", ""))}</span>'
                      if item.get("reasoning") else "")
                   + "</li>")
    return f'<ul class="notes">{"".join(out)}</ul>' if out else ""


def page(snap, series, currency="$"):
    month = snap.get("month", "")
    generated = str(snap.get("generated_at", ""))
    as_of = snap.get("as_of") or {}
    provenance = ", ".join(f"{esc(k)} {esc(v)}" for k, v in as_of.items()) or "no sources recorded"

    nw = snap.get("net_worth") or {}
    buckets = nw.get("buckets") or []
    prior = snap.get("net_worth_prior_year")
    flow = snap.get("flow") or {}
    liquidity = snap.get("liquidity") or {}
    tax = snap.get("tax") or {}

    parts = []
    parts.append(f'<h1>Household report — {esc(month_label(month))}</h1>')
    parts.append(f'<p class="provenance">generated {esc(generated)} · sources read: {provenance}</p>')
    if snap.get("summary"):
        parts.append(f'<div class="card"><p>{esc(snap["summary"])}</p></div>')

    notes_missing = [c for c in ([("flow.expense_basis", flow.get("expense_basis")),
                                  ("liquidity", liquidity), ("net_worth.buckets", buckets)]
                                 ) if not c[1]]
    if notes_missing:
        parts.append('<div class="banner">Data gaps this month — see Data notes at the end.</div>')

    parts.append('<h2>What changed this month</h2>')
    parts.append(statement_list(snap.get("highlights") or [], "text")
                 or gap("No highlights recorded for this month."))

    parts.append('<h2>Net worth</h2>')
    if buckets:
        total = nw.get("total")
        if total is None:
            total = sum(float(b.get("value") or 0) for b in buckets)
        cards = [f'<div class="metric"><div class="label">total</div>'
                 f'<div class="value">{esc(money(total, currency))}</div></div>']
        for bucket in buckets:
            cost = bucket.get("cost_basis")
            alongside = ""
            if cost is not None:
                gain = float(bucket.get("value") or 0) - float(cost or 0)
                sign = "+" if gain >= 0 else ""
                alongside = (f'<div class="muted small">cost {esc(money(cost, currency))} · '
                             f'gain {sign}{esc(money(gain, currency))}</div>')
            cards.append(f'<div class="metric"><div class="label">{esc(bucket.get("name", ""))}</div>'
                         f'<div class="value">{esc(money(bucket.get("value"), currency))}</div>'
                         f'{basis_mark(bucket.get("basis", "measured"))}{alongside}</div>')
        parts.append(f'<div class="grid">{"".join(cards)}</div>')
        parts.append(f'<h3>The series</h3>')
        parts.append(net_worth_line(series, currency))
        if prior:
            parts.append(f'<p class="muted small">Same month last year ({esc(month_label(str(prior.get("month", ""))))}): '
                         f'{esc(money(prior.get("total"), currency))} '
                         f'<span class="basis">{esc(prior.get("basis", ""))}</span></p>')
        else:
            parts.append(gap("Last year's figure is not reconstructable from the data, so no year-over-year comparison is shown."))
    else:
        parts.append(gap("No net-worth buckets in this month's snapshot."))

    parts.append('<h2>Fund flow</h2>')
    parts.append(sankey(flow, currency))
    if flow.get("expense_basis"):
        parts.append(f'<p class="muted small">Expense basis: {esc(flow["expense_basis"])} — '
                     f'mortgage principal is shown as debt paydown, not consumption.</p>')
    paydown = flow.get("debt_paydown") or {}
    if paydown.get("mortgage_principal"):
        parts.append(f'<p class="muted small">Debt paydown this month: '
                     f'{esc(money(paydown.get("mortgage_principal"), currency))} principal'
                     + (f' — {esc(paydown.get("note"))}' if paydown.get("note") else "") + "</p>")
    accts = flow.get("off_budget_accounts") or []
    if accts:
        rows = "".join(
            f'<tr><td>{esc(a.get("name", ""))}</td><td>{esc(a.get("kind", ""))}</td>'
            f'<td class="num">{esc(money(a.get("delta"), currency))}</td>'
            f'<td>{basis_mark(a.get("basis", "measured"))} {stale_mark(a)}</td></tr>'
            for a in accts)
        parts.append('<h3>Off-budget movement</h3><table><tr><th>account</th><th>kind</th>'
                     f'<th class="num">net change</th><th>note</th></tr>{rows}</table>')
    pairs = flow.get("transfer_pairs") or {}
    if pairs:
        parts.append(f'<p class="muted small">Flow derived from {esc(pairs.get("matched", 0))} matched transfer '
                     f'pairs (window {esc(pairs.get("window_days", 21))} days) and '
                     f'{esc(pairs.get("linked", 0))} linked rows — never from categories alone.</p>')

    parts.append('<h2>Goals</h2>')
    parts.append(goal_bars(snap.get("goals") or [], currency))

    parts.append('<h2>Runway and liquidity</h2>')
    if liquidity:
        cards = [
            ("liquid cash", money(liquidity.get("liquid_cash"), currency)),
            ("monthly consumption", money(liquidity.get("monthly_consumption"), currency)),
            ("runway", (f'{float(liquidity["runway_months"]):.1f} months'
                        if liquidity.get("runway_months") is not None else "—")),
        ]
        parts.append('<div class="grid">' + "".join(
            f'<div class="metric"><div class="label">{esc(k)}</div><div class="value">{esc(v)}</div></div>'
            for k, v in cards) + "</div>")
        if liquidity.get("note"):
            parts.append(f'<p class="muted small">{esc(liquidity["note"])}</p>')
    else:
        parts.append(gap("No liquidity figures in this month's snapshot."))

    parts.append('<h2>Allocation</h2>')
    parts.append(allocation_bar(snap.get("allocation") or [], currency))

    parts.append('<h2>Tax and the optimization scan</h2>')
    room = tax.get("room") or []
    if room:
        rows = "".join(
            f'<tr><td>{esc(r.get("name", ""))}</td>'
            f'<td class="num">{esc(money(r.get("used"), currency))}</td>'
            f'<td class="num">{esc(money(r.get("limit"), currency))}</td></tr>' for r in room)
        parts.append('<table><tr><th>room</th><th class="num">used</th>'
                     f'<th class="num">limit</th></tr>{rows}</table>')
    parts.append(statement_list(tax.get("observations") or [], "text") or "")

    parts.append('<h2>Findings</h2>')
    parts.append(statement_list(snap.get("findings") or [], "statement")
                 or gap("No findings recorded for this month."))

    narrative = (snap.get("narrative") or {}).get("statements") or []
    if narrative:
        parts.append('<h3>What to change</h3>')
        parts.append(statement_list(narrative, "text"))

    actions = (snap.get("actions") or [])[:MAX_ACTIONS]
    if actions:
        parts.append('<h2>Carried forward</h2><ul class="notes actions">' + "".join(
            f'<li><strong>{esc(a.get("action", ""))}</strong> — {esc(a.get("owner", "unassigned"))}'
            + (f', carried since {esc(a["carried_since"])}' if a.get("carried_since") else "")
            + "</li>" for a in actions) + "</ul>")

    parts.append('<h2>Data notes</h2>')
    notes = snap.get("data_notes") or []
    if notes:
        parts.append('<ul class="notes">' + "".join(
            f'<li>{esc(n.get("note", ""))}'
            + (f' <span class="muted small">— {esc(n.get("reason", ""))}</span>' if n.get("reason") else "")
            + (f' <span class="stale">{esc(n.get("since", ""))}</span>' if n.get("since") else "")
            + "</li>" for n in notes) + "</ul>")
    else:
        parts.append(gap("No data gaps recorded — which is a claim in itself; check the backfill queue."))
    parts.append('<p class="muted small">Labels: <span class="badge badge-fact">fact</span> came from '
                 'the data, <span class="badge badge-projection">projection</span> is a computed '
                 'forward view, <span class="badge badge-advice">advice</span> is a judgment.</p>')

    inputs = snap.get("inputs_used") or []
    if inputs:
        parts.append('<h3>Inputs used</h3><ul class="notes small">' + "".join(
            f'<li>{esc(i.get("source", ""))}'
            + (f' — {esc(i.get("detail", ""))}' if i.get("detail") else "")
            + (" <span class=\"basis\">manual</span>" if i.get("manual") else "")
            + "</li>" for i in inputs) + "</ul>")

    parts.append(f'<footer>Rendered from snapshot.json for {esc(month)} · '
                 f'{esc(generated)} · figures are rounded and carry their basis.</footer>')

    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>Household report — {esc(month_label(month))}</title>"
            f"<style>{style()}</style></head><body>{''.join(parts)}</body></html>")


def index_page(months, currency="$", status=None):
    """months: [(month, total|None, basis|None)] newest first."""
    banner = status_card(status)
    if not months:
        body = '<p>No reports yet.</p>'
    else:
        rows = []
        for month, total, basis in months:
            if total is None:
                rows.append(f'<tr><td>{esc(month_label(month))}</td>'
                            f'<td class="num muted">no report</td><td></td></tr>')
            else:
                rows.append(f'<tr><td><a href="{esc(month)}/index.html">{esc(month_label(month))}</a></td>'
                            f'<td class="num">{esc(money(total, currency))}</td>'
                            f'<td>{basis_mark(basis or "measured")}</td></tr>')
        body = ('<table><tr><th>month</th><th class="num">net worth</th><th>basis</th></tr>'
                + "".join(rows) + "</table>")
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<title>Household financial reports</title>"
            f"<style>{style()}</style></head><body>"
            "<h1>Household financial reports</h1>"
            f"{banner}"
            f"{body}"
            "<footer>Newest first. A month with no report shows as a gap rather than being omitted.</footer>"
            "</body></html>")


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def load(path):
    return json.loads(Path(path).read_text())


STATUS_STATES = ("running", "waiting", "failed", "done")


def load_status(reports_dir):
    """The run's own status file, or None. A broken file is reported, never hidden."""
    path = Path(reports_dir) / "status.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return {"state": "failed", "month": "", "since": "",
                "note": f"status file is unreadable ({exc.__class__.__name__})"}
    if not isinstance(data, dict) or data.get("state") not in STATUS_STATES:
        return {"state": "failed", "month": "", "since": "",
                "note": "status file does not name a known state"}
    return data


def status_card(status):
    if not status:
        return ""
    state = status.get("state", "")
    month = status.get("month") or ""
    headline = {
        "running": "report in progress",
        "waiting": "waiting on something before it can finish",
        "failed": "the run failed",
        "done": "latest report complete",
    }.get(state, state)
    title = f"{month_label(month)} — {headline}" if month else headline
    since = status.get("since") or ""
    note = status.get("note") or ""
    next_run = status.get("next_run") or ""
    lines = []
    if since:
        lines.append(f'<span class="muted small">since {esc(since)}</span>')
    if note:
        lines.append(f'<div class="small">{esc(note)}</div>')
    if next_run:
        lines.append(f'<div class="muted small">next run {esc(next_run)}</div>')
    if state == "failed":
        lines.append('<div class="muted small">A failed run leaves the previous month in place; '
                     'this page is the place it stays visible.</div>')
    if state in ("running", "waiting"):
        lines.append('<div class="muted small">Only the run itself updates this line, so if the '
                     'timestamp is more than a day old, the run did not finish.</div>')
    return (f'<div class="card status status-{esc(state)}"><strong>{esc(title)}</strong> '
            f'{" ".join(lines)}</div>')


def series_for(reports_dir):
    """[(month, total, basis)] oldest first, from every snapshot under the dir."""
    out = []
    for snap_path in sorted(Path(reports_dir).glob("*/snapshot.json")):
        try:
            snap = load(snap_path)
        except (OSError, json.JSONDecodeError):
            continue
        nw = snap.get("net_worth") or {}
        total = nw.get("total")
        if total is None:
            buckets = nw.get("buckets") or []
            total = sum(float(b.get("value") or 0) for b in buckets) if buckets else None
        basis = "measured"
        for bucket in (nw.get("buckets") or []):
            if bucket.get("basis") == "reconstructed":
                basis = "reconstructed"
        if total is not None:
            out.append((snap.get("month") or snap_path.parent.name, float(total), basis))
    out.sort(key=lambda item: item[0])
    return out


def cmd_validate(args):
    snap = load(args.snapshot)
    errs = validate(snap)
    if errs:
        for err in errs:
            print(err, file=sys.stderr)
        print(f"INVALID: {len(errs)} problem(s)", file=sys.stderr)
        return 1
    print(f"OK: {args.snapshot} ({snap.get('month')})")
    return 0


def cmd_render(args):
    snap = load(args.snapshot)
    errs = validate(snap)
    if errs:
        for err in errs:
            print(err, file=sys.stderr)
        return 1

    reports = Path(args.reports_dir)
    currency = snap.get("currency", "$")
    month = snap["month"]

    month_dir = reports / month
    month_dir.mkdir(parents=True, exist_ok=True)
    (month_dir / "index.html").write_text(page(snap, series_for(reports), currency))

    series = series_for(reports)
    known = [item[0] for item in series]
    if known:
        span = month_range(min(known), max(known))
    else:
        span = [month]
    totals = {m: (total, basis) for m, total, basis in series}
    rows = [(m, *totals.get(m, (None, None))) for m in reversed(span)]
    (reports / "index.html").write_text(index_page(rows, currency, load_status(reports)))

    print(f"rendered {month_dir / 'index.html'} and {reports / 'index.html'}")
    return 0


def cmd_index(args):
    """Regenerate only the index — for a status change with no new month."""
    reports = Path(args.reports_dir)
    series = series_for(reports)
    known = [item[0] for item in series]
    span = month_range(min(known), max(known)) if known else []
    totals = {m: (total, basis) for m, total, basis in series}
    rows = [(m, *totals.get(m, (None, None))) for m in reversed(span)]
    currency = "$"
    for snap_path in sorted(reports.glob("*/snapshot.json")):
        try:
            currency = load(snap_path).get("currency", currency)
            break
        except (OSError, json.JSONDecodeError):
            continue
    (reports / "index.html").write_text(index_page(rows, currency, load_status(reports)))
    print(f"regenerated {reports / 'index.html'}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    val = sub.add_parser("validate", help="check a snapshot without rendering it")
    val.add_argument("--snapshot", required=True)
    val.set_defaults(func=cmd_validate)

    ren = sub.add_parser("render", help="write the month's page and regenerate the index")
    ren.add_argument("--snapshot", required=True)
    ren.add_argument("--reports-dir", required=True)
    ren.set_defaults(func=cmd_render)

    idx = sub.add_parser("index", help="regenerate only the index (status change, no new month)")
    idx.add_argument("--reports-dir", required=True)
    idx.set_defaults(func=cmd_index)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
