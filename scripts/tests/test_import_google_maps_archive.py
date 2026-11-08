from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import import_google_maps_archive as importer


def candidate(overrides=None):
    place_id = "ChIJAbcdefghijklmnop"
    row = {
        "id": "gmaps-" + hashlib.sha256(place_id.encode("utf-8")).hexdigest()[:24],
        "source_file": "السجل الجديد المتحقق منه عبر خرائط جوجل.xlsx",
        "source_record_id": "unique-sheet-row-1",
        "name": "صيدلية الشفاء",
        "kind": "BUSINESS",
        "operational_status": "UNKNOWN",
        "latitude": 13.975,
        "longitude": 44.178,
        "geometry_type": "POINT",
        "location_precision": "APPROXIMATE",
        "identity_status": "UNVERIFIED",
        "location_status": "APPROXIMATE",
        "verification_status": "UNVERIFIED",
        "visibility_status": "NEEDS_REVIEW",
        "is_commercial": 1,
        "is_public": 0,
        "place_id": place_id,
        "source_name": importer.EXPECTED_SOURCE,
        "source_status": importer.EXPECTED_SOURCE_STATUS,
        "source_hash": "a" * 64,
    }
    row.update(overrides or {})
    return row


class GoogleMapsArchiveImportTests(unittest.TestCase):
    def test_manifest_requires_exact_staging_source_and_excludes_raw_sheet(self):
        manifest = {
            "uniqueSheetRecords": 7015,
            "rawSheetRecordsAuditedButNotExported": 16441,
            "rawSheetRecordsImported": 0,
            "uniquePlaceIds": 7015,
            "recordsPublished": 0,
            "verificationStatus": "UNVERIFIED",
            "visibilityStatus": "NEEDS_REVIEW",
            "chunks": [f"maps-candidates-{i:03}.json" for i in range(1, 72)],
            "sourceWorkbook": "source.xlsx",
        }
        importer.validate_manifest(manifest)
        manifest["rawSheetRecordsImported"] = 1
        with self.assertRaises(ValueError):
            importer.validate_manifest(manifest)

    def test_candidate_must_be_unverified_private_and_from_allowlisted_source(self):
        self.assertEqual(importer.validate_candidate(candidate()), 1)
        for bad in (
            {"source_name": "RAW_16441"},
            {"verification_status": "VERIFIED_MATCH"},
            {"visibility_status": "PUBLISHED", "is_public": 1},
            {"is_public": 1},
            {"identity_status": "VERIFIED_MATCH"},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                importer.validate_candidate(candidate(bad))

    def test_candidate_id_is_bound_to_place_id_and_row_range(self):
        with self.assertRaises(ValueError):
            importer.validate_candidate(candidate({"id": "gmaps-" + "0" * 24}))
        with self.assertRaises(ValueError):
            importer.validate_candidate(candidate({"source_record_id": "unique-sheet-row-7016"}))

    def test_missing_coordinates_must_be_quarantined(self):
        row = candidate({
            "location_status": "MISSING",
            "location_precision": "MISSING",
            "latitude": None,
            "longitude": None,
        })
        self.assertEqual(importer.validate_candidate(row), 1)
        with self.assertRaises(ValueError):
            importer.validate_candidate({**row, "latitude": 13.975})


if __name__ == "__main__":
    unittest.main()
