# Container Image Build Pipeline — Design Spec (Sub-project O)

Date: 2026-08-20
Sub-project: O
Status: active

## Problem

CI builds and tests Go binaries but does not build, push, or sign container
images. There is no SBOM. Images cannot be deployed without manual `docker build`.

## Approach

Add a `build-images` CI job that runs after the existing `test` job passes. It
builds all 11 service images, pushes them to the container registry, signs them
with `cosign`, and generates a Syft SBOM per image.

For PRs: build but do not push (dry-run to verify the Dockerfiles still work).
For merges to `master`: build, push, sign, and generate SBOMs.

## CI workflow addition (`.github/workflows/ci.yml`)

```yaml
build-images:
  needs: [test]
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
    id-token: write    # needed for cosign keyless signing

  strategy:
    matrix:
      service: [gateway, identity, tenant, user, question-bank, assessment,
                submission, judge, seb, notification, analytics]

  steps:
    - uses: actions/checkout@v4

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Login to registry
      if: github.ref == 'refs/heads/master'
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build (and push on master)
      id: build
      uses: docker/build-push-action@v6
      with:
        context: .
        file: services/${{ matrix.service }}/Dockerfile
        push: ${{ github.ref == 'refs/heads/master' }}
        tags: |
          ghcr.io/${{ github.repository }}/${{ matrix.service }}:latest
          ghcr.io/${{ github.repository }}/${{ matrix.service }}:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

    - name: Install cosign
      if: github.ref == 'refs/heads/master'
      uses: sigstore/cosign-installer@v3

    - name: Sign image
      if: github.ref == 'refs/heads/master'
      run: |
        cosign sign --yes \
          ghcr.io/${{ github.repository }}/${{ matrix.service }}@${{ steps.build.outputs.digest }}

    - name: Generate SBOM
      if: github.ref == 'refs/heads/master'
      uses: anchore/sbom-action@v0
      with:
        image: ghcr.io/${{ github.repository }}/${{ matrix.service }}@${{ steps.build.outputs.digest }}
        format: spdx-json
        output-file: sbom-${{ matrix.service }}.spdx.json

    - name: Attach SBOM to image
      if: github.ref == 'refs/heads/master'
      run: |
        cosign attach sbom \
          --sbom sbom-${{ matrix.service }}.spdx.json \
          ghcr.io/${{ github.repository }}/${{ matrix.service }}@${{ steps.build.outputs.digest }}
```

## Helm values update

Update the 11 `values-<svc>.yaml` files to reference the GHCR registry:
```yaml
image:
  repository: ghcr.io/<org>/<repo>/<service>
  tag: ""    # injected at deploy time: --set image.tag=sha256:...
```

## Definition of done

- CI builds all 11 images on every PR without pushing.
- Merges to `master` push, sign, and generate SBOMs.
- `helm lint` and `helm template` still pass with the updated registry references.
- `deploy/helm/README.md` documents how to deploy with the signed image digests.
