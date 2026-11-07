import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from openpyxl import Workbook
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stage_google_maps_workbook as stage

class StageWorkbookTests(unittest.TestCase):
    def test_helpers(self):
        self.assertEqual(stage.clean(" غير مدرج "), "")
        self.assertEqual(stage.clean(" صيدلية  النور "), "صيدلية النور")
        self.assertAlmostEqual(stage.number("13.975"), 13.975)
        self.assertIsNone(stage.number("bad"))

    def test_export_is_unverified_and_raw_excluded(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            wb = Workbook()
            ws = wb.active
            ws.title = stage.UNIQUE_SHEET
            raw = wb.create_sheet(stage.RAW_SHEET)
            src = td / "fixture.xlsx"
            wb.save(src)
            unique_rows = [
                (5, {"الاسم الكامل (Title)":"محل إب","التصنيف بالعربية":"متجر","التصنيف الأصلي (Category)":"store","المدينة / النطاق":"إب","الشارع / الحي":"شارع","العنوان التفصيلي (Address)":"إب","كود الموقع (Plus Code)":"","رقم الهاتف (Phone)":"+967700000001","التقييم":"4.2","التقييمات":"10","خط العرض (Lat)":"13.975","خط الطول (Lon)":"44.178","معرف المكان (Place ID) والأرشيف":"ChIJAbcdefghijklm","رابط خرائط Google":""}),
                (6, {"الاسم الكامل (Title)":"محل خارج إب","التصنيف بالعربية":"متجر","التصنيف الأصلي (Category)":"store","المدينة / النطاق":"صنعاء","الشارع / الحي":"شارع","العنوان التفصيلي (Address)":"صنعاء","كود الموقع (Plus Code)":"","رقم الهاتف (Phone)":"","التقييم":"4","التقييمات":"2","خط العرض (Lat)":"15.35","خط الطول (Lon)":"44.18","معرف المكان (Place ID) والأرشيف":"ChIJZyxwvutsrqponm","رابط خرائط Google":""})
            ]
            with patch.object(stage, "read_rows", side_effect=[unique_rows, [(5, {"id": 1})]]):
                with patch.object(stage, "EXPECTED_UNIQUE_ROWS", 2), patch.object(stage, "EXPECTED_RAW_ROWS", 1):
                    out = td / "out"
                    manifest = stage.convert(src, out, 100)
            rows = json.loads((out / manifest["chunks"][0]).read_text())
            self.assertEqual(len(rows), 2)
            self.assertEqual(manifest["rawSheetRecordsImported"], 0)
            self.assertTrue(all(x["verification_status"] == "UNVERIFIED" for x in rows))
            self.assertTrue(all(x["visibility_status"] == "NEEDS_REVIEW" for x in rows))
            self.assertIsNone(rows[1]["latitude"])
            self.assertEqual(rows[1]["location_status"], "MISSING")
            self.assertEqual(rows[0]["location_status"], "APPROXIMATE")

if __name__ == "__main__":
    unittest.main()
