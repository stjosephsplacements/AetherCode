ALTER TABLE exams
    ADD COLUMN allowed_networks text[] NOT NULL DEFAULT '{}',
    ADD COLUMN require_fullscreen boolean NOT NULL DEFAULT false,
    ADD COLUMN block_external_paste boolean NOT NULL DEFAULT false;
