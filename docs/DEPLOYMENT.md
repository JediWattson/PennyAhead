# AWS demo deployment

Prepared for profile `pennyahead`, `us-east-1`. No resources are created by validation, `--dry-run`, or local tests. The default deployment starts the **mock assistant and local simulated transfers**. The explicit `--assistant bedrock --runtime-env-file web/.env.local` options deploy the existing Bedrock and Sandbox integrations. OpenAI and Dwolla are not activated by this helper.

## Concrete infrastructure

- One Linux `t3.small` EC2 instance, standard CPU credits (no surplus CPU-credit charges).
- Encrypted 24 GiB gp3 root volume. SQLite lives in `/var/lib/pennyahead` outside the container, surviving application/container restarts. Deleting/replacing the instance deletes this demo data; it is not a production backup arrangement.
- CloudFront HTTPS using its provided domain or an optional custom hostname and issued ACM certificate. No response caching, and all viewer headers forwarded so bearer sessions stay isolated. CloudFront connects over HTTP to the origin within AWS; this demo contains only synthetic data.
- Origin port 80 accepts AWS's CloudFront prefix list only. An additional random origin token rejects requests through other distributions. No SSH. Systems Manager handles operator access. The instance role can retrieve only its runtime secret; Bedrock mode additionally permits invocation of the Nova 2 Lite US inference profile and its three verified regional model destinations. Personal AWS credentials are never copied into the application. IMDSv2 is required, with a hop limit of two so the SDK can obtain rotating instance-role credentials through the Docker bridge.
- One Secrets Manager secret stores the selected Sandbox runtime settings. The host reads it into a root-only environment file without printing credentials. The Docker build excludes all local `.env` and `work` files. Container logs rotate at three 10 MiB files.
- Builds one exact public GitHub commit using the committed Dockerfile and npm lockfile. A 3 GiB swap file accommodates the build on the small host.

