"""Unit tests for bridge.mapping. No DB. Run:

    python -m unittest data_pipeline.bridge.test_mapping
or from data-pipeline/:
    python -m unittest bridge.test_mapping
"""
import unittest

from bridge.mapping import (
    derive_stage,
    map_event_type,
    map_score,
    map_source,
    severity_for_gap,
)


class TestMapSource(unittest.TestCase):
    def test_all_known_sources(self):
        self.assertEqual(map_source("walkin"), "walkin")
        self.assertEqual(map_source("web"),    "website")
        self.assertEqual(map_source("meta"),   "facebook")
        self.assertEqual(map_source("call"),   "phone")
        self.assertEqual(map_source("oem"),    "oem")
        self.assertEqual(map_source("event"),  "event")

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            map_source("tiktok")

    def test_none_raises(self):
        with self.assertRaises(ValueError):
            map_source(None)


class TestMapScore(unittest.TestCase):
    def test_case_insensitive(self):
        self.assertEqual(map_score("Hot"),  "hot")
        self.assertEqual(map_score("WARM"), "warm")
        self.assertEqual(map_score("cold"), "cold")

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            map_score("Lukewarm")

    def test_none_raises(self):
        with self.assertRaises(ValueError):
            map_score(None)


class TestDeriveStage(unittest.TestCase):
    def test_quotation_wins(self):
        self.assertEqual(derive_stage(True, True), "quotation")
        self.assertEqual(derive_stage(True, False), "quotation")

    def test_test_drive_when_no_quotation(self):
        self.assertEqual(derive_stage(False, True), "test_drive")

    def test_new_default(self):
        self.assertEqual(derive_stage(False, False), "new")


class TestMapEventType(unittest.TestCase):
    def test_known(self):
        self.assertEqual(map_event_type("touchpoint"), "note")
        self.assertEqual(map_event_type("call"),       "call")
        self.assertEqual(map_event_type("test_drive"), "test_drive")
        self.assertEqual(map_event_type("quotation"),  "quotation")

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            map_event_type("dm")


class TestSeverityForGap(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual(severity_for_gap(0),  "low")
        self.assertEqual(severity_for_gap(4),  "low")
        self.assertEqual(severity_for_gap(5),  "medium")
        self.assertEqual(severity_for_gap(9),  "medium")
        self.assertEqual(severity_for_gap(10), "high")
        self.assertEqual(severity_for_gap(99), "high")


if __name__ == "__main__":
    unittest.main()
