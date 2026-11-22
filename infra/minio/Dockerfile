# MinIO server + mc client in one image (used by the `minio` and `minio-init` compose services).
# MinIO stopped publishing minio/minio and minio/mc on Docker Hub (pulls now fail with "pull access denied"),
# so we build from Chainguard's free images, pinned by digest (SEC-FIN-10 / SEC-LIVE-09: no floating :latest).
# The Chainguard client image is distroless (no shell), so mc is copied into the server image, which ships bash.
FROM cgr.dev/chainguard/minio-client@sha256:328ad584835c07ff4b28418aa54d9d9a83893b86bc543436c910359cca76ce19 AS mc
FROM cgr.dev/chainguard/minio@sha256:548147b5fc95a67e3e45285dff7e0e50326c3eb1977c6218039461771156c5e7
COPY --from=mc /usr/bin/mc /usr/bin/mc
ENTRYPOINT ["/usr/bin/minio"]
