# v13.5.1 SDWIS sync repair

- Repaired EPA bulk-SDWIS discovery after the ECHO summary page stopped exposing a static ZIP anchor.
- Uses EPA's official `SDWA_latest_downloads.zip` download path and also inspects the official ECHO download directory.
- Streams the roughly 500 MB archive to disk instead of holding the whole archive in memory.
- Prints download progress every 25 MiB and a separate parsing message.
- Falls back to ECHO SDWIS system summaries if the bulk archive fails, preventing a zero-system SDWIS cache.
- Corrected the Casselberry official CCR/utility source from the removed `/171/Water-Wastewater` page to `/176/Utilities`.
- Added Python regression tests for SDWA URL discovery and the Casselberry source registry.
