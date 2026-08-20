# Container Image Build Pipeline — Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-08-20-image-pipeline-design.md`

**Goal:** Add a CI job that builds, pushes, signs, and attaches SBOMs to all 11 service images on every merge to master.

## Global Constraints
- PR builds: build only, no push (verify Dockerfiles compile)
- master merges: build + push + cosign sign + syft SBOM
- Registry: GitHub Container Registry (ghcr.io)
- Images tagged with both `:latest` and `:<git-sha>`
- No breaking changes to existing CI jobs

---

## Task 1: Add build-images job to CI

**File:** `.github/workflows/ci.yml`

**Step 1: Read the current CI file**

```bash
cat .github/workflows/ci.yml
```

Understand the current job structure so the new job fits cleanly.

**Step 2: Add the build-images job**

Append to `.github/workflows/ci.yml` after the existing jobs:

```yaml
  build-images:
    needs: [test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write

    strategy:
      fail-fast: false
      matrix:
        service:
          - gateway
          - identity
          - tenant
          - user
          - question-bank
          - assessment
          - submission
          - judge
          - seb
          - notification
          - analytics

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
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
            ghcr.io/${{ github.repository_owner }}/coderqx-${{ matrix.service }}:latest
            ghcr.io/${{ github.repository_owner }}/coderqx-${{ matrix.service }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

      - name: Install cosign
        if: github.ref == 'refs/heads/master'
        uses: sigstore/cosign-installer@v3

      - name: Sign image (keyless)
        if: github.ref == 'refs/heads/master'
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository_owner }}/coderqx-${{ matrix.service }}@${{ steps.build.outputs.digest }}

      - name: Generate SBOM
        if: github.ref == 'refs/heads/master'
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/${{ github.repository_owner }}/coderqx-${{ matrix.service }}@${{ steps.build.outputs.digest }}
          format: spdx-json
          output-file: sbom-${{ matrix.service }}.spdx.json
          artifact-name: sbom-${{ matrix.service }}

      - name: Attach SBOM to image
        if: github.ref == 'refs/heads/master'
        run: |
          cosign attach sbom \
            --sbom sbom-${{ matrix.service }}.spdx.json \
            ghcr.io/${{ github.repository_owner }}/coderqx-${{ matrix.service }}@${{ steps.build.outputs.digest }}
```

**Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

**Step 4: Add helm-lint job (requires Sub-project H to exist first)**

Once the Helm charts exist, add:

```yaml
  helm-lint:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Helm
        uses: azure/setup-helm@v4
      - name: Lint all service charts
        run: |
          for svc in gateway identity tenant user question-bank assessment \
                      submission judge seb notification analytics; do
            helm lint deploy/helm/platform-service/ \
              -f deploy/helm/platform-service/values-${svc}.yaml || exit 1
          done
```

**Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add container image build, sign, and SBOM pipeline"
```

---

## Task 2: Update Helm values with registry references

Once images are building and pushing:

Update each `deploy/helm/platform-service/values-<svc>.yaml` to reference the GHCR registry:

```yaml
image:
  repository: ghcr.io/<owner>/coderqx-<svc>
  tag: ""   # set at deploy time: --set image.tag=<sha>
```

```bash
git add deploy/helm/
git commit -m "feat: wire GHCR image references into Helm values"
```

---

## Completion checklist

- [ ] CI `build-images` job passes on a PR (dry-run build, no push)
- [ ] CI `build-images` job pushes, signs, and attaches SBOMs on master merge
- [ ] `helm lint` job in CI validates all 11 service charts
- [ ] `make build` and `make lint` still pass
