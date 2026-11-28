#!/usr/bin/env python3
import os
import urllib.request
import json
import re

def main():
    log_file = "gradle-build.log"
    if not os.path.exists(log_file):
        print("No gradle-build.log found.")
        return

    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
        lines = content.splitlines()

    # If entire log is under 50KB, post the whole log
    if len(content) < 50000:
        summary_text = "### ❌ Complete Gradle Build Log:\n```\n" + content + "\n```\n"
    else:
        error_lines = [l for l in lines if re.search(r'(?i)error|exception|failed|failure|caused by', l)]
        summary_text = "### ❌ Compiler Errors Found:\n```\n" + "\n".join(error_lines[:80]) + "\n```\n\n"
        summary_text += "### Top of Log:\n```\n" + "\n".join(lines[:60]) + "\n```\n\n"
        summary_text += "### Log Tail:\n```\n" + "\n".join(lines[-80:]) + "\n```\n"

    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        try:
            with open(summary_file, "a", encoding="utf-8") as sf:
                sf.write(summary_text)
        except Exception as e:
            print(f"Error writing step summary: {e}")

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    sha = os.environ.get("GITHUB_SHA")

    if not token or not repo or not sha:
        print("Missing token, repo or sha for commit comment.")
        return

    comment_url = f"https://api.github.com/repos/{repo}/commits/{sha}/comments"
    body_payload = {
        "body": summary_text
    }
    req = urllib.request.Request(
        comment_url,
        data=json.dumps(body_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "CI-Error-Reporter/1.0",
            "Content-Type": "application/json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print("Successfully posted failure comment to commit!")
    except Exception as e:
        print(f"Failed to post commit comment: {e}")

if __name__ == "__main__":
    main()
