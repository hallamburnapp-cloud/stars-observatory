"""Unit tests for .github/scripts/refresh_alert.py.

The log fixtures are excerpts of the real logs of the failed refresh runs of
28 October 2026 (run #99: QA gate) and 29 October 2026 (run #100: Playwright could
not install on Ubuntu 26.04). GitHub is replaced by stubs: nothing is posted.
Run: python -m unittest discover -s tests
"""
import contextlib, importlib.util, io, json, unittest, urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures"
spec = importlib.util.spec_from_file_location("refresh_alert", ROOT / ".github" / "scripts" / "refresh_alert.py")
ra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ra)

PLAYWRIGHT = "Error: ERROR: Playwright does not support chromium on ubuntu26.04-x64"


def log(*output, command="python pipeline/refresh.py --mode fetch"):
    """A job log in GitHub's format: a previous step, then the failed step's echo, env and output."""
    ts = "2026-11-01T06:00:00.0000000Z "
    lines = ["##[group]Run actions/checkout@v7", "with:", "##[endgroup]", "Syncing repository: error-free",
             f"##[group]Run {command}", f"\x1b[36;1m{command}\x1b[0m", "\x1b[36;1mecho failed && exit 1\x1b[0m",
             "shell: /usr/bin/bash -e {0}", "##[endgroup]", *output,
             "##[error]Process completed with exit code 1.", "Post job cleanup.", "fatal: cleanup noise"]
    return "\n".join(ts + l for l in lines)


class ErrorLine(unittest.TestCase):
    def test_playwright_on_ubuntu_26_04_run_100(self):
        self.assertEqual(ra.error_line((FIX / "run100_refresh.log").read_text()), PLAYWRIGHT)

    def test_qa_gate_run_99(self):
        line = ra.error_line((FIX / "run99_refresh.log").read_text())
        self.assertTrue(line.startswith("QA gate failed: desktop default view: real clicks on drawn dots open that "
                                        "object's card (15/16)"), line)
        self.assertLessEqual(len(line), ra.MAX_LEN)

    def test_pipeline_halt(self):
        self.assertEqual(ra.error_line(log("downloaded gp_active.json",
                                           "HALT: DOWNLOAD FAILED satcat.csv <https://celestrak.org/pub/satcat.csv>: HTTP Error 403: Forbidden",
                                           "Nothing new was staged; the site keeps its previous snapshot and date.")),
                         "HALT: DOWNLOAD FAILED satcat.csv <https://celestrak.org/pub/satcat.csv>: HTTP Error 403: Forbidden")

    def test_several_qa_failures_are_counted(self):
        line = ra.error_line(log("QA GATE FAILED:", " - first check — detail", " - second check", "88 checks passed, 2 failed."))
        self.assertEqual(line, "QA gate failed: first check — detail (and 1 more)")

    def test_deliberate_failure(self):
        self.assertEqual(ra.error_line(log("##[error]Deliberate failure (alert test): nothing was downloaded, committed or deployed.",
                                           command="echo test")),
                         "Deliberate failure (alert test): nothing was downloaded, committed or deployed.")

    def test_python_traceback(self):
        self.assertEqual(ra.error_line(log("Traceback (most recent call last):", '  File "x.py", line 1', "KeyError: 'generated'")),
                         "KeyError: 'generated'")

    def test_command_echo_and_earlier_steps_are_ignored(self):
        self.assertEqual(ra.error_line(log("all steps ran")), "all steps ran")

    def test_no_output_gives_the_generic_line(self):
        self.assertEqual(ra.error_line(log()), "Process completed with exit code 1.")

    def test_empty_log(self):
        self.assertEqual(ra.error_line(""), "")


class FailedSteps(unittest.TestCase):
    def test_run_100(self):
        jobs = json.loads((FIX / "run100_jobs.json").read_text())["jobs"]
        self.assertEqual(ra.failed_steps(jobs), [("refresh", "Install Playwright", 123290899420)])

    def test_a_successful_run_has_none(self):
        self.assertEqual(ra.failed_steps([{"name": "refresh", "conclusion": "success", "steps": []}]), [])


RUN = {"id": 40826575327, "html_url": "https://github.com/hallamburnapp-cloud/stars-observatory/actions/runs/40826575327",
       "run_number": 100, "run_started_at": "2026-10-29T06:00:02Z", "status": "completed", "conclusion": "failure"}


class Compose(unittest.TestCase):
    def test_failure_report(self):
        body = ra.compose(RUN, [("refresh", "Install Playwright", PLAYWRIGHT)], "2026-10-27T06:01:07.670934Z")
        self.assertTrue(body.startswith("@hallamburnapp-cloud The daily data refresh failed"))
        for part in ("(the snapshot fetched 2026-10-27 06:01 UTC)", RUN["html_url"], "run #100, started 2026-10-29 06:00 UTC",
                     "**Failed step:** refresh › Install Playwright", f"**Error:** `{PLAYWRIGHT}`",
                     "closes itself once a fresh snapshot is live"):
            self.assertIn(part, body)

    def test_alert_test_report(self):
        body = ra.compose(RUN, [("refresh", "Alert test", "Deliberate failure")], None, test=True)
        self.assertTrue(body.startswith("@hallamburnapp-cloud Alert test: this run failed on purpose"))
        self.assertNotIn("re-run the failed jobs", body)

    def test_backticks_cannot_break_the_code_span(self):
        self.assertIn("**Error:** `bad 'x' value`", ra.compose(RUN, [("refresh", "s", "bad `x` value")], None))

    def test_missing_error_line(self):
        self.assertIn("no error line found in the log", ra.compose(RUN, [("refresh", "", "")], None))


