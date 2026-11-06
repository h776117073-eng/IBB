# Ibb Google Search Review Pack

## Purpose
Build one direct Google Search link and one Google Maps search link for every source row in data/index.json and its 23 name chunks. Preserve original row order and duplicates. This process does not use the 9,000-row enriched CSV and does not import or modify IBB production data.

## No API and no automated Google queries
The script does not send requests to Google. Google's published Search spam policy states that automated queries and scraping Google Search results without express permission violate its policies and Terms of Service. The pack therefore contains links that a human reviewer opens interactively. It does not download result pages and does not claim any result is verified.

## Run
1. Open GitHub Actions > Ibb Google Search review pack.
2. Choose Run workflow and set page size (default 250).
3. Download the ibb-google-search-review-pack artifact.
4. Extract the ZIP and open index.html.
5. Open each Google Search link, compare it with the source name and the Ibb locality, set a review status, and add notes.
6. Export each page's review results as CSV from that page.

## Output
- google_search_review_all.csv: one row for every source record, with query and Google Search/Maps URLs.
- index.html and page-*.html: paginated browser-based review dashboard.
- summary.json: source count, distinct names, duplicates, page counts, and explicit statement that zero Google queries were automatically run.

Review states are: not reviewed, match, mismatch, no suitable result, needs further review. A name appearing in search does not prove a specific branch or address. Do not change a source record unless the result clearly refers to the same Ibb establishment and independent evidence is recorded.

## Source
The repository index declares 11,060 names across 23 JSON chunks. The workflow validates the loaded count against data/index.json before generating the pack.

Policy reference: https://developers.google.com/search/docs/essentials/spam-policies
