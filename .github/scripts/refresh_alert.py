#!/usr/bin/env python3
"""Make a failed data refresh impossible to miss.

Used by the workflows:
  refresh_alert.py follow RUN_ID
      refresh-scheduler.yml: wait for the refresh run the scheduler started and
      pass on its result. Exits 1 if that run did not succeed, naming the failed
      step and its error line, so the failure counts against the scheduler, a
      workflow whose failure emails reach the maintainer. (Runs the scheduler
      starts are attributed to github-actions[bot], which gets no email.)
  refresh_alert.py alert RUN_ID
      refresh.yml, when a fetch run fails: open the refresh-failure issue, or
      comment on it if it is already open, @-mentioning the maintainer, with the
      failed step, the error line and a link to the run. With TEST=true it uses a
      separate alert-test issue. Exits 1 if the issue cannot be written, so the
      job goes red rather than failing silently.
  refresh_alert.py resolve STATS_GENERATED SATS_GENERATED
      refresh.yml, after a successful deploy: wait until starsobservatory.org
      serves the new snapshot, then close the open refresh-failure issue. Exits 1
      if the site still serves an older snapshot after 15 minutes.
  refresh_alert.py summary RUN_ID
      print the failed step and error line of a run (for local use).

Environment: GITHUB_REPOSITORY and GH_TOKEN (or GITHUB_TOKEN); RUN_URL for the
link in the closing note.
"""
import json, os, re, sys, time, urllib.error, urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "hallamburnapp-cloud/stars-observatory")
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
SERVER = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
MAINTAINER = "hallamburnapp-cloud"
TITLE = "Daily refresh failed - live site is serving an old data snapshot"
TEST_TITLE = "Alert test - deliberate refresh failure"
LIVE_STATS = "https://starsobservatory.org/data/stats.json"
UA = "stars-observatory-refresh-alert"


# ---------- reading a failed run ----------

