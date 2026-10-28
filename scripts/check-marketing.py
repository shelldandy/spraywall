#!/usr/bin/env python3
"""Dependency-free structural checks for the standalone marketing site (Python 3.11+).

This is not an HTML conformance checker or a substitute for browser/accessibility review.
Run from any directory: python3 scripts/check-marketing.py
"""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
import tomllib
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "marketing"
REPO_URL = "https://github.com/shelldandy/spraywall"
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.title = ""
        self.in_title = False
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))
        if tag == "title":
            self.in_title = True

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data

    def find(self, tag):
        return [attrs for name, attrs in self.elements if name == tag]

    @property
    def ids(self):
        return [attrs["id"] for _, attrs in self.elements if "id" in attrs]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_ids(ids, path):
    repeated = [key for key, count in Counter(ids).items() if count > 1]
    require(not repeated, f"Duplicate IDs in {path}: {repeated}")
    require(all(ids), f"Empty ID in {path}")


def check_reference(origin, reference, fragment_ids=None):
    """Check a local reference and its fragment without allowing publish-root escapes."""
    require(bool(reference), f"Empty local reference in {origin.name}")
    url = urlsplit(reference)
    require(not url.scheme and not url.netloc, f"Non-local asset in {origin}: {reference}")
    path = unquote(url.path)
    if not path:
        target = origin
    elif path.startswith("/"):
        target = SITE / path.lstrip("/")
    else:
        target = origin.parent / path
    target = target.resolve()
    require(target.is_relative_to(SITE), f"Reference escapes marketing/: {reference}")
    require(target.is_file(), f"Missing local file in {origin.name}: {reference}")
    if url.fragment:
        ids = fragment_ids if target == origin.resolve() else None
        if ids is None:
            if target.suffix == ".svg":
                ids = [node.get("id") for node in ET.parse(target).iter() if node.get("id")]
            elif target.suffix == ".html":
                ids = Page(target.read_text(encoding="utf-8")).ids
            else:
                raise ValueError(f"Unsupported fragment target: {reference}")
        require(unquote(url.fragment) in ids, f"Missing fragment in {origin.name}: {reference}")


def check_page():
    path = SITE / "index.html"
    source = path.read_text(encoding="utf-8")
    page = Page(source)
    require(source.lstrip().lower().startswith("<!doctype html>"), "Missing HTML5 doctype")
    require(page.find("html") == [{"lang": "en"}], "Set the document language to English")
    for tag in ("head", "body", "title", "header", "main", "footer", "h1"):
        require(len(page.find(tag)) == 1, f"Expected exactly one {tag}")
    require(bool(page.title.strip()), "Missing page title")
    require(len(page.find("nav")) >= 2, "Missing main/footer navigation")
    require(not any(page.find(tag) for tag in ("script", "form", "iframe", "object", "embed", "base")),
            "The page must stay static, dependency-free, and self-contained")
    check_ids(page.ids, path)
    require({"main", "features", "how-it-works", "self-host"} <= set(page.ids), "Missing section IDs")
    require(any(a.get("href") == "#main" and a.get("class") == "skip-link" for a in page.find("a")),
            "Missing skip-to-content link")
    require(page.find("main")[0].get("tabindex") == "-1", "Main must be a skip-link focus target")

    meta = {attrs.get("name", attrs.get("property")): attrs.get("content", "") for attrs in page.find("meta")}
    for key in ("viewport", "description", "theme-color", "og:title", "og:description", "og:type"):
        require(bool(meta.get(key, "").strip()), f"Missing metadata: {key}")
    require(any(attrs.get("charset", "").lower() == "utf-8" for attrs in page.find("meta")),
            "Missing UTF-8 charset")
    require("width=device-width" in meta["viewport"], "Missing responsive viewport")
    for rel in ("icon", "stylesheet"):
        require(any(rel in attrs.get("rel", "").split() for attrs in page.find("link")), f"Missing {rel}")

    links = {attrs.get("href") for attrs in page.find("a")}
    for expected in (REPO_URL, f"{REPO_URL}#self-hosting", f"{REPO_URL}/blob/main/LICENSE"):
        require(expected in links, f"Missing CTA: {expected}")
    for tag, attrs in page.elements:
        if tag == "img":
            require("alt" in attrs, "Every image needs an alt attribute (empty for decorative images)")
            require("width" in attrs and "height" in attrs, "Images need dimensions to reserve layout space")
        for key in ("href", "src"):
            if key not in attrs:
                continue
            reference = attrs[key]
            require(bool(reference), f"Empty {key} on {tag}")
            if tag == "a" and reference == "#":
                continue  # The wordmark links to the top of this single page.
            if tag == "a" and urlsplit(reference).scheme:
                require(urlsplit(reference).scheme == "https", f"Non-HTTPS link: {reference}")
            else:
                check_reference(path, reference, page.ids)


def check_assets():
    for path in SITE.rglob("*"):
        require(not path.is_symlink(), f"Do not publish symlinks: {path}")
        if not path.is_file():
            continue
        require(path.suffix in {".html", ".css", ".svg", ".png"}, f"Unexpected public file: {path}")
        if path.suffix == ".css":
            source = path.read_text(encoding="utf-8")
            require(not re.search(r"@import\b", source, re.IGNORECASE), "Keep styles self-contained")
            for _, reference in CSS_URL.findall(source):
                check_reference(path, reference)
        elif path.suffix == ".svg":
            tree = ET.parse(path)
            nodes = list(tree.iter())
            ids = [node.get("id") for node in nodes if node.get("id") is not None]
            check_ids(ids, path)
            require(tree.getroot().tag == "{http://www.w3.org/2000/svg}svg", f"Invalid SVG root: {path}")
            for tag in ("title", "desc"):
                require(any(node.tag == f"{{http://www.w3.org/2000/svg}}{tag}" and (node.text or "").strip()
                            for node in nodes), f"Missing SVG {tag}: {path}")
            for node in nodes:
                require(node.tag != "{http://www.w3.org/2000/svg}script", f"Unexpected SVG script: {path}")
                for name, value in node.attrib.items():
                    if name in {"href", "{http://www.w3.org/1999/xlink}href"}:
                        check_reference(path, value, ids)
                    for _, reference in CSS_URL.findall(value):
                        check_reference(path, reference, ids)


def check_netlify():
    config = tomllib.loads((ROOT / "netlify.toml").read_text(encoding="utf-8"))
    build = config.get("build", {})
    base = (ROOT / build.get("base", "")).resolve()
    require(base == ROOT, "Netlify base must be the repository root")
    require((base / build.get("publish", "")).resolve() == SITE, "Netlify must publish only marketing/")
    require(build.get("command") == "", "The static site must have an explicitly empty build command")
    require(not any(config.get(key) for key in ("redirects", "functions", "plugins")),
            "No SPA redirects, functions, or build plugins are needed")


def main():
    try:
        check_page()
        check_assets()
        check_netlify()
    except (ValueError, OSError, ET.ParseError) as error:
        print(f"Marketing check failed: {error}", file=sys.stderr)
        return 1
    print("Marketing checks passed: HTML, metadata, CTAs, fragments, assets, SVG, and Netlify config.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
