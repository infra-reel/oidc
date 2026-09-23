# 公式Dexイメージをベースに、独自のconfig.yamlを焼き込むだけの構成。
# Dexのソース自体は改変しないため、ビルドはこれだけで完結する。
FROM ghcr.io/dexidp/dex:v2.41.1

COPY config/config.yaml /etc/dex/cfg/config.yaml

EXPOSE 5556
ENTRYPOINT ["/usr/local/bin/dex"]
CMD ["serve", "/etc/dex/cfg/config.yaml"]
