-- +goose Up
UPDATE routes
SET hold_roles = NULL
WHERE hold_roles IS NOT NULL
  AND CASE
      WHEN jsonb_typeof(hold_roles) <> 'object' THEN true
      ELSE EXISTS (
          SELECT 1
          FROM jsonb_each(hold_roles) AS role(key, value)
          WHERE CASE
              WHEN jsonb_typeof(role.value) <> 'array' THEN true
              ELSE EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(role.value) AS hold(value)
                  WHERE jsonb_typeof(hold.value) <> 'string'
                     OR hold.value #>> '{}' !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}|[{}][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[{}]|urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
              )
          END
      )
  END;

-- +goose Down
-- Data cleanup is intentionally not reversed.
SELECT 1;
