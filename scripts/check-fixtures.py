#!/usr/bin/env python3
"""Checks the portable conformance fixtures of @lazy-ease/testing without JS.

    python3 scripts/check-fixtures.py [fixture-dir]

Parses every JSON file with Python's own reader, validates the envelope and
the manifest hashes, then recomputes every expected value with the
independent reference rules below, written from packages/testing/README.md
and not from the TypeScript sources. Backend 404 cases are checked against
the files the 200 cases name, which stand for the whole source root. Exits non-zero on the first mismatch
report. Needs Python 3.9 or later and nothing outside the standard library.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
import sys
import unicodedata
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import quote

FORMAT = "lazy-ease-fixtures"
FIXTURE_VERSION = 1
FILES = [
    "ladders",
    "numbers",
    "focal",
    "crops",
    "outputs",
    "candidates",
    "urls",
    "backend",
    "tokens",
]


# --- Numbers -----------------------------------------------------------------


def js_round(x: float) -> int:
    """Math.round: the nearest integer, ties toward +infinity, on the exact value."""
    return int((Decimal(x) + Decimal("0.5")).to_integral_value(rounding=ROUND_FLOOR))


def clamp(value, low, high):
    return min(high, max(low, value))


def plain(d: Decimal) -> str:
    """A decimal without exponent or trailing zeros; -0 is 0."""
    text = format(d, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def format_number(x: float) -> str:
    """Canonical URL number: round half away from zero to 3 decimals on the
    exact binary value, then the shortest decimal that reads back as the same
    double, without exponent or trailing zeros."""
    if not math.isfinite(x):
        raise ValueError("range")
    if abs(x) >= 1e21:
        return str(int(x))
    rounded = Decimal(x).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    # The 3-decimal result is a double again, printed in its shortest form.
    return plain(Decimal(repr(float(rounded))))


def round3(x: float) -> float:
    return float(format_number(x))


# --- Ladders -----------------------------------------------------------------

DEFAULT_WIDTHS = [64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840]
DEFAULT_QUALITIES = [75]
DEFAULT_FORMATS = ["avif", "webp", "jpeg"]


def default_ratios() -> list[float]:
    ratios = {round3(2 ** (k / 16)) for k in range(-32, 33)}
    for r in (4 / 3, 3 / 2, 16 / 9, 21 / 9):
        ratios.add(round3(r))
        ratios.add(round3(1 / r))
    return sorted(ratios)


DEFAULT_RATIOS = default_ratios()


def snap_width(width: float, ladder: list[float]) -> float:
    if not width > ladder[0]:
        return ladder[0]
    return next((w for w in ladder if w >= width), ladder[-1])


def snap_ratio(ratio: float, ladder: list[float]) -> float:
    if not ratio > 0:
        raise ValueError("range")
    for i, r in enumerate(ladder):
        if r >= ratio:
            if i == 0:
                return r
            lower = ladder[i - 1]
            return r if ratio * ratio >= lower * r else lower
    return ladder[-1]


def snap_quality(quality: float, allowed: list[float]) -> float:
    if not allowed:
        raise ValueError("range")
    return min(allowed, key=lambda q: (abs(q - quality), -q))


def source_cap(ladder, src_width):
    if src_width is None:
        return ladder[-1]
    fitting = [w for w in ladder if w <= src_width]
    return fitting[-1] if fitting else ladder[0]


def capped(ladder, cap):
    widths = [w for w in ladder if w <= cap]
    return widths or [ladder[0]]


def candidate_widths(mode, slot, ladder, src_width):
    if mode == "measured":
        return capped(ladder, min(snap_width(2 * slot, ladder), source_cap(ladder, src_width)))
    if mode == "fixed":
        cap = source_cap(ladder, src_width)
        widths = [min(snap_width(slot, ladder), cap), min(snap_width(2 * slot, ladder), cap)]
        return list(dict.fromkeys(widths))
    if mode == "full":
        return capped(ladder, source_cap(ladder, src_width))
    raise ValueError(mode)


# --- Geometry ----------------------------------------------------------------


def normalize_focal(x: float, y: float):
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    fx, fy = clamp(js_round(x), 0, 100), clamp(js_round(y), 0, 100)
    return None if (fx, fy) == (50, 50) else {"x": fx, "y": fy}


def crop_window(width, height, ratio, focus):
    if width / height > ratio:
        w = clamp(js_round(height * ratio), 1, width)
        left = clamp(js_round((focus["x"] / 100) * width - w / 2), 0, width - w)
        return {"left": left, "top": 0, "width": w, "height": height}
    h = clamp(js_round(width / ratio), 1, height)
    top = clamp(js_round((focus["y"] / 100) * height - h / 2), 0, height - h)
    return {"left": 0, "top": top, "width": width, "height": h}


def output_size(src_w, src_h, width, ratio=None, focus=None):
    if not (src_w >= 1 and src_h >= 1) or not width >= 1:
        raise ValueError("range")
    if ratio is not None and not ratio > 0:
        raise ValueError("range")
    if ratio is not None and focus is not None:
        win = crop_window(src_w, src_h, ratio, focus)
        sw, sh = win["width"], win["height"]
    else:
        sw, sh = src_w, src_h
    target_h = js_round(width / ratio) if ratio is not None else 0
    scale = min(1, sw / width, sh / target_h if target_h else 1)
    out_w = max(1, js_round(width * scale))
    if not target_h:
        return {"requestWidth": width, "width": out_w, "height": max(1, js_round(sh * out_w / sw))}
    return {"requestWidth": width, "width": out_w, "height": max(1, js_round(target_h * scale))}


def oriented(stored):
    swap = stored["orientation"] >= 5
    return (stored["height"], stored["width"]) if swap else (stored["width"], stored["height"])


# --- URLs --------------------------------------------------------------------

SEGMENT_SAFE = "!'()*-._~"  # plus ASCII letters and digits, as encodeURIComponent


def encode_segment(text: str) -> str:
    return quote(text.encode("utf-8"), safe=SEGMENT_SAFE)


STRAY_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")


def decode_segment(segment: str) -> str | None:
    """decodeURIComponent, or None where it would throw."""
    if STRAY_PERCENT.search(segment):
        return None
    raw = re.sub(rb"%([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), segment.encode("utf-8"))
    try:
        return raw.decode("utf-8")
    except UnicodeError:
        return None


URL_SCHEMES = {"http", "https"}
SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):")
SINGLE_DOT = {".", "%2e"}
DOUBLE_DOT = {"..", ".%2e", "%2e.", "%2e%2e"}


def url_path_segments(src: str) -> list[str]:
    """The path of `src` resolved as a URL relative to an http base, as raw
    segments (before the URL parser's own percent-encoding): leading and
    trailing C0 controls and spaces trimmed, ASCII tab, LF and CR removed,
    scheme and authority dropped, a backslash read as a slash, query and
    fragment dropped, and `.`/`..` segments (also as `%2e`) resolved. Only
    http and https are handled; any other scheme raises ValueError, since it
    never names a file under the mount."""
    text = re.sub(r"[\t\n\r]", "", src.strip("".join(map(chr, range(0x21)))))
    scheme = SCHEME.match(text)
    if scheme:
        name = scheme.group(1).lower()
        if name not in URL_SCHEMES:
            raise ValueError(f"unsupported scheme {name}")
        rest = text[scheme.end():]
        if name == "http" and not rest[:1] in ("/", "\\"):
            text = rest  # the base's own scheme without slashes: a relative path
        else:
            text = "//" + rest.lstrip("/\\")
    text = re.split(r"[?#]", text, maxsplit=1)[0]
    if text[:2] in ("//", "\\\\", "/\\", "\\/"):
        authority = re.search(r"[/\\]", text[2:])
        text = text[2 + authority.start():] if authority else ""
    segments = re.split(r"[/\\]", text)
    if text[:1] in ("/", "\\"):
        segments = segments[1:]
    out: list[str] = []
    for i, segment in enumerate(segments):
        last = i == len(segments) - 1
        if segment.lower() in DOUBLE_DOT:
            if out:
                out.pop()
            if last:
                out.append("")
        elif segment.lower() in SINGLE_DOT:
            if last:
                out.append("")
        else:
            out.append(segment)
    return out or [""]


def encode_path(src: str) -> str:
    """Canonical encoded path: the URL path of `src` (url_path_segments), each
    segment with a stray `%` read as a literal `%`, decoded, NFC-normalized and
    encoded again. A segment whose escapes are not valid UTF-8 is not decoded:
    its escapes stay as written in uppercase hex, and every other character
    is encoded."""
    encoded = []
    for segment in url_path_segments(src):
        segment = STRAY_PERCENT.sub("%25", segment)
        decoded = decode_segment(segment)
        if decoded is None:
            parts = re.findall(r"%[0-9A-Fa-f]{2}|[^%]+", segment)
            encoded.append("".join(p.upper() if p[0] == "%" else encode_segment(p) for p in parts))
        else:
            encoded.append(encode_segment(unicodedata.normalize("NFC", decoded)))
    return "/" + "/".join(encoded)


QUERY_ORDER = ["ar", "fmt", "fx", "fy", "q", "token", "v", "w"]


def build_url(base: str, request: dict) -> str:
    base = base.rstrip("/")
    focus = request.get("focalPoint")
    values = {
        "ar": request.get("aspectRatio"),
        "fmt": request["format"],
        "fx": focus["x"] if focus else None,
        "fy": focus["y"] if focus else None,
        "q": request["quality"],
        "token": request.get("token") or None,
        "v": request.get("version") or None,
        "w": request["width"],
    }
    parts = []
    for key in QUERY_ORDER:
        value = values[key]
        if value is None:
            continue
        text = value if isinstance(value, str) else format_number(float(value))
        parts.append(f"{key}={encode_segment(text)}")
    return f"{base}{encode_path(request['src'])}?{'&'.join(parts)}"


PERCENT = re.compile(r"^(?:100|[1-9]?[0-9])$")
VERSION = re.compile(r"^[A-Za-z0-9._~-]{1,64}$")
TOKEN_SHAPE = re.compile(r"^1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{22}$")


def parse_query(raw: str, strict_q: bool = True, tokens: bool = True):
    """The canonical query of the reference backend, or None for a 400."""
    names = set(QUERY_ORDER) if tokens else set(QUERY_ORDER) - {"token"}
    values: dict[str, str] = {}
    previous = ""
    for part in raw.split("&") if raw else []:
        name, eq, value = part.partition("=")
        if name not in names or not eq or name <= previous:
            return None
        previous = name
        values[name] = value

    def ladder_value(text, ladder):
        return next((n for n in ladder if format_number(float(n)) == text), None)

    width = ladder_value(values.get("w"), DEFAULT_WIDTHS)
    fmt = values.get("fmt")
    if width is None or fmt not in DEFAULT_FORMATS:
        return None
    params = {"width": width, "aspectRatio": None, "focalPoint": None, "quality": None,
              "format": fmt, "version": None, "token": None}
    if "ar" in values:
        params["aspectRatio"] = ladder_value(values["ar"], DEFAULT_RATIOS)
        if params["aspectRatio"] is None:
            return None
    if "fx" in values or "fy" in values:
        fx, fy = values.get("fx"), values.get("fy")
        if fx is None or fy is None or params["aspectRatio"] is None:
            return None
        if not (PERCENT.match(fx) and PERCENT.match(fy)) or (fx, fy) == ("50", "50"):
            return None
        params["focalPoint"] = {"x": int(fx), "y": int(fy)}
    if "q" in values:
        params["quality"] = ladder_value(values["q"], DEFAULT_QUALITIES)
        if params["quality"] is None:
            return None
    elif strict_q:
        return None
    else:
        params["quality"] = DEFAULT_QUALITIES[0]
    if "token" in values:
        if not TOKEN_SHAPE.match(values["token"]):
            return None
        params["token"] = values["token"]
    if "v" in values:
        if not VERSION.match(values["v"]):
            return None
        params["version"] = values["v"]
    return params


# --- Crop tokens -------------------------------------------------------------

TOKEN_DOMAIN = b"lazy-ease/crop-token/1\x00"
TENANT = re.compile(r"^[A-Za-z0-9._~-]{1,64}$")
KID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def test_key(tenant: str, kid: str) -> bytes:
    return hashlib.sha256(f"lazy-ease public test key/{tenant}/{kid}".encode("utf-8")).digest()


def token_message(grant: dict) -> bytes:
    tenant, kid, source = grant["tenant"], grant["kid"], grant["source"]
    if not TENANT.match(tenant) or not KID.match(kid):
        raise ValueError("invalid-input")
    if not source.startswith("/") or encode_path(source) != source:
        raise ValueError("invalid-input")
    revision = grant.get("revision")
    if revision is not None and not VERSION.match(revision):
        raise ValueError("invalid-input")
    ar, fx, fy = grant.get("ar"), grant.get("fx"), grant.get("fy")
    if ar is not None:
        if ar not in [format_number(r) for r in DEFAULT_RATIOS]:
            raise ValueError("invalid-input")
    if (fx is None) != (fy is None) or (fx is not None and ar is None):
        raise ValueError("invalid-input")
    if fx is not None and (not PERCENT.match(fx) or not PERCENT.match(fy) or (fx, fy) == ("50", "50")):
        raise ValueError("invalid-input")
    return encode_fields((tenant, kid, source, revision, ar, fx, fy))


def encode_fields(values) -> bytes:
    """The signed bytes of the seven fields, without validating them."""
    out = bytearray(TOKEN_DOMAIN)
    for value in values:
        if value is None:
            out += b"\x00"
        else:
            data = value.encode("utf-8")
            out += b"\x01" + len(data).to_bytes(4, "big") + data
    return bytes(out)


def sign(grant: dict, key: bytes) -> str:
    mac = hmac.new(key, token_message(grant), hashlib.sha256).digest()[:16]
    return f"1.{grant['kid']}." + base64.urlsafe_b64encode(mac).rstrip(b"=").decode("ascii")


def verify(grant_without_kid: dict, token: str, keys: dict) -> bool:
    if not TOKEN_SHAPE.match(token):
        return False
    kid = token.split(".")[1]
    key = keys.get((grant_without_kid["tenant"], kid))
    if key is None:
        return False
    try:
        expected = sign({**grant_without_kid, "kid": kid}, key)
    except ValueError:
        return False
    return hmac.compare_digest(expected.encode("ascii"), token.encode("ascii"))


# --- Checks ------------------------------------------------------------------

problems: list[str] = []


def check(condition: bool, where: str, message: str) -> None:
    if not condition:
        problems.append(f"{where}: {message}")


def equal(actual, expected, where: str) -> None:
    check(actual == expected, where, f"expected {json.dumps(expected, ensure_ascii=False)}, "
                                     f"recomputed {json.dumps(actual, ensure_ascii=False)}")


def num(value):
    """JSON numbers are IEEE doubles; Python reads integers as int."""
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else value


def same_number(a, b) -> bool:
    return a is not None and b is not None and float(a) == float(b)


def check_ladders(doc):
    data = doc["data"]
    equal(data["widths"], DEFAULT_WIDTHS, "ladders.data.widths")
    equal([num(r) for r in data["ratios"]], DEFAULT_RATIOS, "ladders.data.ratios")
    check(len(data["ratios"]) == 73, "ladders.data.ratios", "must hold 73 ratios")
    equal(data["qualities"], DEFAULT_QUALITIES, "ladders.data.qualities")
    equal(data["formats"], DEFAULT_FORMATS, "ladders.data.formats")
    for case in doc["cases"]:
        where, i, e = f"ladders/{case['id']}", case["input"], case["expected"]
        if case["op"] == "snapWidth":
            check(same_number(snap_width(num(i["width"]), i.get("ladder", DEFAULT_WIDTHS)), e["width"]), where, "snapWidth")
        elif case["op"] == "snapRatio":
            check(same_number(snap_ratio(num(i["ratio"]), [num(r) for r in i.get("ladder", data["ratios"])]), e["ratio"]), where, "snapRatio")
        elif case["op"] == "snapQuality":
            check(same_number(snap_quality(num(i["quality"]), i["allowed"]), e["quality"]), where, "snapQuality")
        else:
            check(False, where, f"unknown op {case['op']}")


def check_numbers(doc):
    for case in doc["cases"]:
        where, i, e = f"numbers/{case['id']}", case["input"], case["expected"]
        if "special" in i:
            value = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}[i["special"]]
        else:
            value = num(i["value"])
        try:
            actual = {"text": format_number(value)}
        except ValueError:
            actual = {"error": "range"}
        equal(actual, e, where)


def check_focal(doc):
    for case in doc["cases"]:
        i = case["input"]
        equal({"focalPoint": normalize_focal(num(i["x"]), num(i["y"]))}, case["expected"], f"focal/{case['id']}")


def check_crops(doc):
    for case in doc["cases"]:
        where, i = f"crops/{case['id']}", case["input"]
        if "stored" in i:
            equal(list(oriented(i["stored"])), [i["srcWidth"], i["srcHeight"]], f"{where} oriented size")
        window = crop_window(i["srcWidth"], i["srcHeight"], num(i["aspectRatio"]), i["focalPoint"])
        equal(window, case["expected"], where)
        w = case["expected"]
        check(0 <= w["left"] and w["left"] + w["width"] <= i["srcWidth"], where, "window leaves the source")
        check(0 <= w["top"] and w["top"] + w["height"] <= i["srcHeight"], where, "window leaves the source")


def check_outputs(doc):
    for case in doc["cases"]:
        where, i = f"outputs/{case['id']}", case["input"]
        if "stored" in i:
            equal(list(oriented(i["stored"])), [i["srcWidth"], i["srcHeight"]], f"{where} oriented size")
        try:
            actual = output_size(num(i["srcWidth"]), num(i["srcHeight"]), num(i["width"]),
                                 num(i.get("aspectRatio")), i.get("focalPoint"))
            actual = {k: (int(v) if float(v).is_integer() else v) for k, v in actual.items()}
            expected = {k: (int(v) if float(v).is_integer() else v) for k, v in case["expected"].items()}
        except ValueError:
            actual, expected = {"error": "range"}, case["expected"]
        equal(actual, expected, where)


def check_candidates(doc):
    for case in doc["cases"]:
        where, i, e = f"candidates/{case['id']}", case["input"], case["expected"]
        ladder = i.get("ladder", DEFAULT_WIDTHS)
        widths = candidate_widths(i["mode"], num(i["slotWidth"]), ladder, i.get("srcWidth"))
        equal(widths, e["requestWidths"], f"{where} requestWidths")
        if "srcWidth" not in i or "srcHeight" not in i:
            equal(e["outputs"], None, f"{where} outputs")
            equal(e["srcset"], None, f"{where} srcset")
            equal(e["single"], {"requestWidth": max(widths), "width": None, "height": None}, f"{where} single")
            continue
        outputs = [output_size(i["srcWidth"], i["srcHeight"], w, num(i.get("aspectRatio")), i.get("focalPoint"))
                   for w in widths]
        equal(outputs, e["outputs"], f"{where} outputs")
        unique = []
        for o in outputs:
            if not any(u["width"] == o["width"] and u["height"] == o["height"] for u in unique):
                unique.append(o)
        if len(unique) == 1:
            equal(e["srcset"], None, f"{where} srcset")
            equal(e["single"], unique[0], f"{where} single")
        else:
            equal(e["srcset"], unique, f"{where} srcset")
            equal(e["single"], None, f"{where} single")


def check_urls(doc):
    for case in doc["cases"]:
        where, i, e = f"urls/{case['id']}", case["input"], case["expected"]
        try:
            if case["op"] == "encodePath":
                actual = {"path": encode_path(i["src"])}
            elif case["op"] == "url":
                actual = {"url": build_url(i.get("baseUrl", "/_img"), i["request"])}
            else:
                check(False, where, f"unknown op {case['op']}")
                continue
        except ValueError:
            actual = {"error": "invalid-input"}
        equal(actual, e, where)


SOURCE_TYPES = {"jpg", "jpeg", "png", "webp", "avif", "gif"}


def admit_path(raw: str) -> str | None:
    """The file a backend path names under the source root (decoded, NFC), or
    None for a 400: a segment that does not decode, dot segments after
    decoding, a backslash, colon or NUL, a leading `//`, or a type other than
    JPEG, PNG, WebP, AVIF and GIF."""
    if not raw.startswith("/"):
        return None
    decoded = []
    for segment in raw.split("/"):
        text = decode_segment(segment)
        if text is None:
            return None
        decoded.append(text)
    path = unicodedata.normalize("NFC", "/".join(decoded))
    if path.startswith("//") or any(c in path for c in "\\:\x00"):
        return None
    if any(s in (".", "..") for s in path.split("/")):
        return None
    name = path.rsplit("/", 1)[-1]
    if "." not in name or name.rsplit(".", 1)[-1].lower() not in SOURCE_TYPES:
        return None
    return path[1:]


def check_backend(doc):
    # A 404 names a file outside the source root, which holds exactly the
    # files of the 200 cases.
    served = {c["expected"]["file"] for c in doc["cases"] if c["op"] == "path" and c["expected"]["status"] == 200}
    for case in doc["cases"]:
        where, i, e = f"backend/{case['id']}", case["input"], case["expected"]
        if case["op"] == "query":
            params = parse_query(i["query"])
            actual = {"status": 400} if params is None else {"status": 200, "params": params}
            if params is not None:
                expected = {**e, "params": {k: num(v) if k == "aspectRatio" else v for k, v in e["params"].items()}}
                actual["params"] = {k: num(v) if k == "aspectRatio" else v for k, v in params.items()}
                actual["params"]["width"] = int(actual["params"]["width"])
                expected["params"]["width"] = int(expected["params"]["width"])
            else:
                expected = e
            equal(actual, expected, where)
        elif case["op"] == "path":
            raw = i["rawPath"]
            file = admit_path(raw)
            if file is None:
                actual = {"status": 400}
            elif file not in served:
                actual = {"status": 404}
            else:
                actual = {"status": 200, "file": file, "canonicalPath": encode_path(raw),
                          "canonical": raw == encode_path(raw)}
            equal(actual, e, where)
        else:
            check(False, where, f"unknown op {case['op']}")


def check_tokens(doc):
    data = doc["data"]
    keys = {}
    for key in data["keys"]:
        derived = test_key(key["tenant"], key["kid"])
        equal(key["keyHex"], derived.hex(), f"tokens.keys {key['tenant']}/{key['kid']}")
        keys[(key["tenant"], key["kid"])] = bytes.fromhex(key["keyHex"])
    for case in doc["cases"]:
        where, i, e = f"tokens/{case['id']}", case["input"], case["expected"]
        if case["op"] == "sign":
            grant = i["grant"]
            try:
                message = token_message(grant)
            except ValueError:
                equal({"error": "invalid-input"}, e, where)
                continue
            equal(message.hex(), e["messageHex"], f"{where} messageHex")
            equal(sign(grant, keys[(grant["tenant"], grant["kid"])]), e["token"], f"{where} token")
            if "url" in e:
                url = build_url("/_img", {**i["request"], "token": e["token"]})
                equal(url, e["url"], f"{where} url")
        elif case["op"] == "verify":
            grant = i["grant"]
            if "rawPath" in i:
                # The request carried a non-canonical spelling of the signed
                # source: admit it like a backend path and MAC the canonical one.
                raw = i["rawPath"]
                check(raw != grant["source"], where, "rawPath must differ from grant.source")
                check(admit_path(raw) is not None, where, "rawPath must be an admitted backend path")
                equal(encode_path(raw), grant["source"], f"{where} canonical rawPath")
                kid = i["token"].split(".")[1]
                fields = [grant["tenant"], kid, raw] + [grant.get(k) for k in ("revision", "ar", "fx", "fy")]
                raw_mac = hmac.new(keys[(grant["tenant"], kid)], encode_fields(fields), hashlib.sha256).digest()[:16]
                raw_token = f"1.{kid}." + base64.urlsafe_b64encode(raw_mac).rstrip(b"=").decode("ascii")
                check(raw_token != i["token"], where, "a MAC over the raw spelling must not match")
                grant = {**grant, "source": encode_path(raw)}
            equal({"valid": verify(grant, i["token"], keys)}, e, where)
        else:
            check(False, where, f"unknown op {case['op']}")


CHECKS = {
    "ladders": check_ladders,
    "numbers": check_numbers,
    "focal": check_focal,
    "crops": check_crops,
    "outputs": check_outputs,
    "candidates": check_candidates,
    "urls": check_urls,
    "backend": check_backend,
    "tokens": check_tokens,
}

ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "packages" / "testing" / "fixtures"
    manifest = json.loads((root / "manifest.json").read_bytes().decode("utf-8"))
    check(manifest["format"] == FORMAT and manifest["fixtureVersion"] == FIXTURE_VERSION, "manifest", "envelope")
    equal([f["name"] for f in manifest["files"]], [f"{n}.json" for n in FILES], "manifest.files")
    total = 0
    for entry in manifest["files"]:
        data = (root / entry["name"]).read_bytes()
        equal(hashlib.sha256(data).hexdigest(), entry["sha256"], f"manifest {entry['name']} sha256")
        equal(len(data), entry["bytes"], f"manifest {entry['name']} bytes")
        check(b"\r" not in data, entry["name"], "must use LF line endings")
        doc = json.loads(data.decode("utf-8"))
        name = entry["name"][: -len(".json")]
        check(doc["format"] == FORMAT and doc["fixtureVersion"] == FIXTURE_VERSION and doc["file"] == name,
              entry["name"], "envelope")
        ids = [case["id"] for case in doc["cases"]]
        check(len(ids) == len(set(ids)), entry["name"], "case ids must be unique")
        for case_id in ids:
            check(bool(ID.match(case_id)), entry["name"], f"case id {case_id!r} is not kebab-case")
        equal(len(doc["cases"]), entry["cases"], f"manifest {entry['name']} cases")
        CHECKS[name](doc)
        total += len(doc["cases"])
    if problems:
        print("\n".join(f"x {p}" for p in problems), file=sys.stderr)
        print(f"\n{len(problems)} fixture problem(s)", file=sys.stderr)
        return 1
    print(f"All {total} fixture cases in {len(manifest['files'])} files agree with the Python reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())