TIMESTAMP = re.compile(r"^\ufeff?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
GENERIC = re.compile(r"^##\[error\]Process completed with exit code \d+\.?$")
ERRORISH = re.compile(r"error|fail|fatal|traceback|exception|denied|refused|not supported|does not support|"
                      r"timed out|cannot|could not", re.I)
MAX_LEN = 300


def clean(line):
    return ANSI.sub("", TIMESTAMP.sub("", line)).rstrip()


def shorten(text, n=MAX_LEN):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def failed_section(log):
    """Output lines of the last step that ran before the job's clean-up: the step that failed.

    A step's log starts with '##[group]Run …', echoes its command and environment,
    and closes that group with '##[endgroup]'; its output follows.
    """
    lines = [clean(l) for l in log.splitlines()]
    end = next((i for i, l in enumerate(lines) if l.startswith("Post job cleanup.")), len(lines))
    start = max((i for i, l in enumerate(lines[:end]) if l.startswith("##[group]Run ")), default=None)
    if start is None:
        return lines[:end]
    close = next((i for i in range(start, end) if lines[i].startswith("##[endgroup]")), start)
    return lines[close + 1:end]


def error_line(log):
    """The most telling line of a failed step's output, or '' if it has none."""
    out = [l for l in failed_section(log) if l.strip()]
    for l in out:  # pipeline/refresh.py halts with one 'HALT: …' line
        if l.startswith("HALT:"):
            return shorten(l)
    if "QA GATE FAILED:" in out:  # tests/run_qa.mjs lists the failed checks after this line
        i = out.index("QA GATE FAILED:")
        checks = [l.strip()[2:] for l in out[i + 1:] if l.strip().startswith("- ")]
        if checks:
            more = f" (and {len(checks) - 1} more)" if len(checks) > 1 else ""
            return shorten(f"QA gate failed: {checks[0]}", MAX_LEN - len(more)) + more
    for l in reversed(out):
        if ERRORISH.search(l) and not GENERIC.match(l) and not l.startswith("##[group]"):
            return shorten(l.removeprefix("##[error]"))
    rest = [l for l in out if not GENERIC.match(l) and not l.startswith("##[")]
    if rest:
        return shorten(rest[-1])
    generic = [l for l in out if GENERIC.match(l)]
    return shorten(generic[-1].removeprefix("##[error]")) if generic else ""


def failed_steps(jobs):
    """[(job name, failed step name, job id)] for the jobs of a run that did not succeed."""
    bad = ("failure", "timed_out", "cancelled")
    out = []
    for j in jobs:
        if j.get("conclusion") not in bad:
            continue
        steps = [s.get("name", "") for s in j.get("steps") or [] if s.get("conclusion") in bad]
        out.append((j.get("name", "?"), steps[0] if steps else "", j.get("id")))
    return out


# ---------- GitHub and the live site ----------

def http(url, data=None, method=None, auth=True, accept="application/vnd.github+json", tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Accept": accept, "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28"})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if auth and TOKEN:
            # Not passed on when GitHub redirects a log download to its storage host.
            req.add_unredirected_header("Authorization", f"Bearer {TOKEN}")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        if i + 1 < tries:
            time.sleep(10 * (i + 1))
    raise last


def api(path, payload=None, method=None):
    data = None if payload is None else json.dumps(payload).encode()
    body = http(f"https://api.github.com/{path}", data, method)
    return json.loads(body) if body else None


def run_jobs(run_id):
    jobs, page = [], 1
    while True:
        batch = api(f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100&page={page}")["jobs"]
        jobs += batch
        if len(batch) < 100:
            return jobs
        page += 1


def job_log(job_id, tries=6):
    """A finished job's log. GitHub can take a few seconds to make it available."""
    for i in range(tries):
        try:
            text = http(f"https://api.github.com/repos/{REPO}/actions/jobs/{job_id}/logs", accept="*/*").decode("utf-8", "replace")
            if text.strip():
                return text
        except urllib.error.HTTPError as e:
            if e.code not in (404, 410):
                raise
        time.sleep(10)
    return ""


def failures(run_id):
    """[(job, step, error line)] for a finished run. Never raises: the alert must go out regardless."""
    try:
        found = failed_steps(run_jobs(run_id))
    except Exception as e:
        print(f"could not list the run's jobs: {e}", file=sys.stderr)
        return [("?", "", "")]
    out = []
    for job, step, job_id in found:
        try:
            err = error_line(job_log(job_id))
        except Exception as e:
            print(f"could not read the log of job {job_id}: {e}", file=sys.stderr)
            err = ""
        out.append((job, step, err))
    return out or [("?", "", "")]


def summary_line(fails):
    return "; ".join(f"{job} › {step or 'step not reported'}: {err or 'no error line found in the log'}"
                     for job, step, err in fails)


def live_generated():
    """The 'generated' stamp of the stats.json starsobservatory.org serves now, or None."""
    try:
        body = http(f"{LIVE_STATS}?alert={int(time.time())}", auth=False, accept="application/json", tries=2)
        return json.loads(body).get("generated")
    except Exception:
        return None


def open_issue(title):
    issues = api(f"repos/{REPO}/issues?state=open&per_page=100")
    return next((i for i in issues if i.get("title") == title and "pull_request" not in i), None)


def workflow_escape(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


# ---------- the three jobs ----------

def compose(run, fails, live, test=False):
    url = run.get("html_url") or f"{SERVER}/{REPO}/actions/runs/{run.get('id')}"
    started = (run.get("run_started_at") or run.get("created_at") or "")[:16].replace("T", " ")
    if test:
        lead = (f"@{MAINTAINER} Alert test: this run failed on purpose, as requested. It downloaded, committed and "
                f"deployed nothing, and the live site is unchanged. If this notification reached you, alerting works; "
                f"close this issue.")
    else:
        now = f" (the snapshot fetched {live[:10]} {live[11:16]} UTC)" if live else ""
        lead = (f"@{MAINTAINER} The daily data refresh failed, so starsobservatory.org still serves its previous "
                f"snapshot{now}.")
    lines = [lead, "", f"- **Run:** {url} (run #{run.get('run_number', '?')}, started {started} UTC)"]
    for job, step, err in fails:
        lines.append(f"- **Failed step:** {job} › {step or 'not reported'}")
        lines.append(f"- **Error:** `{err.replace('`', chr(39))}`" if err else "- **Error:** no error line found in the log; open the run.")
    if not test:
        lines += ["", "A failed download leaves no ledger commit, so the hourly scheduler tries again, up to six "
                      "fetch runs a day. A run that failed after the download has committed the day's ledger and is "
                      "not retried: fix the cause, then re-run the failed jobs. This issue closes itself once a "
                      "fresh snapshot is live."]
    return "\n".join(lines)


def alert(run_id, test):
    run = api(f"repos/{REPO}/actions/runs/{run_id}")
    fails = failures(run_id)
    print("Failed:", summary_line(fails))
    body = compose(run, fails, None if test else live_generated(), test)
    title = TEST_TITLE if test else TITLE
    hit = open_issue(title)
    if hit:
        api(f"repos/{REPO}/issues/{hit['number']}/comments", {"body": body}, "POST")
        print(f"Commented on issue #{hit['number']}, mentioning @{MAINTAINER}: {hit['html_url']}")
    else:
        new = api(f"repos/{REPO}/issues", {"title": title, "body": body}, "POST")
        print(f"Opened issue #{new['number']}, mentioning @{MAINTAINER}: {new['html_url']}")
    return 0


def follow(run_id, wait_minutes=110, poll_seconds=30):
    url = f"{SERVER}/{REPO}/actions/runs/{run_id}"
    print(f"Waiting for the refresh run {url}", flush=True)
    deadline = time.monotonic() + wait_minutes * 60
    while True:
        try:
            run = api(f"repos/{REPO}/actions/runs/{run_id}")
        except Exception as e:  # a passing API fault: keep waiting until the deadline
            print(f"could not read the run ({e}); trying again", flush=True)
            run = None
        if run and run.get("status") == "completed":
            break
        if time.monotonic() > deadline:
            text = f"The refresh run {url} had not finished after {wait_minutes} minutes."
            print(f"::error title=Refresh run unfinished::{workflow_escape(text)}")
            return 1
        time.sleep(poll_seconds)
    if run.get("conclusion") == "success":
        print(f"The refresh run succeeded: {url}")
        return 0
    text = f"The refresh run ended in '{run.get('conclusion')}'. {summary_line(failures(run_id))}. Run: {url}"
    print(f"::error title=Daily refresh failed::{workflow_escape(text)}")
    return 1


def resolve(stats_generated, sats_generated, wait_minutes=15, poll_seconds=30):
    deadline = time.monotonic() + wait_minutes * 60
    while (live := live_generated()) != stats_generated:
        if time.monotonic() > deadline:
            text = (f"The deploy succeeded, but after {wait_minutes} minutes starsobservatory.org still serves the "
                    f"snapshot generated {live or 'at an unreadable time'}, not {stats_generated}. "
                    f"The refresh-failure issue stays open.")
            print(f"::error title=New snapshot not live::{workflow_escape(text)}")
            return 1
        time.sleep(poll_seconds)
    print(f"starsobservatory.org serves the new snapshot (generated {stats_generated}).")
    hit = open_issue(TITLE)
    if not hit:
        print("No open refresh-failure issue.")
        return 0
    note = (f"Resolved: the daily refresh succeeded, and starsobservatory.org now serves the snapshot of "
            f"{sats_generated[:10]}, fetched at {sats_generated[11:16]} UTC. Run: {os.environ.get('RUN_URL', '')}").strip()
    api(f"repos/{REPO}/issues/{hit['number']}/comments", {"body": note}, "POST")
    api(f"repos/{REPO}/issues/{hit['number']}", {"state": "closed", "state_reason": "completed"}, "PATCH")
    print(f"Closed issue #{hit['number']}.")
    return 0


def main(argv):
    if len(argv) >= 2 and argv[0] in ("follow", "alert", "summary"):
        run_id = argv[1]
        if argv[0] == "follow":
            return follow(run_id)
        if argv[0] == "alert":
            return alert(run_id, os.environ.get("TEST", "").lower() == "true")
        print(summary_line(failures(run_id)))
        return 0
    if len(argv) == 3 and argv[0] == "resolve":
        return resolve(argv[1], argv[2])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
