build:
	docker buildx build --platform linux/amd64 \
		-t crpi-lgty92ojoeq0mwd1.cn-hangzhou.personal.cr.aliyuncs.com/next-blog/next-blog:amd64 \
		--push .
