# TODO - loader/progress (Option C - job + polling)

- [x] Inspect current wizard submit flow (frontend `submitApp` calls backend `/api/apply`)
- [x] Inspect backend heavy work (`processApplicationBundle` runs after response)
- [ ] Add DB table/columns for application processing job status + progress
- [ ] Modify backend `/api/apply` to create `job_id` and return immediately with job reference
- [ ] Refactor backend processing into tracked job that updates status/progress stages in DB
- [ ] Add backend endpoint `/api/apply-status?job_id=` to return current stage/progress
- [ ] Update frontend to start polling status after submit and render a progress overlay
- [ ] Ensure final success screen uses returned `reference_number`
- [ ] Ensure failure paths stop polling and show error

