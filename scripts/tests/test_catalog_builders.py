import unittest
from scripts.build_google_maps_directory import classify_kind, normalize_arabic
from scripts.build_product_catalog import barcode, arabic_category, country_relevance

class CatalogBuilderTests(unittest.TestCase):
    def test_barcode_normalization_preserves_leading_zeroes(self):
        self.assertEqual(barcode("101209159"), "0000101209159")

    def test_product_category_arabic_mapping(self):
        self.assertEqual(arabic_category("Snacks, Sweet snacks, Biscuits"), "حلويات")
        self.assertEqual(arabic_category("Beverages, Waters"), "مشروبات")
        self.assertEqual(arabic_category("undefined"), "غير مصنف")

    def test_country_relevance_is_not_local_availability(self):
        self.assertEqual(country_relevance("Yemen"), "YEMEN")
        self.assertEqual(country_relevance("Saudi Arabia"), "ARABIC_REGION")
        self.assertEqual(country_relevance("United States"), "FOREIGN")
        self.assertEqual(country_relevance(""), "UNKNOWN")

    def test_google_maps_place_classification(self):
        self.assertEqual(classify_kind("شارع تعز", "Store"), "STREET")
        self.assertEqual(classify_kind("الجامع الكبير", "Mosque"), "LANDMARK")
        self.assertEqual(classify_kind("مدرسة الثورة", "School"), "PUBLIC_SERVICE")
        self.assertEqual(classify_kind("صيدلية الشفاء", "Pharmacy"), "BUSINESS")

    def test_arabic_search_normalization(self):
        self.assertEqual(normalize_arabic("إبّ"), "اب")

if __name__ == "__main__":
    unittest.main()