class Alert(unittest.TestCase):
    """alert() with GitHub stubbed: records every write it would make."""

    def run_alert(self, open_issues, test=False, fail_post=False):
        calls = []

        def api(path, payload=None, method=None):
            calls.append((method or "GET", path, payload))
            if method == "POST" and fail_post:
                raise urllib.error.HTTPError(path, 403, "Resource not accessible by integration", {}, None)
            if path.endswith("/actions/runs/40826575327"):
                return RUN
            if "/issues?state=open" in path:
                return open_issues
            if method == "POST" and path.endswith("/issues"):
                return {"number": 30, "html_url": "https://github.com/x/issues/30"}
            return {}

        with mock.patch.object(ra, "api", api), \
             mock.patch.object(ra, "failures", lambda run_id: [("refresh", "Install Playwright", PLAYWRIGHT)]), \
             mock.patch.object(ra, "live_generated", lambda: "2026-10-27T06:01:07.670934Z"), \
             contextlib.redirect_stdout(io.StringIO()):
            ra.alert("40826575327", test)
        return [c for c in calls if c[0] != "GET"]

    def test_opens_one_issue_when_none_is_open(self):
        writes = self.run_alert([{"title": "Something else", "number": 2}])
        self.assertEqual(len(writes), 1)
        method, path, payload = writes[0]
        self.assertEqual((method, path, payload["title"]), ("POST", f"repos/{ra.REPO}/issues", ra.TITLE))
        self.assertTrue(payload["body"].startswith("@hallamburnapp-cloud "))

    def test_comments_on_the_open_issue(self):
        writes = self.run_alert([{"title": ra.TITLE, "number": 26, "html_url": "https://github.com/x/issues/26"}])
        self.assertEqual([(m, p) for m, p, _ in writes], [("POST", f"repos/{ra.REPO}/issues/26/comments")])
        self.assertIn("@hallamburnapp-cloud", writes[0][2]["body"])

    def test_pull_requests_with_the_same_title_are_ignored(self):
        writes = self.run_alert([{"title": ra.TITLE, "number": 27, "pull_request": {}}])
        self.assertEqual(writes[0][1], f"repos/{ra.REPO}/issues")

    def test_the_alert_test_uses_its_own_issue(self):
        writes = self.run_alert([{"title": ra.TITLE, "number": 26, "html_url": "u"}], test=True)
        self.assertEqual(writes[0][2]["title"], ra.TEST_TITLE)

    def test_a_refused_write_fails_loudly(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.run_alert([], fail_post=True)


class Follow(unittest.TestCase):
    def follow(self, states, **kw):
        it = iter(states)
        with mock.patch.object(ra, "api", lambda path, *a: next(it)), mock.patch.object(ra.time, "sleep", lambda s: None), \
             mock.patch.object(ra, "failures", lambda run_id: [("refresh", "Install Playwright", PLAYWRIGHT)]), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            code = ra.follow("40826575327", **kw)
        return code, out.getvalue()

    def test_success_after_waiting(self):
        code, out = self.follow([{"status": "queued"}, {"status": "in_progress"}, {"status": "completed", "conclusion": "success"}])
        self.assertEqual(code, 0)
        self.assertIn("The refresh run succeeded", out)

    def test_failure_fails_the_scheduler_and_names_the_step(self):
        code, out = self.follow([{"status": "completed", "conclusion": "failure"}])
        self.assertEqual(code, 1)
        self.assertIn("::error title=Daily refresh failed::", out)
        self.assertIn(f"refresh › Install Playwright: {PLAYWRIGHT}", out)

    def test_a_run_that_never_finishes_fails(self):
        code, out = self.follow([{"status": "in_progress"}] * 3, wait_minutes=0)
        self.assertEqual(code, 1)
        self.assertIn("had not finished after 0 minutes", out)


class Resolve(unittest.TestCase):
    def resolve(self, live_values, open_issues, **kw):
        calls, it = [], iter(live_values)

        def api(path, payload=None, method=None):
            calls.append((method or "GET", path))
            return open_issues if "/issues?state=open" in path else {}

        with mock.patch.object(ra, "api", api), mock.patch.object(ra, "live_generated", lambda: next(it)), \
             mock.patch.object(ra.time, "sleep", lambda s: None), contextlib.redirect_stdout(io.StringIO()) as out:
            code = ra.resolve("2026-11-02T06:01:00.6Z", "2026-11-02T06:01:00.5Z", **kw)
        return code, [c for c in calls if c[0] != "GET"], out.getvalue()

    def test_closes_the_issue_once_the_new_snapshot_is_live(self):
        code, writes, _ = self.resolve(["2026-10-27T06:01:07Z", "2026-11-02T06:01:00.6Z"], [{"title": ra.TITLE, "number": 26}])
        self.assertEqual(code, 0)
        self.assertEqual(writes, [("POST", f"repos/{ra.REPO}/issues/26/comments"), ("PATCH", f"repos/{ra.REPO}/issues/26")])

    def test_nothing_to_close(self):
        code, writes, _ = self.resolve(["2026-11-02T06:01:00.6Z"], [])
        self.assertEqual((code, writes), (0, []))

    def test_keeps_the_issue_open_and_fails_if_the_site_never_updates(self):
        code, writes, out = self.resolve(["2026-10-27T06:01:07Z"] * 3, [{"title": ra.TITLE, "number": 26}], wait_minutes=0)
        self.assertEqual((code, writes), (1, []))
        self.assertIn("::error title=New snapshot not live::", out)


if __name__ == "__main__":
    unittest.main()