Allow approximately **$25/month** for the low-traffic host, 24 GiB storage, public IPv4, and runtime secret. Traffic, secret API calls, model calls and other account usage can increase the bill. This is an estimate, not an AWS Budget or hard cap. Model calls are enabled only by choosing Bedrock mode. Prices and account free-tier/credits should be checked before creation: [EC2](https://aws.amazon.com/ec2/instance-types/t3/), [EBS](https://aws.amazon.com/ebs/pricing/), [IPv4](https://aws.amazon.com/vpc/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/faqs/).

## Validate, then create

```sh
aws cloudformation validate-template --profile pennyahead --region us-east-1 \
  --template-body file://deploy/aws.yml
```

After approving resource creation and pushing the reviewed commit:

```sh
python3 deploy/aws-deploy.py --commit <40-character-public-commit> \
  --invite-file web/work/private/judge-invites.json \
  --vpc vpc-09d97811e2696a182 --subnet subnet-020cbee6ceb70c9e0
```

First generate the private judge invitations as described below. The script generates the access signing secret and origin token in a private temporary parameter file and removes it after the request. It creates a stack rather than updating/replacing an existing stack. Retrieve `DemoUrl` and `InstanceId` from the `pennyahead-demo` stack outputs. Stack completion does not prove application health: the Docker build runs in EC2 user data. Confirm `/api/health`, the full approval path, isolated sessions and mobile layout over the HTTPS URL. Do not mark deployment complete before those checks pass.

To prepare the current live-assistant demo, add `--assistant bedrock --runtime-env-file web/.env.local --dry-run`. The redacted plan prints only selected key names, never values. Remove `--dry-run` only when resource creation and transferring the existing Sandbox credentials into this AWS account are authorized. The runtime whitelist includes Plaid Sandbox credentials, optional Alpaca Sandbox credentials, and sample-profile flags. It excludes local AWS profiles/keys, OpenAI keys, local database paths, and disabled-access overrides. Bedrock uses the instance role with the fixed, reviewed model and region. Run `python3 -m unittest discover -s deploy -p 'test_*.py'` to verify this boundary.

The CloudFront HTTPS hostname can be used while a custom-domain certificate awaits DNS validation. Custom hostname activation still requires an issued certificate and its final routing CNAME.

If boot fails, inspect `/var/log/cloud-init-output.log` and `docker logs pennyahead` through SSM. Never print `/etc/pennyahead.env`, EC2 user data, or container environment variables. A restart is `docker restart pennyahead`. For an application update, build the new exact commit, stop/remove only the `pennyahead` container, and run its new image with the same env file and `/var/lib/pennyahead:/data` mount. Take a SQLite backup before changing schemas.

Public live-model mode has an application guard of three concurrent requests, one request per session per three seconds, and 200 attempts per UTC day **per process**. This counter resets on server restart and is not a billing cap or production abuse protection. Add a durable shared quota before exposing paid model access at scale.

## Private judge access

The deployed app requires an invitation for all pages and data APIs. Visitors see `/unlock`; unauthorized API requests return 401 with `INVITE_REQUIRED`. Only the unlock page, access exchange, static assets and `/api/health` are public. API handlers and page rendering also verify access independently of the Next.js Proxy. Production with missing or malformed invitation settings stays locked; local development defaults to open. `PENNYAHEAD_ACCESS_MODE=disabled` is an explicit override for trusted local testing, and is never set by the AWS deployment.

Generate five independently revocable invitations before creating the stack:

```sh
python3 deploy/create-invites.py
```

This creates `web/work/private/judge-invites.json` with mode 0600 in a Git-ignored directory and refuses to overwrite it. Each entry includes a label, a 256-bit random token, its SHA-256 hash, and an HTTPS invitation URL. Change `--count`, `--base-url`, or `--output` when needed. Share one URL or token privately with each judge; keep the bundle out of source control, public submission text and screenshots. The deployment helper requires `--invite-file` and passes only hashes plus a separately generated signing secret to the host.

A link uses `/unlock#token=…`: the fragment is not sent in HTTP requests and is removed from browser history before the token is POSTed. Judges can also paste the token. Successful unlock sets a signed, host-only, HttpOnly, SameSite=Strict cookie, Secure in production, valid for seven days. Each browser keeps its own existing demo monitor and transfer capability. Invitations are reusable across devices until revoked; they are bearer access and anyone receiving a forwarded link can use it. There is no email or identity verification.

“Lock this browser” clears its access cookie. To revoke an invitation and all its existing sessions, remove its hash from `PENNYAHEAD_INVITE_HASHES` in the host's private env file and recreate the container with that env file. Preserve the remaining hashes and signing secret. To revoke every existing browser session, rotate `PENNYAHEAD_ACCESS_SECRET`; retained invitation links can then unlock again. Keep the private bundle consistent with changes so a future deployment does not restore revoked hashes. Missing/all-removed hashes fail closed. No dashboard for issuing or revoking invitations is included.

Unlock accepts same-origin JSON only and limits bodies to 1 KiB. Invalid attempts are throttled after 30 per minute per process; valid invitations still work. This is not a distributed traffic limiter or an AI spending cap. Existing assistant limits remain separate. The access gate does not enable live AI, real bank accounts or real transfers.

Verify with `npm run test:access` in `web` after a build. These production browser checks cover the locked APIs, invalid and valid invitations, mobile unlock, full demo flow, isolated browsers, cookie expiry and locking. Existing browser regressions explicitly disable the gate in their local test server.

## Cloudflare subdomain: pennyahead.famtrees.net

`famtrees.net` already uses Cloudflare nameservers. This setup uses Cloudflare DNS and the AWS host/CloudFront distribution above. The custom hostname is `pennyahead.famtrees.net`.

1. Request a non-exportable public ACM certificate for the hostname in **us-east-1**, using DNS validation. Check for an existing matching request before creating another. Standard non-exportable ACM certificates used with CloudFront have no additional certificate charge; EC2 and other hosting charges remain separate.
2. In Cloudflare's `famtrees.net` zone, add the **certificate validation CNAME** returned by ACM. Use its exact name and target, with **DNS only** (gray cloud). Keep this validation record for renewals.
3. Wait for ACM status **ISSUED**. The deploy helper verifies the certificate status, region and hostname coverage before creating the stack. Provide the domain and certificate together:

```sh
python3 deploy/aws-deploy.py --commit <40-character-public-commit> \
  --invite-file web/work/private/judge-invites.json \
  --vpc vpc-09d97811e2696a182 --subnet subnet-020cbee6ceb70c9e0 \
  --domain pennyahead.famtrees.net \
  --certificate-arn <issued-us-east-1-certificate-arn>
```

4. After the approved deployment completes, read the stack's `CloudFrontDomainName` output. Add a **second CNAME** in Cloudflare: Name `pennyahead`, Target that CloudFront hostname, Proxy **DNS only**, TTL Auto. This is the application routing record; it is distinct from the certificate-validation record.
5. Verify HTTPS at `https://pennyahead.famtrees.net/api/health` and exercise the demo through that hostname before declaring it online. CloudFront handles TLS using the selected certificate and SNI; no dedicated-IP certificate option is enabled.

The template emits `DemoUrl` for the selected custom hostname, plus `CloudFrontDomainName`, `DistributionId` and `InstanceId`. It can still deploy with the default CloudFront domain by omitting both custom-domain arguments. The default assistant is mock; explicit Bedrock mode uses the instance role and copies only the authorized Sandbox configuration into Secrets Manager. Transfers remain local simulations.

References: [Cloudflare subdomains](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/), [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html), [ACM DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html), [ACM pricing](https://aws.amazon.com/certificate-manager/pricing/).

## Teardown

Deleting the `pennyahead-demo` CloudFormation stack removes the distribution, instance, storage and IAM resources; the synthetic ledger is deleted. Verify stack deletion and the absence of its resources afterwards. Do not delete during judging if the public demo is the submitted access method. No scheduled teardown is installed by this repository.

## Verification recorded

CloudFormation template validation passed against the configured AWS account. The managed CloudFront cache/request policy IDs and default public subnet were verified through AWS APIs. Local production HTTP checks returned 403 for absent/wrong origin tokens and 200 for the correct token. Docker was unavailable locally; the public CI container job successfully built the image and verified HTTP health on commit d4f7f38. Neither template validation nor a local HTTP check proves an AWS deployment is serving traffic.

On September 11, 2026, the `pennyahead-demo` stack deployed application commit `bd9a272489a65f0bc203966aff79ecdd558933b2` to instance `i-079003420f7ae14ff` behind CloudFront distribution `E34Z6W9GIXOBY1`. The custom hostname is [pennyahead.famtrees.net](https://pennyahead.famtrees.net), using an issued ACM certificate in `us-east-1`. Both Cloudflare CNAME records were verified through public DNS. The custom-domain change set modified only CloudFront, preserving the host and existing runtime/access parameters.

Live HTTPS browser verification passed health, locked APIs, invitation unlock with a Secure cookie, explicit approval and completion of a local transfer simulation, the renamed 51-transaction Plaid Sandbox history, and two actual Bedrock responses using `get_investment_plan`. The follow-up remembered a nickname from the first message and refreshed the plan through the tool. Dark-mode layouts at 1440 and 390 pixels had no horizontal overflow or browser page errors. Local verification artifacts are `web/work/aws-deployment-verified.json`, `web/work/aws-bills-1440.png`, and `web/work/aws-growth-{1440,390}.png`; private invitations remain in the ignored `web/work/private/judge-invites.json` bundle. This deployment does not establish real bank access or real money movement.

The same day, the existing host was updated to `5a1cf72efee254b4c6e4c7c1fd3460785fea4ee0`. With Plaid Sandbox enabled, `/` now opens Plaid data after invitation unlock and on refresh. Explicit `/?scenario=growth` and other scenario links retain the synthetic demo; deployments with Plaid disabled still default to that demo. A candidate container passed health before the live switch, preserving the environment file and SQLite volume. The previous image/container remains available for rollback. Local and live browser checks passed the 51-transaction default, explicit scenario selection, provider-error fallback, mobile layout, and isolated invitation protection. The three access browser tests and both CI jobs passed. The CloudFormation creation parameter still records the initial revision; this was an in-place application update rather than an infrastructure replacement.

The savings cleanup subsequently selected a verified 47-transaction Plaid Item through Secrets Manager and a container restart, using the same application image. The 43 checking records and both account balances were preserved. Savings now contains one matching $25 transfer and three $0.67 month-end interest credits. Exact live provider data, the mobile savings display, and the $250 Roth preview were verified. The initial CloudFormation runtime parameter remains the creation-time configuration; Secrets Manager holds the current Item token. Private journals and the stopped `pennyahead-before-savings` container retain the previous configuration for recovery.
