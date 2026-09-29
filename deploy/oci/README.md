# $0 hosting migration draft for ismywaterok.com

Target: one Oracle Cloud **Always Free** Ampere A1 VM, 2 OCPUs, 12 GB RAM, 50 GB boot disk plus a 150 GB block volume mounted at `/srv/water-data` in the tenancy's home region. Keep the account on Always Free; a trial resource or Pay As You Go upgrade does not satisfy the $0 requirement. Capacity and VM availability must be checked in the chosen region. Oracle may reclaim idle free VMs.

The existing Node app, PostgreSQL, Python warehouse, and S3-compatible archive run as five containers. PostgreSQL, MinIO, and warehouse files persist on the attached volume. Only ports 80 and 443 are published. Firewall ingress should allow just those ports and SSH from the operator's address. Keep database and object store ports private.

## Before deploying

1. Make a verified copy of Railway PostgreSQL with `pg_dump -Fc` and list the archive bucket's objects and total bytes. Export the bucket to independent storage. The Railway OAuth connection withholds database and bucket credentials, so this step requires the owner's Railway dashboard or another authorized export route. Keep a second copy until restoration has been tested.
2. Save the current app variables, DNS records, and Google OAuth redirect configuration. The existing domain must be pointed to the new VM only after the replacement is working.
3. Check whether the complete archive and future ingestion fit on 150 GB. The existing app's maximum archive budget is 20 GB, but the entire Railway bucket, other records, and temporary ingestion files need room too.

## Prepare the VM

Install Docker Engine and the Compose plugin on an Always Free Ubuntu ARM image. Mount the attached 150 GB block volume at `/srv/water-data`. Clone this repository on the VM, enter `deploy/oci`, copy `.env.example` to `.env`, and fill secrets and existing production variables. Restrict `.env` to the operator. Generate alphanumeric secrets so the PostgreSQL URI remains valid. Run `docker compose config --quiet` and check that it reports no errors.

Start `db` and `minio`; create the `national-water-evidence` bucket, then restore the database and all archived objects before starting `app`, `warehouse`, and `proxy`. Do not replace the Railway S3 credentials in the original project. Run `docker compose up -d --build` after restoration. Check `/healthz`, a real address search, account login, and warehouse `/status` against the copied data. Compare database row counts and object count/bytes with the saved export. Check that no household results are silently missing.

Switch DNS for both the apex and `www` names and verify HTTPS, the address lookup, and account features on the actual domain. Then cancel Railway's paid plan and remove its project only after confirming the final backup is recoverable. Railway may still issue a final invoice for usage already incurred.

This is deployment preparation, not proof of a completed migration. It cannot be run until the Always Free VM, Railway exports, and domain access are available.
