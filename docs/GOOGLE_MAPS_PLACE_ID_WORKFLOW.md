# Ibb Google Maps Place ID indexing workflow

This workflow resolves Google Places IDs for records in the IBB source list. It deliberately requests and persists only Place IDs from Google Places API (New). It does not scrape Google Maps pages and does not copy Google place names, addresses, phones, ratings, opening hours, reviews, or coordinates into this repository.

## Why the workflow stores IDs only

Google Maps Platform policies restrict pre-fetching, exporting, scraping, indexing, storing, or redistributing Google Maps/Places content outside Google services, except for specifically permitted cases. Place IDs are explicitly exempt from the caching restrictions. This workflow therefore creates a durable mapping from each IBB source record to returned Place ID candidates, plus a Google Maps URL constructed from that ID. A candidate ID is a locator, not proof that the source record's name, address, or phone is correct.

For independent field-by-field corrections, use separately licensed or independently publishable sources (for example, OpenStreetMap under ODbL with attribution, or official business websites) and keep provenance separate. Do not use Google Places API results to overwrite the IBB dataset outside a Google Maps application unless you have a separate written licence or exception.

## First-time setup

1. In Google Cloud Console, select the project for this workflow, enable Places API (New), and ensure billing is enabled.
2. Create an API key and restrict it to Places API (New). Never place the key in code or commit it.
3. In GitHub, open Settings > Secrets and variables > Actions > New repository secret.
4. Create the secret named GOOGLE_MAPS_API_KEY and paste the API key value.
5. Open Actions > Ibb Google Maps Place ID index > Run workflow.

The workflow validates the script and source data automatically on push. Live lookup is skipped with a warning until the secret exists.

## Input selection

- source_path=auto prefers data/input/ibb_city_all_9000_establishments_enriched_verified.csv if that file is present in the repository.
- If that CSV is not present, auto uses the existing 11,060 source names referenced by data/index.json.
- To use another CSV, upload it to the repository and enter its repository-relative path in source_path.
- For CSV input, the script recognises Name_AR (or common name aliases), ID, Full_Address, Verified_Address, District, Latitude, and Longitude.

The chat-uploaded CSV is not automatically part of a GitHub repository. It must be uploaded to the repository before Actions can read it.

## Resumability

Each run processes up to 1,000 records (configurable to 2,000). The output ledger records every searched source row, even when Places returns no Place ID. The workflow runs every 15 minutes and resumes from verification/google_maps_place_ids_progress.json. It commits successful Place ID results and the cursor after each batch. A transient API failure leaves the cursor at the last completed record, so the next scheduled run retries that record.

If the source file changes, run with reset=true to avoid mixing IDs from two different source versions.

## Output

- verification/google_maps_place_ids.csv: one row per searched source record, including no-result rows, candidate count, Place IDs only, and Google Maps links built from the source name and Place ID.
- verification/google_maps_place_ids_progress.json: source fingerprint and resumable cursor.

A missing Place ID is not proof that a business does not exist. Multiple candidates require human review. Since the current repository's 11,060-record source contains names only, it has no source address, phone, or coordinates to compare. If the 9,000-row enriched CSV is uploaded to data/input/, its source address and coordinates can narrow the search; Google-derived details are still not copied or used to overwrite the CSV.

## API request and cost control

The request field mask is fixed to places.id (Text Search Essentials ID Only). The script does not request the more expensive name, address, contact, or rating fields. Check Google's current pricing, quotas, and billing requirements before increasing the batch size.
