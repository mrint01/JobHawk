#!/usr/bin/env python3
"""
JobHawk — LinkedIn Session Capture Script

Requirements:
    pip install selenium

Usage:
    python3 linkedin_capture.py
    python3 linkedin_capture.py --url https://your-railway-app.up.railway.app
"""

import sys
import time
import json
import urllib.request
import urllib.error


def check_selenium():
    try:
        import selenium  # noqa: F401
        return True
    except ImportError:
        print("\n  selenium is not installed.")
        print("  Run: pip install selenium")
        print("  Then re-run this script.\n")
        sys.exit(1)


def main():
    backend = "http://localhost:5173"
    #"https://jobhawk-server-production.up.railway.app"
    args = sys.argv[1:]

    if "--url" in args:
        idx = args.index("--url")
        if idx + 1 < len(args):
            backend = args[idx + 1].rstrip("/")

    print("╔══════════════════════════════════════════════╗")
    print("║   JobHawk — LinkedIn Session Capture Tool   ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"\n  Backend: {backend}")

    check_selenium()

    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    print("  Opening Chrome...\n")

    options = Options()
    options.add_argument("--window-size=1280,900")

    try:
        driver = webdriver.Chrome(options=options)
    except Exception as e:
        print(f"\n  Could not open Chrome: {e}")
        print("  Make sure Google Chrome is installed on your system.")
        sys.exit(1)

    try:
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

        # Try to extract the display name from the page
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

        print(f"\n  Token   : {token[:24]}...")
        print(f"  Username: {username}")
        print(f"\n  Sending to {backend}...")

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
