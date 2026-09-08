# AWS demo deployment

Prepared for profile `pennyahead`, `us-east-1`. No resources are created by validation or by local tests. The template starts the **mock assistant and local simulated transfers**. OpenAI, Bedrock, Plaid and Dwolla are not activated by deployment.

## Concrete infrastructure

- One Linux `t3.small` EC2 instance, standard CPU credits (no surplus CPU-credit charges).
- Encrypted 24 GiB gp3 root volume. SQLite lives in `/var/lib/pennyahead` outside the container, surviving application/container restarts. Deleting/replacing the instance deletes this demo data; it is not a production backup arrangement.
- CloudFront HTTPS using its provided domain. No response caching, and all viewer headers forwarded so bearer sessions stay isolated. CloudFront connects over HTTP to the origin within AWS; this demo contains only synthetic data.
- Origin port 80 accepts AWS's CloudFront prefix list only. An additional random origin token rejects requests through other distributions. No SSH. Systems Manager handles operator access through an instance role limited to SSM; account credentials are never copied into the application.
- Builds one exact public GitHub commit using the committed Dockerfile and npm lockfile. A 3 GiB swap file accommodates the build on the small host.

Expected baseline is about **$21/month** before tax: EC2 ~$15.18, 24 GiB EBS ~$1.92, public IPv4 ~$3.65 (730-hour month). Allow **$25/month** for a low-traffic demo; traffic and other account usage can increase the bill. This is an estimate, not an AWS Budget or hard cap. Model calls would be additional and remain disabled. Prices and account free-tier/credits should be checked before creation: [EC2](https://aws.amazon.com/ec2/instance-types/t3/), [EBS](https://aws.amazon.com/ebs/pricing/), [IPv4](https://aws.amazon.com/vpc/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/faqs/).

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

## Teardown

Deleting the `pennyahead-demo` CloudFormation stack removes the distribution, instance, storage and IAM resources; the synthetic ledger is deleted. Verify stack deletion and the absence of its resources afterwards. Do not delete during judging if the public demo is the submitted access method. No scheduled teardown is installed by this repository.

## Verification recorded

CloudFormation template validation passed against the configured AWS account. The managed CloudFront cache/request policy IDs and default public subnet were verified through AWS APIs. Local production HTTP checks returned 403 for absent/wrong origin tokens and 200 for the correct token. Docker was unavailable locally; the public CI container job successfully built the image and verified HTTP health on commit d4f7f38. Neither template validation nor a local HTTP check proves an AWS deployment is serving traffic.
