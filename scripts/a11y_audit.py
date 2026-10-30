"""Section 508 / WCAG 2.x evidence for CAD Workbench.

Runs axe-core (WCAG 2.0/2.1 A and AA rules) against each main screen, a keyboard-only
walk, and a 200 % zoom (reflow) check, then writes docs/compliance/a11y-results.json.

    npm run build && npm start &          # app on http://localhost:8000
    pip install playwright && python scripts/a11y_audit.py [base_url]

The test browser bypasses the page's Content Security Policy only so it can inject axe-core;
the app is otherwise tested exactly as deployed.
"""
import json, sys, time, datetime, pathlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
ROOT = pathlib.Path(__file__).resolve().parents[1]
AXE = (ROOT / "node_modules/axe-core/axe.min.js").read_text()
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]


def run_axe(page):
    page.add_script_tag(content=AXE)
    return page.evaluate("tags => axe.run(document, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations', 'incomplete']})", TAGS)


def summarise(res):
    pick = lambda items: [
        {"id": v["id"], "impact": v.get("impact"), "help": v["help"], "wcag": [t for t in v["tags"] if t.startswith("wcag") and t[4:].isdigit()],
         "nodes": len(v["nodes"]), "examples": [n["target"][0] if n["target"] else "" for n in v["nodes"][:3]]}
        for v in items
    ]
    return {"violations": pick(res["violations"]), "needs_review": pick(res["incomplete"]), "passes": len(res.get("passes", []))}


