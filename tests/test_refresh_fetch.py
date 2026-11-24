"""Unit tests for the fetch run's download handling in pipeline/refresh.py.

The run halts on the first failed download. Its HALT line names the file, the
address and the error, and ends with the start of the server's response when
there is one, which can give the server's reason for refusing.
Run: python -m unittest discover -s tests
"""
import contextlib, io, sys, tempfile, unittest, urllib.error
from email.message import Message
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import refresh  # noqa: E402

FNAME, URL, _ = refresh.FETCHES[0]
REFUSAL = b"Example refusal: this address has already downloaded the data since its last update."


def http_error(body, code=403, msg="Forbidden"):
    return urllib.error.HTTPError(URL, code, msg, Message(), None if body is None else io.BytesIO(body))


class RefusalReason(unittest.TestCase):
    def test_a_plain_text_response_is_quoted(self):
        self.assertEqual(refresh.refusal_reason(http_error(REFUSAL)), " — " + repr(REFUSAL.decode()))

    def test_markup_scripts_and_styles_are_removed(self):
        page = (b"<!DOCTYPE html><html><head><title>403 - Forbidden</title><style>body{margin:0}</style>"
                b"<script>var x = 1;</script></head><body><h1>Access is denied.</h1></body></html>")
        self.assertEqual(refresh.refusal_reason(http_error(page)), " — '403 - Forbidden Access is denied.'")

    def test_a_page_cut_off_inside_a_style_or_a_tag(self):
        self.assertEqual(refresh.refusal_reason(http_error(b"<p>Refused</p><style>body{margin:0")), " — 'Refused'")
        self.assertEqual(refresh.refusal_reason(http_error(b'<p>Refused</p><div class="no')), " — 'Refused'")

    def test_only_the_start_of_a_long_response_is_read_and_kept(self):
        fp = io.BytesIO(b"word " * 2000)
        error = urllib.error.HTTPError(URL, 403, "Forbidden", Message(), fp)
        reason = refresh.refusal_reason(error)
        self.assertEqual(fp.tell(), 600)
        self.assertEqual(reason, " — " + repr(("word " * 28)[:140]))

    def test_no_response_body_gives_nothing(self):
        self.assertEqual(refresh.refusal_reason(http_error(b"")), "")
        self.assertEqual(refresh.refusal_reason(http_error(b"  <br/>\n ")), "")
        self.assertEqual(refresh.refusal_reason(http_error(None)), "")

    def test_errors_without_a_response_give_nothing(self):
        self.assertEqual(refresh.refusal_reason(urllib.error.URLError("timed out")), "")
        self.assertEqual(refresh.refusal_reason(TimeoutError("The read operation timed out")), "")
        self.assertEqual(refresh.refusal_reason(OSError("connection reset")), "")


class FetchSources(unittest.TestCase):
    """fetch_sources() with every download replaced by one that fails."""

    def fetch(self, error):
        """Returns (exit code, printed output, number of downloads attempted)."""
        calls = []

        def failing_download(url, dst):
            calls.append(url)
            Path(dst).write_bytes(b"partial")
            raise error

        with tempfile.TemporaryDirectory() as d:
            raw = Path(d, "raw")
            with mock.patch.object(refresh, "RAW", str(raw)), \
                 mock.patch.object(refresh, "download", failing_download), \
                 contextlib.redirect_stdout(io.StringIO()) as log:
                with self.assertRaises(SystemExit) as stop:
                    refresh.fetch_sources()
            self.assertEqual(list(raw.iterdir()), [], "the partial download is removed")
        return stop.exception.code, log.getvalue(), len(calls)

    def test_a_refusal_halts_the_run_with_the_servers_reason(self):
        code, log, calls = self.fetch(http_error(REFUSAL))
        self.assertEqual((code, calls), (1, 1))
        self.assertIn(f"HALT: DOWNLOAD FAILED {FNAME} <{URL}>: HTTP Error 403: Forbidden — "
                      + repr(REFUSAL.decode()) + "\n", log)
        self.assertIn("Nothing new was staged", log)

    def test_a_failure_without_a_response_halts_the_run(self):
        code, log, calls = self.fetch(urllib.error.URLError("timed out"))
        self.assertEqual((code, calls), (1, 1))
        self.assertIn(f"HALT: DOWNLOAD FAILED {FNAME} <{URL}>: <urlopen error timed out>\n", log)


if __name__ == "__main__":
    unittest.main()
