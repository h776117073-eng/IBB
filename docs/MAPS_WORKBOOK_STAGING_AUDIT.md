# Google Maps workbook staging audit

The source workbook contains 7,015 rows in the normalized candidate sheet and 16,441 rows in the raw sheet. Only the normalized sheet is eligible for staging. The raw sheet is excluded.

All staged candidates remain `UNVERIFIED` and `NEEDS_REVIEW`; no record is published or promoted to `VERIFIED_MATCH` by this process. 2,035 coordinates outside the approximate Ibb city bounding box are quarantined from public map coordinates pending review. Direct Google Maps URLs are absent in the source workbook.

See the staging manifest and converter for reproducible details. This audit is not evidence that every row has been independently checked against a live Google Maps listing.