def main():
    report = {"tool": "axe-core", "tags": TAGS, "url": BASE, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "screens": {}, "keyboard": {}, "reflow": {}}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = b.new_context(viewport={"width": 1600, "height": 900}, bypass_csp=True)
        page = ctx.new_page()
        page.goto(BASE)
        page.locator(".cmd-status", has_text="Regenerated").wait_for(timeout=90000)
        report["axe_version"] = page.evaluate("() => 0") or None

        def screen(name, setup=None, teardown=None):
            if setup:
                setup()
                time.sleep(0.6)
            res = run_axe(page)
            report["axe_version"] = res["testEngine"]["version"]
            report["screens"][name] = summarise(res)
            if teardown:
                teardown()
                time.sleep(0.3)

        esc = lambda: page.keyboard.press("Escape")
        screen("Main workspace (browser, viewport, SI assistant, timeline)")
        screen("Parameters dialog", lambda: page.keyboard.press("p"), esc)
        screen("Feature dialog (hole)", lambda: page.locator(".tl-chip").nth(3).dblclick(), lambda: page.get_by_role("button", name="Cancel").click())
        screen("Engineering checks dialog", lambda: (page.keyboard.press("v"), time.sleep(4)), esc)
        screen("Ribbon menu (CREATE)", lambda: page.locator(".rgroup-label", has_text="CREATE").click(), esc)
        screen("Home tab", lambda: page.locator(".doc-tab", has_text="Home").click(), lambda: page.locator(".doc-tab.active, .doc-tab").nth(1).click())
        screen("Properties dialog", lambda: page.evaluate("() => 0") or page.get_by_title("Properties").first.click(), esc)

        # Keyboard-only walk: Tab through the page and record what receives focus and whether
        # a focus indicator is drawn.
        page.mouse.click(5, 5)
        seen, missing_outline = [], []
        for _ in range(80):
            page.keyboard.press("Tab")
            info = page.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return null;
              const s = getComputedStyle(e); const name = e.getAttribute('aria-label') || e.title || (e.innerText || e.value || e.placeholder || '').trim().slice(0, 40);
              return { tag: e.tagName.toLowerCase(), name, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 }; }""")
            if info:
                seen.append(f"{info['tag']}: {info['name']}")
                if not info["outline"]:
                    missing_outline.append(f"{info['tag']}: {info['name']}")
        report["keyboard"] = {
            "tab_stops_sampled": len(seen),
            "unique_controls_reached": len(set(seen)),
            "without_visible_focus": sorted(set(missing_outline)),
            "first_stops": seen[:25],
            "shortcuts": "E extrude, H hole, F fillet, P parameters, V validate, I assistant, S command line, Ctrl+Z/Y, Ctrl+S, Del, Esc",
            "viewport_keyboard_navigation": False,
        }

        # Keyboard operation of specific controls (WCAG 2.1.1, 2.4.3, 1.1.1, 1.4.1).
        checks = {}
        page.keyboard.press("Escape")
        tree_rows = page.locator("[role=treeitem]")
        tree_rows.first.focus()
        page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown")  # -> Named Views
        named = page.evaluate("() => document.activeElement.innerText")
        page.keyboard.press("ArrowRight"); time.sleep(0.2)
        checks["tree_expand_with_arrow_keys"] = page.locator("[role=treeitem]", has_text="Top").count() > 0 and "Named Views" in named
        chip = page.locator(".tl-chip").nth(3)
        chip.focus(); page.keyboard.press("Enter"); time.sleep(0.2); page.keyboard.press("Enter"); time.sleep(0.6)
        checks["timeline_feature_opens_with_enter_twice"] = page.locator(".dialog.feature").count() == 1
        checks["dialog_receives_focus"] = page.evaluate("() => !!document.activeElement.closest('.dialog')")
        page.get_by_role("button", name="Cancel").click(); time.sleep(0.3)
        page.keyboard.press("p"); time.sleep(0.4)
        checks["parameters_dialog_receives_focus"] = page.evaluate("() => !!document.activeElement.closest('.dialog')")
        page.keyboard.press("Escape"); time.sleep(0.3)
        checks["canvas_text_alternative"] = page.evaluate("() => document.querySelector('.viewport canvas').getAttribute('aria-label')")
        labels = page.evaluate("() => [...document.querySelectorAll('.tl-chip')].map(c => c.getAttribute('aria-label'))")
        checks["timeline_chips_named"] = all(labels) and len(labels) > 0
        checks["timeline_example_label"] = labels[3] if len(labels) > 3 else None
        page.keyboard.press("Escape")
        page.mouse.click(5, 5); page.keyboard.press("Tab")
        checks["skip_link_is_first_tab_stop"] = page.evaluate("() => document.activeElement.className") == "skip-link"
        page.keyboard.press("Enter"); time.sleep(0.3)
        checks["skip_link_moves_focus_to_design"] = page.evaluate("() => document.activeElement.getAttribute('role')") == "treeitem"
        page.locator(".rgroup-label", has_text="MODIFY").focus(); page.keyboard.press("Enter"); time.sleep(0.3)
        first = page.evaluate("() => document.activeElement.getAttribute('role')")
        page.keyboard.press("ArrowDown"); second = page.evaluate("() => document.activeElement.innerText")
        page.keyboard.press("Escape"); time.sleep(0.2)
        checks["menu_focus_and_arrow_keys"] = first == "menuitem" and "Chamfer" in second
        checks["menu_returns_focus_to_opener"] = "MODIFY" in page.evaluate("() => document.activeElement.innerText")
        checks["landmarks"] = page.evaluate("() => [...document.querySelectorAll('header, main, aside, [role=region]')].map(e => e.getAttribute('aria-label') || e.tagName.toLowerCase())")
        report["manual_checks"] = checks

        # Reflow / resize text: 1280 px at 200 % zoom is equivalent to a 640 px wide viewport.
        page.set_viewport_size({"width": 640, "height": 900})
        time.sleep(0.6)
        report["reflow"] = page.evaluate("""() => ({ width: innerWidth,
            horizontal_scroll: document.documentElement.scrollWidth > innerWidth + 1,
            clipped_regions: [...document.querySelectorAll('.ribbon-groups, .tl-track, .browser, .assistant')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className.split(' ')[0]) })""")
        page.screenshot(path=str(ROOT / "docs/compliance/a11y-reflow-640.png"))
        b.close()

    out = ROOT / "docs/compliance/a11y-results.json"
    out.write_text(json.dumps(report, indent=2))
    total = sum(len(s["violations"]) for s in report["screens"].values())
    print(f"axe {report['axe_version']}: {total} violation types across {len(report['screens'])} screens")
    for name, s in report["screens"].items():
        for v in s["violations"]:
            print(f"  [{name}] {v['id']} ({v['impact']}, {v['nodes']} nodes): {v['help']} e.g. {v['examples'][:2]}")
    print("keyboard:", report["keyboard"]["unique_controls_reached"], "controls;", len(report["keyboard"]["without_visible_focus"]), "without visible focus")
    print("reflow:", report["reflow"])
    for k, v in report["manual_checks"].items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
