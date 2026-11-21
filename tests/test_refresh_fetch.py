"""Unit tests for the fetch run's download retries in pipeline/refresh.py.

A source whose download fails with a server error, a dropped connection or a
cut-off transfer is tried again after 60 s and then 300 s; a refusal (4xx) is
not retried; nothing is kept from a failed attempt. The first case is the
CelesTrak failure of 21 November 2026 ("HTTP Error 500: Internal Server Error").
Run: python -m unittest discover -s tests
"""
import contextlib, http.client, io, json, sys, tempfile, unittest, urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import refresh  # noqa: E402

URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json"
GOOD = json.dumps([{"OBJECT_NAME": "CALSPHERE 1", "OBJECT_ID": "1964-063C", "NORAD_CAT_ID": 900}])
CUT_OFF = GOOD[:40]  # the start of a valid file, as CelesTrak served it on 21 November 2026


def http_error(code, msg):
    return urllib.error.HTTPError(URL, code, msg, {}, None)


class FetchOne(unittest.TestCase):
    def fetch(self, outcomes):
        """Run fetch_one against a scripted sequence of download outcomes: text to
        write, or an exception to raise. Returns (exit code, downloads, pauses,
        files left in RAW, content kept, printed output)."""
        script, calls, pauses = iter(outcomes), [], []

        def fake_download(url, dst):
            calls.append(url)
            out = next(script)
            if isinstance(out, BaseException):
                Path(dst).write_text("partial")  # a failed transfer can leave part of a file
                raise out
            Path(dst).write_text(out)

        with tempfile.TemporaryDirectory() as d, mock.patch.object(refresh, "RAW", d), \
                mock.patch.object(refresh, "download", fake_download), \
                mock.patch.object(refresh.time, "sleep", pauses.append), \
                contextlib.redirect_stdout(io.StringIO()) as log:
            try:
                refresh.fetch_one("gp_active.json", URL, "json")
                code = 0
            except SystemExit as e:
                code = e.code
            files = sorted(p.name for p in Path(d).iterdir())
            kept = (Path(d) / "gp_active.json").read_text() if "gp_active.json" in files else None
        return code, len(calls), pauses, files, kept, log.getvalue()

    def test_a_good_first_download_is_kept_without_waiting(self):
        code, n, pauses, files, kept, log = self.fetch([GOOD])
        self.assertEqual((code, n, pauses, files, kept), (0, 1, [], ["gp_active.json"], GOOD))
        self.assertIn("downloaded gp_active.json\n", log)

    def test_a_server_error_is_retried_21_november_2026(self):
        code, n, pauses, files, kept, log = self.fetch([http_error(500, "Internal Server Error"), GOOD])
        self.assertEqual((code, n, pauses, kept), (0, 2, [60], GOOD))
        self.assertIn("gp_active.json: HTTP Error 500: Internal Server Error; trying again in 60 s (attempt 2 of 3)", log)
        self.assertIn("downloaded gp_active.json (attempt 2 of 3)", log)

    def test_a_cut_off_file_is_retried(self):
        code, n, pauses, files, kept, log = self.fetch([CUT_OFF, GOOD])
        self.assertEqual((code, n, pauses, kept), (0, 2, [60], GOOD))
        self.assertIn("not json catalogue data (cut off, or an error page); trying again in 60 s", log)

    def test_dropped_connections_are_retried_with_longer_waits(self):
        code, n, pauses, files, kept, _ = self.fetch([ConnectionResetError(104, "Connection reset by peer"),
                                                     http.client.IncompleteRead(b"[{"), GOOD])
        self.assertEqual((code, n, pauses, files, kept), (0, 3, [60, 300], ["gp_active.json"], GOOD))

    def test_a_persistent_server_error_halts_after_three_attempts(self):
        code, n, pauses, files, kept, log = self.fetch([http_error(500, "Internal Server Error")] * 3)
        self.assertEqual((code, n, pauses, files), (1, 3, [60, 300], []))
        self.assertIn("HALT: DOWNLOAD FAILED gp_active.json <" + URL + ">: HTTP Error 500: Internal Server Error (attempt 3 of 3)", log)
        self.assertIn("Nothing new was staged", log)

    def test_a_persistently_cut_off_file_halts_and_nothing_is_kept(self):
        code, n, pauses, files, kept, log = self.fetch([CUT_OFF] * 3)
        self.assertEqual((code, n, pauses, files), (1, 3, [60, 300], []))
        self.assertIn("HALT: INVALID SOURCE gp_active.json", log)
        self.assertIn("(attempt 3 of 3)", log)

    def test_a_refusal_is_not_retried(self):
        code, n, pauses, files, kept, log = self.fetch([http_error(403, "Forbidden")])
        self.assertEqual((code, n, pauses, files), (1, 1, [], []))
        self.assertIn("HALT: DOWNLOAD FAILED gp_active.json <" + URL + ">: HTTP Error 403: Forbidden\n", log)

    def test_a_rate_limit_is_not_retried(self):
        code, n, pauses, _, _, _ = self.fetch([http_error(429, "Too Many Requests")])
        self.assertEqual((code, n, pauses), (1, 1, []))


if __name__ == "__main__":
    unittest.main()
