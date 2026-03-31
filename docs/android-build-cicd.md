# Android CI/CD with GitHub Actions and EAS Build

This repository includes two manually triggered GitHub Actions workflows for Android builds:

- `Build Android APK`: generates a directly installable `.apk` for internal testing.
- `Build Android AAB`: generates a `.aab` for store-oriented release workflows.
- Both workflows also upload the final binary to Google Cloud Storage and generate a signed download URL.
- Google Cloud authentication is configured with Workload Identity Federation instead of a long-lived service account key.

## Files added

- `.github/workflows/build-android-apk.yml`
- `.github/workflows/build-android-aab.yml`
- `eas.json`
- `app.config.js`

## Prerequisites

Before these workflows can succeed in CI, finish the Expo / EAS bootstrap locally at least once.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Log in to Expo / EAS:

   ```bash
   npx eas-cli@latest login
   ```

3. Initialize or link the project on EAS and complete one successful Android build locally:

   ```bash
   npx eas-cli@latest build --platform android --profile preview-apk
   ```

This first successful local build is important because EAS needs to complete the non-interactive setup ahead of CI:

- Create or link the EAS project
- Provision Android signing credentials
- Confirm the build profiles work with the current app config

## Required GitHub Actions secrets

Configure these repository secrets in GitHub:

- `EXPO_TOKEN`
- `EXPO_PROJECT_ID`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`
- `EXPO_PUBLIC_DEBUG_LOGS` (optional)

`EXPO_PROJECT_ID` is read by `app.config.js` and injected into Expo config at build time. This keeps the repository free of a hard-coded EAS project ID while still allowing CI builds to resolve the project in non-interactive mode.

## Required GitHub Actions variables

Configure these repository variables in GitHub:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID` (recommended)
- `GCS_BUCKET`
- `GCS_PREFIX` (optional, defaults to `mobile-builds`)
- `GCS_SIGNED_URL_DURATION` (optional, defaults to `12h`)

Example object paths:

- `gs://my-build-bucket/mobile-builds/android/apk/1.0.0/vendor-map-app-1.0.0-main-abc1234-20260331T040000Z.apk`
- `gs://my-build-bucket/mobile-builds/android/aab/1.0.0/vendor-map-app-1.0.0-main-abc1234-20260331T040000Z.aab`

## Required EAS configuration

GitHub secrets alone are not enough for remote Expo builds.

Because EAS Build runs on Expo's infrastructure, the `EXPO_PUBLIC_*` variables used by the app should also be defined in the EAS project environment:

- `preview` environment for `preview-apk`
- `production` environment for `production-aab`

Recommended setup:

- Keep `EXPO_TOKEN` and `EXPO_PROJECT_ID` in GitHub Secrets
- Mirror the `EXPO_PUBLIC_*` values in both GitHub Secrets and EAS environments
- Keep Android signing credentials managed by EAS
- Use Workload Identity Federation for GCS upload access instead of storing a JSON key in GitHub

## Required Google Cloud permissions

The Google Cloud service account referenced by `GCP_SERVICE_ACCOUNT` should have permission to upload objects into the target bucket and generate signed URLs for the uploaded objects.

At minimum, grant bucket-level access equivalent to:

- `Storage Object Admin` on the target bucket

For Workload Identity Federation, also allow the GitHub repository to impersonate the service account:

- Grant `roles/iam.workloadIdentityUser` on the service account to the GitHub principal set for `slighter12/vendor-map-app`

Recommended Google Cloud setup commands:

```bash
export PROJECT_ID="your-gcp-project-id"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export GITHUB_ORG="slighter12"
export REPO="slighter12/vendor-map-app"
export POOL_ID="github"
export PROVIDER_ID="vendor-map-app"
export SERVICE_ACCOUNT_ID="github-actions-vendor-map-app"
export SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" \
  --project="$PROJECT_ID"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="vendor-map-app provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == '${GITHUB_ORG}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

WORKLOAD_IDENTITY_POOL_NAME="$(gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --format='value(name)')"

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL_NAME}/attribute.repository/${REPO}"

gcloud storage buckets add-iam-policy-binding "gs://YOUR_GCS_BUCKET" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectAdmin"

gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --format='value(name)'
```

Use the last command output as `GCP_WORKLOAD_IDENTITY_PROVIDER`, and set `GCP_SERVICE_ACCOUNT` to the service account email.

The workflow authenticates via GitHub OIDC, impersonates the service account through Workload Identity Federation, uploads the binary, and then signs a time-limited download URL using the same short-lived credentials.

If you need to create environment variables on EAS, use either the Expo dashboard or EAS CLI. Example:

```bash
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_BASE_URL --value https://api.example.com --environment preview --visibility plaintext
```

## Workflow behavior

Both workflows:

- are triggered manually with `workflow_dispatch`
- accept an optional `ref` input
- install dependencies with `npm ci`
- authenticate using `expo/expo-github-action`
- authenticate to Google Cloud with `google-github-actions/auth` using Workload Identity Federation
- fail early when required GitHub secrets are missing
- run `eas build --platform android --non-interactive --wait --json`
- download the resulting EAS artifact
- upload it to Google Cloud Storage
- generate a signed GCS download URL
- keep a copy as a GitHub Actions artifact
- write the build profile, commit SHA, app version, EAS build URL, GCS object path, and signed URL into the job summary

## Running the workflows

From GitHub:

1. Open the `Actions` tab.
2. Choose either `Build Android APK` or `Build Android AAB`.
3. Click `Run workflow`.
4. Optionally provide a branch, tag, or commit in `ref`.
5. Open the job summary to copy the signed GCS download URL.
6. Or download the backup copy from the GitHub Actions artifact section.

## Notes and limitations

- `APK` is intended for direct installation on Android devices.
- `AAB` is not a directly installable file and is meant for Play Store or store-adjacent distribution workflows.
- iOS is intentionally not wired into CI yet because Apple credentials and signing repair paths are not configured in this repository.
- If CI fails with credential-related EAS errors, repair or re-create Android credentials locally first and rerun the workflow.
- If GCS authentication fails, verify the Workload Identity Provider path, service account email, IAM bindings, and that GitHub Actions has `id-token: write`.
- Google notes that Workload Identity Pool / Provider / IAM changes can take up to about 5 minutes to propagate. If setup is fresh, wait and rerun once before troubleshooting deeper.
- With Workload Identity Federation, `gcloud storage sign-url` uses service account-based signing without a private key file, so practical signed URL duration is capped at 12 hours. Use a shorter duration or switch distribution strategy if you need longer-lived links.

## References

- [Trigger builds from CI](https://docs.expo.dev/build/building-on-ci/)
- [Configure EAS Build with eas.json](https://docs.expo.dev/build/eas-json/)
- [Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/)
- [google-github-actions/auth](https://github.com/google-github-actions/auth)
- [google-github-actions/setup-gcloud](https://github.com/google-github-actions/setup-gcloud)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [Cloud Storage signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls)
- [gcloud storage sign-url](https://cloud.google.com/sdk/gcloud/reference/storage/sign-url)
