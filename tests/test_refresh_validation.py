"""Unit tests for the fetch run's safety rule in pipeline/refresh.py.

A fetch run publishes a snapshot only if none of its counts is empty and each is
within 10% of the snapshot the site serves now. Run: python -m unittest discover -s tests
"""
import contextlib, io, json, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import refresh  # noqa: E402


def snapshot(objects=19470, onorbit=35082, pay=20191, matched=(9048, 1599, 586)):
    """A (sats.json, stats.json) pair shaped like the published files of 27 October 2026."""
    sats = {"generated": "2026-10-27T06:01:07.608142Z",
            "sats": [[i, "OBJECT", "1 …", "2 …", "PAY", 0] for i in range(objects)]}
    stats = {"generated": "2026-10-27T06:01:07.670934Z", "total_onorbit": onorbit,
             "by_type": {"PAY": pay, "R/B": 2299, "DEB": 12537, "UNK": 55},
             "registration_by_owner": {f"S{i}": [m, 100] for i, m in enumerate(matched)}}
    return sats, stats


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        result = fn(*args)
    return result, out.getvalue()


class CountProblems(unittest.TestCase):
    published = refresh.snapshot_counts(*snapshot())

    def problems(self, **kw):
        return quiet(refresh.count_problems, refresh.snapshot_counts(*snapshot(**kw)), self.published)[0]

    def test_counts_read_from_both_files(self):
        self.assertEqual(self.published, {
            "objects shown on the globe": 19470, "objects on orbit": 35082,
            "payloads on orbit": 20191, "payloads matched to a UN registration record": 9048 + 1599 + 586})

    def test_an_ordinary_day_passes(self):
        self.assertEqual(self.problems(objects=19500, onorbit=35130, pay=20230, matched=(9060, 1600, 590)), [])

    def test_an_empty_catalogue_fails(self):
        self.assertTrue(any(p.startswith("objects shown on the globe 0 ") for p in self.problems(objects=0)))

    def test_a_truncated_satcat_fails(self):
        self.assertEqual(len(self.problems(onorbit=17541)), 1)

    def test_a_partial_gcat_download_fails(self):
        self.assertEqual(len(self.problems(matched=(6000, 1000, 400))), 1)

    def test_a_sudden_jump_fails(self):
        self.assertEqual(len(self.problems(objects=22400)), 1)

    def test_the_limits_are_inclusive(self):
        published = {"n": 1000}
        self.assertEqual(quiet(refresh.count_problems, {"n": 1100}, published)[0], [])
        self.assertEqual(quiet(refresh.count_problems, {"n": 900}, published)[0], [])
        self.assertEqual(len(quiet(refresh.count_problems, {"n": 1101}, published)[0]), 1)
        self.assertEqual(len(quiet(refresh.count_problems, {"n": 899}, published)[0]), 1)


class CheckAgainstPublished(unittest.TestCase):
    """check_against_published() with the live site replaced by a local copy."""

    def check(self, new, published, download=None):
        """Returns (exit code, printed output): 0 if the run may go on, 1 if it halts."""
        with tempfile.TemporaryDirectory() as d:
            out, raw = Path(d, "out"), Path(d, "raw")
            out.mkdir(), raw.mkdir()
            (out / "sats.json").write_text(json.dumps(new[0]))
            (out / "stats.json").write_text(json.dumps(new[1]))

            def fake_download(url, dst):
                Path(dst).write_text(json.dumps(published[0] if url.endswith("/sats.json") else published[1]))

            with mock.patch.object(refresh, "OUT", str(out)), mock.patch.object(refresh, "RAW", str(raw)), \
                 mock.patch.object(refresh, "download", download or fake_download), \
                 contextlib.redirect_stdout(io.StringIO()) as log:
                try:
                    refresh.check_against_published()
                    code = 0
                except SystemExit as e:
                    code = e.code
            self.assertEqual(list(raw.iterdir()), [], "the copy of the published snapshot is removed")
            return code, log.getvalue()

    def test_a_consistent_snapshot_passes(self):
        code, log = self.check(snapshot(objects=19500), snapshot())
        self.assertEqual(code, 0)
        self.assertIn("validated: every count is within 10% of the published snapshot", log)

    def test_a_truncated_snapshot_halts_the_run(self):
        code, log = self.check(snapshot(objects=4000, pay=5000), snapshot())
        self.assertEqual(code, 1)
        self.assertIn("HALT: SNAPSHOT FAILED VALIDATION", log)
        self.assertIn("objects shown on the globe 4000 against 19470", log)
        self.assertIn("Nothing new was staged", log)

    def test_an_unreadable_live_site_halts_the_run(self):
        def unreachable(url, dst):
            raise OSError("connection refused")
        code, log = self.check(snapshot(), snapshot(), unreachable)
        self.assertEqual(code, 1)
        self.assertIn("HALT: COULD NOT READ THE PUBLISHED SNAPSHOT", log)


if __name__ == "__main__":
    unittest.main()
