import json
import tempfile
import unittest
from pathlib import Path
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
            ws.append(["title"]); ws.append(["description"]); ws.append([None])
            headers = ["الاسم الكامل (Title)", "التصنيف بالعربية", "التصنيف الأصلي (Category)", "المدينة / النطاق", "الشارع / الحي", "العنوان التفصيلي (Address)", "كود الموقع (Plus Code)", "رقم الهاتف (Phone)", "التقييم", "التقييمات", "خط العرض (Lat)", "خط الطول (Lon)", "معرف المكان (Place ID) والأرشيف", "رابط خرائط Google"]
            ws.append(headers)
            ws.append(["محل إب","متجر","store","إب","شارع","إب","","+967700000001","4.2","10","13.975","44.178","ChIJAbcdefghijklm",""])
            ws.append(["محل خارج إب","متجر","store","صنعاء","شارع","صنعاء","","","4","2","15.35","44.18","ChIJZyxwvutsrqponm",""])
            raw = wb.create_sheet(stage.RAW_SHEET)
            raw.append(["title"]); raw.append(["description"]); raw.append([None]); raw.append(["id"]); raw.append([1])
            src = td / "fixture.xlsx"; wb.save(src)
            old_read_rows = stage.read_rows
            def fixture_rows(sheet):
                    if sheet.title == stage.RAW_SHEET: return [(5, {"id": 1})]
                    return [
                        (5, {"الاسم الكامل (Title)":"محل إب","التصنيف بالعربية":"متجر","التصنيف الأصلي (Category)":"store","المدينة / النطاق":"إب","الشارع / الحي":"شارع","العنوان التفصيلي (Address)":"إب","كود الموقع (Plus Code)":"","رقم الهاتف (Phone)":"+967700000001","التقييم":"4.2","التقييمات":"10","خط العرض (Lat)":"13.975","خط الطول (Lon)":"44.178","معرف المكان (Place ID) والأرشيف":"ChIJAbcdefghijklm","رابط خرائط Google":""}),
                        (6, {"الاسم الكامل (Title)":"محل خارج إب","التصنيف بالعربية":"متجر","التصنيف الأصلي (Category)":"store","المدينة / النطاق":"صنعاء","الشارع / الحي":"شارع","العنوان التفصيلي (Address)":"صنعاء","كود الموقع (Plus Code)":"","رقم الهاتف (Phone)":"","التقييم":"4","التقييمات":"2","خط العرض (Lat)":"15.35","خط الطول (Lon)":"44.18","معرف المكان (Place ID) والأرشيف":"ChIJZyxwvutsrqponm","رابط خرائط Google":""})
                stage.read_rows = fixture_rows
            try:
                out = td / "out"
                manifest = stage.convert(src, out, 100)
            finally:
                stage.read_rows = old_read_rows
            rows = json.loads((out / manifest["chunks"][0]).read_text())
            self.assertEqual(len(rows), 2)
            self.assertEqual(manifest["rawSheetRecordsImported"], 0)
            self.assertTrue(all(x["verification_status"] == "UNVERIFIED" for x in rows))
            self.assertTrue(all(x["visibility_status"] == "NEEDS_REVIEW" for x in rows))
            self.assertEqual(rows[1]["latitude"], None)
            self.assertEqual(rows[1]["location_status"], "MISSING")
            self.assertEqual(rows[0]["location_status"], "APPROXIMATE")

if __name__ == "__main__":
    unittest.main()
