#!/usr/bin/env python3
"""
JobHawk — LinkedIn Session Capture Script

Requirements:
    pip install selenium
    Google Chrome (Chromium is fine) — Selenium Manager can fetch a matching ChromeDriver.

Usage:
    python3 linkedin_capture.py
    python3 linkedin_capture.py --url http://localhost:5173

Only the li_at cookie is sent to the server. The API materializes the full session
in Playwright Firefox on the server (independent of which browser you use here).
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def check_selenium():
    try:
        import selenium  # noqa: F401
        return True
    except ImportError:
        print("\n  selenium is not installed.")
        print("  Run: pip install selenium")
        print("  Then re-run this script.\n")
        sys.exit(1)


def build_chrome_driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    # Isolated profile — does not use your daily Chrome profile.
    profile_dir = Path.home() / ".cache" / "jobhawk-linkedin-capture-chrome"
    profile_dir.mkdir(parents=True, exist_ok=True)

    options = Options()
    options.add_argument(f"--user-data-dir={profile_dir}")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    try:
        return webdriver.Chrome(options=options)
    except Exception as e:
        print(f"\n  Could not open Chrome: {e}")
        print("  Install Google Chrome / Chromium and ensure ChromeDriver is available.")
        sys.exit(1)


def parse_args():
    p = argparse.ArgumentParser(description="Capture LinkedIn li_at for JobHawk")
    p.add_argument(
        "--url",
        default="http://localhost:5173",
        help="JobHawk server base URL (default: http://localhost:5173)",
    )
    return p.parse_args()


def main():
    args = parse_args()
    backend = args.url.rstrip("/")

    print("╔══════════════════════════════════════════════╗")
    print("║   JobHawk — LinkedIn Session Capture Tool   ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"\n  Backend: {backend}")
    print("  Browser: Chrome (isolated profile under ~/.cache/jobhawk-linkedin-capture-chrome)\n")

    check_selenium()
    driver = build_chrome_driver()

    print("  Opening LinkedIn login...\n")

    try:
        driver.set_window_size(1280, 900)
        driver.get("https://www.linkedin.com/login")

        print("  Please log in to LinkedIn in the browser window.")
        print("  Waiting up to 5 minutes...\n")

        timeout = 5 * 60
        start = time.time()
        logged_in = False

        while time.time() - start < timeout:
            try:
                url = driver.current_url
            except Exception:
                break

            if (
                "/feed" in url
                or "/mynetwork" in url
                or (
                    "linkedin.com" in url
                    and "/login" not in url
                    and "/checkpoint" not in url
                    and "/uas/" not in url
                )
            ):
                logged_in = True
                break

            time.sleep(1)

        if not logged_in:
            print("\n  Timed out waiting for login. Run the script again.")
            sys.exit(1)

        print("  Login detected — capturing session...")
        time.sleep(2.5)

        cookies = driver.get_cookies()
        li_at_cookie = next((c for c in cookies if c["name"] == "li_at"), None)

        if not li_at_cookie:
            print("\n  Could not find li_at cookie.")
            print("  The login may not have fully completed.")
            print("  Try waiting a few seconds on the feed, then run again.")
            sys.exit(1)

        token = li_at_cookie["value"]

        username = "linkedin-user"
        for selector in [
            ".feed-identity-module__member-name",
            ".profile-nav-card__name",
            ".t-16.t-black.t-bold",
        ]:
            try:
                elements = driver.find_elements("css selector", selector)
                if elements and elements[0].text.strip():
                    username = elements[0].text.strip()
                    break
            except Exception:
                pass

        print(f"\n  li_at   : {token[:24]}...")
        print(f"  Username: {username}")
        print(f"\n  Sending li_at to {backend} (full cookie jar is not stored — see script header).")

        payload = json.dumps({"liAt": token, "username": username}).encode("utf-8")
        req = urllib.request.Request(
            f"{backend}/api/auth/linkedin/import-session",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as e:
            print(f"\n  Could not reach backend at {backend}")
            print("  Make sure the server is running.")
            print(f"  Error: {e}")
            sys.exit(1)

        if result.get("ok"):
            print("\n  Session saved!")
            print("  Click 'Connect' for LinkedIn in the app — it will show as Connected.\n")
        else:
            print(f"\n  Backend error: {result.get('error', 'Unknown error')}")

    finally:
        time.sleep(2)
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
