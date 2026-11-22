"""Unit tests for backend.data_loader and building/walking distance logic."""
import unittest
from pathlib import Path
import csv
import json
import pytest
from backend.data_loader import DataStore
from backend.models import BuildingMetadata


class TestDataLoader(unittest.TestCase):
    def setUp(self):
        DataStore.load()

    def test_datastore_load_success(self):
        self.assertTrue(len(DataStore.slots) > 0)
        self.assertTrue(len(DataStore.slot_times) == 42)
        self.assertTrue(len(DataStore.walking_matrix) > 0)

    def test_frontend_slots_match_authoritative_csv(self):
        root = Path(__file__).resolve().parents[2]
        with (root / "backend" / "data" / "slots.csv").open(encoding="utf-8", newline="") as handle:
            source = list(csv.DictReader(handle))
        frontend = json.loads((root / "frontend" / "src" / "data" / "slots.json").read_text(encoding="utf-8-sig"))
        normalized = [{"slotCode": row["SlotCode"], "day": row["Day"], "timeStart": row["TimeStart"],
                       "timeEnd": row["TimeEnd"], "slotType": row["SlotType"]} for row in source]
        self.assertEqual(frontend, normalized)
        self.assertEqual(len(frontend), 42)

    def test_confirmed_physical_buildings(self):
        self.assertIn("AB01", DataStore.CONFIRMED_PHYSICAL_CODES)
        self.assertIn("AB02", DataStore.CONFIRMED_PHYSICAL_CODES)
        self.assertIn("LC", DataStore.CONFIRMED_PHYSICAL_CODES)
        self.assertIn("AR", DataStore.CONFIRMED_PHYSICAL_CODES)
        self.assertNotIn("CR", DataStore.CONFIRMED_PHYSICAL_CODES)

    def test_cr_is_non_physical_placeholder(self):
        cr_meta = DataStore.CONFIRMED_BUILDINGS.get("CR")
        self.assertIsNotNone(cr_meta)
        self.assertFalse(cr_meta.isPhysical)

    def test_walking_minutes_verified_matrix(self):
        # Intra-building movement is 0
        self.assertEqual(DataStore.get_walking_minutes("AB01", "AB01"), 0.0)
        self.assertEqual(DataStore.get_walking_minutes("AB02", "AB02"), 0.0)
        # Verified distances
        self.assertEqual(DataStore.get_walking_minutes("AB01", "AB02"), 4.0)
        self.assertEqual(DataStore.get_walking_minutes("AB02", "LC"), 5.0)

    def test_no_fabricated_cr_walking_edges(self):
        # CR must never have fabricated 0 or guessed walking minutes
        self.assertIsNone(DataStore.get_walking_minutes("AB01", "CR"))
        self.assertIsNone(DataStore.get_walking_minutes("CR", "AB01"))
        self.assertIsNone(DataStore.get_walking_minutes("CR", "CR"))

    def test_unknown_movements_return_none(self):
        self.assertIsNone(DataStore.get_walking_minutes("UNKNOWN_BLD", "AB01"))
        self.assertIsNone(DataStore.get_walking_minutes(None, "AB01"))
        self.assertIsNone(DataStore.get_walking_minutes("", ""))

    def test_cr_and_unrecognized_metadata_never_get_walking_edges(self):
        self.assertIsNone(DataStore.get_walking_minutes("CR", "AB01"))
        self.assertIsNone(DataStore.get_walking_minutes("AB01", "UNLISTED"))


def test_missing_building_csv_headers_raise_clear_error(tmp_path, monkeypatch):
    import backend.data_loader as loader
    monkeypatch.setattr(loader, "_DATA_DIR", tmp_path)
    (tmp_path / "buildings.csv").write_text("from,to,distance\nAB01,AB02,4\n", encoding="utf-8")
    with pytest.raises(ValueError, match="buildings.csv missing required headers"):
        DataStore._load_buildings()


def test_optional_walking_data_can_be_absent(tmp_path, monkeypatch):
    import backend.data_loader as loader
    monkeypatch.setattr(loader, "_DATA_DIR", tmp_path)
    DataStore._load_buildings()
    assert DataStore.get_walking_minutes("AB01", "AB01") == 0.0
    assert DataStore.get_walking_minutes("AB01", "AB02") is None


def test_unconfirmed_or_invalid_csv_walking_edges_are_ignored(tmp_path, monkeypatch):
    import backend.data_loader as loader
    monkeypatch.setattr(loader, "_DATA_DIR", tmp_path)
    (tmp_path / "buildings.csv").write_text(
        "FromBuilding,ToBuilding,WalkingMinutes\n"
        "CR,AB01,0\nUNLISTED,AB01,0\nAB01,AB02,NaN\nAB02,LC,-2\nAB01,LC,6\n",
        encoding="utf-8",
    )
    DataStore._load_buildings()
    assert DataStore.get_walking_minutes("CR", "AB01") is None
    assert DataStore.get_walking_minutes("UNLISTED", "AB01") is None
    assert DataStore.get_walking_minutes("AB01", "AB02") is None
    assert DataStore.get_walking_minutes("AB02", "LC") is None
    assert DataStore.get_walking_minutes("AB01", "LC") == 6


if __name__ == "__main__":
    unittest.main()

