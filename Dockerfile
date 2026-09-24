FROM ghcr.io/dexidp/dex:v2.41.1

COPY config/config.yaml /etc/dex/cfg/config.yaml

EXPOSE 5556
ENTRYPOINT ["/usr/local/bin/dex"]
CMD ["serve", "/etc/dex/cfg/config.yaml"]
