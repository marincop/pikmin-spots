# 皮克敏純點地圖 — static site (nginx)
FROM nginx:alpine
LABEL org.opencontainers.image.title="pikmin-spots"

# PWA at / , desktop map at /map/
COPY app/ /usr/share/nginx/html/
COPY map/ /usr/share/nginx/html/map/

# SPA-ish: serve 404 → index for unknown paths? Not needed; keep default but
# make sure jsonl/webmanifest types are fine (nginx default mime covers them).
EXPOSE 80
