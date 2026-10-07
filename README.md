# Budget ledger

A small web app for tracking income, expenses and monthly budgets, served by GitHub Pages.

## Pages

- `index.html` is Home: add entries, set categories and budgets, import and export.
- `dashboard.html` is the Dashboard: month-by-month charts and budget comparisons, with a tab for each person on the ledger.

## Files

- `assets/shell.js` is the shared header, menu, sign-in and sign-out. Every page loads it.
- `assets/ledger.js` and `assets/dashboard.js` are the code for each page.
- `assets/app.css` is the one stylesheet.
- `assets/supabase.js` is the Supabase client library, vendored unmodified.
- `supabase/schema.sql` documents the database tables and access rules.

## Data

Sign-in and data are handled by Supabase. Each account can change only its own budget. People on the ledger's member list can view each other's budgets on the Dashboard. No budget data is stored in this repository.

## Publishing

The site is served from the `gh-pages` branch. Keep `main` and `gh-pages` on the same commit.
When a script or stylesheet changes, bump the `?v=` number on its link in both HTML pages so browsers pick up the new file.
