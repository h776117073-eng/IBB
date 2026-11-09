-- Idempotent correction of Google Maps source-category classifications.
-- Scope: gosom.csv only. This does NOT change is_public, verification_status,
-- visibility_status, coordinates, Place IDs, source hashes, or source records.
-- Apply only after reviewing the category mapping and the D1 preflight counts.

WITH known_business_categories AS (
  SELECT DISTINCT source_category
  FROM directory_places
  WHERE source_file = 'gosom.csv'
    AND kind = 'BUSINESS'
    AND is_commercial = 1
    AND source_category NOT IN (
      'Bus stop', 'College', 'Dental school', 'English language school',
      'Government office', 'Hospital', 'Library', 'Medical clinic',
      'Non-governmental organization', 'Private hospital', 'Private university',
      'Public library', 'Public university', 'University', 'University library',
      'Botanical garden', 'Bridge', 'City park', 'Country park', 'Garden',
      'Historical landmark', 'Holiday park', 'Museum', 'Park', 'Place of worship',
      'State park', 'Theme park', 'Tourist attraction', 'Apartment building'
    )
),
classified AS (
  SELECT
    id,
    kind,
    is_commercial,
    CASE
      WHEN source_category IN (
        'Bus stop', 'College', 'Dental school', 'English language school',
        'Government office', 'Hospital', 'Library', 'Medical clinic',
        'Non-governmental organization', 'Private hospital', 'Private university',
        'Public library', 'Public university', 'University', 'University library'
      ) THEN 'PUBLIC_SERVICE'
      WHEN source_category IN (
        'Botanical garden', 'Bridge', 'City park', 'Country park', 'Garden',
        'Historical landmark', 'Holiday park', 'Museum', 'Park', 'Place of worship',
        'State park', 'Theme park', 'Tourist attraction'
      ) THEN 'LANDMARK'
      WHEN source_category = 'Apartment building' THEN 'OTHER'
      WHEN source_category IN (
        'Bank', 'Coffee store', 'Coffee wholesaler', 'Furniture accessories',
        'Market', 'Hotel', 'Store', 'Supermarket', 'Travel agency',
        'Structural engineer', 'Radio broadcaster'
      ) OR source_category IN (SELECT source_category FROM known_business_categories)
        THEN 'BUSINESS'
      ELSE kind
    END AS target_kind
  FROM directory_places
  WHERE source_file = 'gosom.csv'
)
UPDATE directory_places
SET
  kind = (SELECT target_kind FROM classified WHERE classified.id = directory_places.id),
  is_commercial = CASE
    WHEN (SELECT target_kind FROM classified WHERE classified.id = directory_places.id) = 'BUSINESS'
      THEN 1
    ELSE 0
  END
WHERE source_file = 'gosom.csv'
  AND id IN (
    SELECT id
    FROM classified
    WHERE kind <> target_kind
       OR is_commercial <> CASE WHEN target_kind = 'BUSINESS' THEN 1 ELSE 0 END
  );
