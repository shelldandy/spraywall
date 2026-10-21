-- +goose Up
-- Keep these presets in sync with server/internal/route/circuits.go and web/src/lib/circuitStyle.ts.
ALTER TABLE circuits
    ADD COLUMN color TEXT NOT NULL DEFAULT 'violet'
        CHECK (color IN ('violet', 'orange', 'green', 'blue', 'pink', 'teal', 'amber', 'red', 'slate', 'ink')),
    ADD COLUMN emoji TEXT NOT NULL DEFAULT '🧗'
        CHECK (emoji IN ('🔥', '💪', '🎯', '⭐', '🧗', '🪨', '🏆', '⚡', '🧠', '🦶', '🌀', '🐢'));

-- +goose Down
ALTER TABLE circuits DROP COLUMN emoji;
ALTER TABLE circuits DROP COLUMN color;
