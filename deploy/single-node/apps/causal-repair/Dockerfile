# Read-only viewer for the causal-repair integration pack. Standard library only, no network at runtime.
# Build context: /data/production/causal-repair/image/ holding `app/` (a copy of
# webapp16/integration_pack/app without the static_bak_* folders) and `readonly_front.py`.
FROM docker.io/library/python:3.14-slim
RUN useradd --uid 1001 --user-group --no-create-home viewer
WORKDIR /srv
COPY app /srv/app
COPY readonly_front.py /srv/readonly_front.py
RUN chmod -R a+rX /srv   # the staging copy keeps 750 modes; the non-root user must be able to read it
# The front listens on loopback only on the host; in a pod it must accept the Service's traffic.
RUN sed -i 's/("127.0.0.1", int(sys.argv\[1\]))/("0.0.0.0", int(sys.argv[1]))/' /srv/readonly_front.py \
 && grep -q '"0.0.0.0"' /srv/readonly_front.py
USER 1001
EXPOSE 8077 8078
CMD ["python", "/srv/app/server.py", "8077"]
