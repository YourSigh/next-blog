REGISTRY := crpi-lgty92ojoeq0mwd1.cn-hangzhou.personal.cr.aliyuncs.com/next-blog

.PHONY: build

build:
	docker buildx build --platform linux/amd64 \
		-t $(REGISTRY)/next-blog:amd64 \
		--push .
