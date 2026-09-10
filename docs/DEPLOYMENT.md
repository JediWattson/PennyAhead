# AWS demo deployment

Prepared for profile `pennyahead`, `us-east-1`. No resources are created by validation or by local tests. The template starts the **mock assistant and local simulated transfers**. OpenAI, Bedrock, Plaid and Dwolla are not activated by deployment.

## Concrete infrastructure

- One Linux `t3.small` EC2 instance, standard CPU credits (no surplus CPU-credit charges).
- Encrypted 24 GiB gp3 root volume. SQLite lives in `/var/lib/pennyahead` outside the container, surviving application/container restarts. Deleting/replacing the instance deletes this demo data; it is not a production backup arrangement.
- CloudFront HTTPS using its provided domain or an optional custom hostname and issued ACM certificate. No response caching, and all viewer headers forwarded so bearer sessions stay isolated. CloudFront connects over HTTP to the origin within AWS; this demo contains only synthetic data.
- Origin port 80 accepts AWS's CloudFront prefix list only. An additional random origin token rejects requests through other distributions. No SSH. Systems Manager handles operator access through an instance role limited to SSM; account credentials are never copied into the application.
- Builds one exact public GitHub commit using the committed Dockerfile and npm lockfile. A 3 GiB swap file accommodates the build on the small host.

Expected baseline is about **$21/month** before tax: EC2 ~$15.26, 24 GiB EBS ~$1.92, public IPv4 ~$3.65 (730-hour month). Allow **$25/month** for a low-traffic demo; traffic and other account usage can increase the bill. This is an estimate, not an AWS Budget or hard cap. Model calls would be additional and remain disabled. Prices and account free-tier/credits should be checked before creation: [EC2](https://aws.amazon.com/ec2/instance-types/t3/), [EBS](https://aws.amazon.com/ebs/pricing/), [IPv4](https://aws.amazon.com/vpc/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/faqs/).

## Validate, then create

```sh
aws cloudformation validate-template --profile pennyahead --region us-east-1 \
  --template-body file://deploy/aws.yml
```

After approving resource creation and pushing the reviewed commit:

```sh
python3 deploy/aws-deploy.py --commit <40-character-public-commit> \
  --vpc vpc-09d97811e2696a182 --subnet subnet-020cbee6ceb70c9e0
```

The script generates the origin token in a private temporary parameter file and removes it after the request. It creates a stack rather than updating/replacing an existing stack. Retrieve `DemoUrl` and `InstanceId` from the `pennyahead-demo` stack outputs. Stack completion does not prove application health: the Docker build runs in EC2 user data. Confirm `/api/health`, the full approval path, isolated sessions and mobile layout over the HTTPS URL. Do not mark deployment complete before those checks pass.

If boot fails, inspect `/var/log/cloud-init-output.log` and `docker logs pennyahead` through SSM. Never print `/etc/pennyahead.env`, EC2 user data, or container environment variables. A restart is `docker restart pennyahead`. For an application update, build the new exact commit, stop/remove only the `pennyahead` container, and run its new image with the same env file and `/var/lib/pennyahead:/data` mount. Take a SQLite backup before changing schemas.

Public live-model mode has an application guard of three concurrent requests, one request per session per three seconds, and 200 attempts per UTC day **per process**. This counter resets on server restart and is not a billing cap or production abuse protection. Add a durable shared quota before exposing paid model access at scale.

## Cloudflare subdomain: pennyahead.famtrees.net

`famtrees.net` already uses Cloudflare nameservers. This setup uses Cloudflare DNS and the AWS host/CloudFront distribution above. The custom hostname is `pennyahead.famtrees.net`.

1. Request a non-exportable public ACM certificate for the hostname in **us-east-1**, using DNS validation. Check for an existing matching request before creating another. Standard non-exportable ACM certificates used with CloudFront have no additional certificate charge; EC2 and other hosting charges remain separate.
2. In Cloudflare's `famtrees.net` zone, add the **certificate validation CNAME** returned by ACM. Use its exact name and target, with **DNS only** (gray cloud). Keep this validation record for renewals.
3. Wait for ACM status **ISSUED**. The deploy helper verifies the certificate status, region and hostname coverage before creating the stack. Provide the domain and certificate together:

```sh
python3 deploy/aws-deploy.py --commit <40-character-public-commit> \
  --vpc vpc-09d97811e2696a182 --subnet subnet-020cbee6ceb70c9e0 \
  --domain pennyahead.famtrees.net \
  --certificate-arn <issued-us-east-1-certificate-arn>
```

4. After the approved deployment completes, read the stack's `CloudFrontDomainName` output. Add a **second CNAME** in Cloudflare: Name `pennyahead`, Target that CloudFront hostname, Proxy **DNS only**, TTL Auto. This is the application routing record; it is distinct from the certificate-validation record.
5. Verify HTTPS at `https://pennyahead.famtrees.net/api/health` and exercise the demo through that hostname before declaring it online. CloudFront handles TLS using the selected certificate and SNI; no dedicated-IP certificate option is enabled.

The template emits `DemoUrl` for the selected custom hostname, plus `CloudFrontDomainName`, `DistributionId` and `InstanceId`. It can still deploy with the default CloudFront domain by omitting both custom-domain arguments. The initial public build starts the mock assistant and local simulation; private local Sandbox keys are not copied by deployment.

References: [Cloudflare subdomains](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/), [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html), [ACM DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html), [ACM pricing](https://aws.amazon.com/certificate-manager/pricing/).

## Teardown

Deleting the `pennyahead-demo` CloudFormation stack removes the distribution, instance, storage and IAM resources; the synthetic ledger is deleted. Verify stack deletion and the absence of its resources afterwards. Do not delete during judging if the public demo is the submitted access method. No scheduled teardown is installed by this repository.

## Verification recorded

CloudFormation template validation passed against the configured AWS account. The managed CloudFront cache/request policy IDs and default public subnet were verified through AWS APIs. Local production HTTP checks returned 403 for absent/wrong origin tokens and 200 for the correct token. Docker was unavailable locally; the public CI container job successfully built the image and verified HTTP health on commit d4f7f38. Neither template validation nor a local HTTP check proves an AWS deployment is serving traffic.
