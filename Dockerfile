# 皮克敏純點地圖 — static site (nginx)
FROM nginx:alpine
LABEL org.opencontainers.image.title="pikmin-spots"

# PWA at / , desktop map at /map/
COPY app/ /usr/share/nginx/html/
COPY map/ /usr/share/nginx/html/map/

# nginx default mime.types lacks .webmanifest -> add the mapping
RUN sed -i '$ s|}|    application/manifest+json  webmanifest;\n}|' /etc/nginx/mime.types

# Serve + keep sw.js/index.html uncached so PWA updates land immediately
RUN printf '%s\n' \
  'server {' \
  '    listen 80;' \
  '    server_name _;' \
  '    root /usr/share/nginx/html;' \
  '    index index.html;' \
  '    include /etc/nginx/mime.types;' \
  '    location / { try_files $uri $uri/ =404; }' \
  '    location = /sw.js { add_header Cache-Control "no-cache"; }' \
  '    location = /index.html { add_header Cache-Control "no-cache"; }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
